// The shared per-city store: one per (API, city) per app, whatever the
// number of copies showing it. It keeps the city's data as an immutable
// snapshot and refreshes it in steps.
//
// herdr's ownership rule shapes the whole loop. Every async host operation
// (fetch, cx.sleep, cx.timer) belongs to the copy whose code is running when
// it starts; its completion runs in that copy's scope (and drains every
// queued JS job there); and when a copy closes, all its tasks are cancelled
// and their promises never settle. So:
//   - the store owns no timer. Every subscribed copy calls `tick()` from a
//     periodic timer of its own; a tick starts a step only when one is due,
//     so the step's first request starts in a live copy's own turn;
//   - nothing is resumed from a close: unsubscribing only abandons a step the
//     closing copy started (a new generation; the old step's late results are
//     dropped), and the next tick of any live copy starts a fresh one;
//   - a step that makes no progress for STEP_STALL_MS is abandoned the same
//     way, so a promise that never settles cannot freeze the city;
//   - "poke" requests (retry now, refresh, a new peek, visibility) are flags
//     the next tick consumes.
//
// One step:
//   1. asks the endpoint whether it may read (backoff: only one probe);
//   2. takes the event cursor from `GET …/events?limit=1` the first time
//      (retried at the sweep cadence if that read is held, e.g. a city that
//      is not running yet), then polls `GET …/events?limit=50` at the events
//      cadence and maps new events to stale domains (invalidate.ts),
//      debounced 300 ms; a gap or a reset log refetches every domain;
//   3. marks sessions + pending stale at their cadence, everything at the
//      sweep, and the watched detail peeks at theirs;
//   4. refetches stale domains one request at a time (one request in flight
//      per domain; a failing endpoint stops the step), then the beads named
//      by bead.closed events (at most 10 per step) for the closed list.
//
// An open detail (watchPeek) also gets, on demand: the session's wake
// reasons (gc probes the runtime for each session it lists with them, so they
// are fetched when the detail opens and on refreshDetail only) and its pending
// prompt (when the detail opens and whenever the city's pending list changes
// for that session). Active beads that the board does not carry are fetched
// by id, at most BEAD_FETCHES_PER_STEP per step, and again on an event about
// them or at the sweep. So is a watched bead (a copy's open bead detail), even
// when the board shows it: the board's columns carry no description.
//
// A request the step was waiting for may be cancelled under it: dropped from
// the fetch queue when the step is abandoned, or taken with the copy whose
// turn started it. That is not gc failing: it neither backs off nor holds the
// domain; the data is simply still due.
//
// Board changes refetch both bounded columns (Ready and In progress), so a
// bead that moved, changed or left is current in the column it is shown in;
// there are no per-bead overlays to fall out of step with their column.
//
// Errors are state: each domain keeps its last good data with the error that
// followed it; transport failures, 5xx and off-origin (redirected) answers
// put the endpoint into backoff; other read errors hold the domain until the
// next sweep or "retry now". Every failure also goes to a bounded diagnostics
// ring and the onError hook.

import type { Listed, Unreadable } from "../gc/decode.ts";
import type { GcError } from "../gc/errors.ts";
import * as ops from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import type { Result } from "../result.ts";
import { backsOff } from "./backoff.ts";
import { RECLAIM_AFTER_MS, type FetchPriority } from "./budget.ts";
import type { Clock } from "./clock.ts";
import type { Connection, Endpoint, EndpointListener } from "./endpoint.ts";
import { ALL_DOMAINS, invalidationFor, type ClosedRef, type Domain } from "./invalidate.ts";
import { DEBOUNCE_MS, intervalOf, plan, type TaskTimes } from "./scheduler.ts";
import { freshness, type Freshness } from "./staleness.ts";
import { EVENT_PAGE_LIMIT, readEventPage, type Resync } from "./watcher.ts";

/** Sessions are fetched in pages of this size… */
export const SESSION_PAGE = 500;
/** …up to this many rows; beyond, the list says it is truncated. */
export const MAX_SESSION_ROWS = 2_000;
/** Ready and in-progress columns download at most this many beads. */
export const BOARD_LIMIT = 50;
/** The closed list keeps the newest this many closes, and is seeded with this many. */
export const MAX_CLOSED_RECENT = 20;
/** Closed-bead refetches per step. */
export const BEAD_FETCHES_PER_STEP = 10;
/** Diagnostics ring size. */
export const ERROR_RING = 100;
/** Lines of output a detail peek asks for. */
export const PEEK_LINES = 40;
/**
 * A step with no progress for this long is abandoned. Every request it awaits
 * settles within RECLAIM_AFTER_MS (the budget reclaims a cancelled one), so
 * this only catches what that cannot: a step queued behind several of them.
 */
export const STEP_STALL_MS = 4 * RECLAIM_AFTER_MS;

/** Which store a key names: a gc API base URL (loopback) and a city on it. */
export interface CityKey {
  readonly apiUrl: string;
  readonly city: string;
}

/** One piece of city data: the last good value, when it was fetched, and the error since, if any. */
export interface Slot<T> {
  readonly value: T | null;
  readonly fetchedAt: number | null;
  readonly error: GcError | null;
  /** A refetch is wanted: the value may be out of date. */
  readonly dirty: boolean;
  /** An error that does not back off (4xx, decode): no refetch until the next sweep or "retry now". */
  readonly held: boolean;
}

export type RigList = Listed<T.ListBodyRigResponse, T.RigResponse>;
export type AgentList = Listed<T.ListBodyAgentResponse, T.AgentResponse>;
export type PendingList = Listed<T.ListBodyCityPendingEntry, T.CityPendingEntry>;
export type WorkList = Listed<T.WorkReadyBody, T.ReadyBead>;

/** Every session page, joined. */
export interface SessionList {
  items: T.SessionResponse[];
  unreadable: Unreadable[];
  /** gc's total: may exceed items.length when truncated. */
  total: number;
  /** More rows than MAX_SESSION_ROWS: the view says "showing N of M". */
  truncated: boolean;
  partial: boolean;
  partialErrors: string[];
}

/** A closed bead, ordered by close time = its bead.closed event's seq. */
export interface ClosedBead {
  readonly seq: number;
  readonly bead: T.Bead;
}

/** The recently-closed data: a one-time seed (ordered by creation, the API has no close time) and closes seen in events. */
export interface ClosedState {
  readonly seed: Slot<WorkList>;
  /** Newest close first, at most MAX_CLOSED_RECENT. */
  readonly recent: readonly ClosedBead[];
  /** Some closes were not fetched (too many at once, a gap, or a failed fetch). */
  readonly incomplete: boolean;
}

/** The event watcher's state. */
export interface EventsState {
  readonly cursor: number | null;
  /** The last successful poll. */
  readonly polledAt: number | null;
  readonly error: GcError | null;
  readonly held: boolean;
  /** How many times the watcher lost track and refetched everything. */
  readonly resyncs: number;
}

/** A failure the store records: a gc call's, an app-wide hook that threw, or a step that crashed or stalled. */
export type SyncError =
  | GcError
  | { kind: "listener-failed"; message: string }
  | { kind: "step-crashed"; message: string }
  | { kind: "step-stalled"; idleMs: number };

/** One diagnostics entry: when, where (a domain, "events", "bead:<id>", "listener", "step", …) and what. */
export interface ErrorEntry {
  readonly at: number;
  readonly source: string;
  readonly error: SyncError;
}

/** What gc says woke (or keeps awake) a session; `listed` is false when gc's list for its template did not include it. */
export interface WakeReasons {
  readonly listed: boolean;
  readonly reasons: readonly string[];
}

/** The on-demand parts of an open detail (the output is in `peeks`). */
export interface DetailState {
  readonly wakeReasons: Slot<WakeReasons>;
  readonly pending: Slot<T.SessionPendingResponse>;
}

/** Everything a copy renders from, immutable; a new object (and rev) per change. */
export interface CitySnapshot {
  readonly rev: number;
  readonly key: CityKey;
  readonly onScreen: boolean;
  readonly connection: Connection;
  readonly events: EventsState;
  readonly rigs: Slot<RigList>;
  readonly agents: Slot<AgentList>;
  readonly sessions: Slot<SessionList>;
  readonly pending: Slot<PendingList>;
  readonly ready: Slot<WorkList>;
  readonly inProgress: Slot<WorkList>;
  readonly closed: ClosedState;
  /** Watched sessions with their output (`last_output`). */
  readonly peeks: ReadonlyMap<string, Slot<T.SessionResponse>>;
  /** Watched sessions' wake reasons and pending prompt. */
  readonly details: ReadonlyMap<string, DetailState>;
  /** Active beads that are not on the board, fetched by id. */
  readonly beads: ReadonlyMap<string, Slot<T.Bead>>;
  /** The last ERROR_RING failures, oldest first. */
  readonly errors: readonly ErrorEntry[];
}

/** New events as one batch, oldest first, for app-wide listeners (toasts, the city list). */
export interface EventBatch {
  readonly key: CityKey;
  readonly events: readonly T.TypedEventStreamEnvelope[];
  /** Set when the watcher lost track: some events were missed. */
  readonly resync: Resync | null;
  /** A city.* event arrived: the supervisor's city list may have changed. */
  readonly citiesChanged: boolean;
}

/** What a store needs from the registry. */
export interface StoreDeps {
  endpoint: Endpoint;
  clock: Clock;
  onScreen: boolean;
  /** Called once per batch of new events. */
  emit(batch: EventBatch): void;
  /** Every recorded failure, for the app log. */
  onError(key: CityKey, entry: ErrorEntry): void;
}

type DomainValue = {
  rigs: RigList;
  agents: AgentList;
  sessions: SessionList;
  pending: PendingList;
  ready: WorkList;
  inProgress: WorkList;
};

const EMPTY_SLOT: Slot<never> = { value: null, fetchedAt: null, error: null, dirty: true, held: false };
const EVENT_DRIVEN: ReadonlySet<Domain> = new Set(["rigs", "agents", "ready", "inProgress"]);
const PRIORITY_RANK: Record<FetchPriority, number> = { mutation: 0, events: 1, snapshot: 2, peek: 3, sweep: 4 };

interface Due {
  at: number;
  priority: FetchPriority;
}

interface MutableSlot<T> {
  value: T | null;
  fetchedAt: number | null;
  error: GcError | null;
  held: boolean;
}

function freshSlot<T>(): MutableSlot<T> {
  return { value: null, fetchedAt: null, error: null, held: false };
}

/** A request the mod gave up on (not gc failing): no backoff, no hold, still due. */
function isCancelled(error: GcError): boolean {
  return error.kind === "cancelled";
}

/** A read error that holds its data until the next sweep or "retry now": neither backoff nor a cancellation. */
function holds(error: GcError): boolean {
  return !backsOff(error) && !isCancelled(error);
}

type OnDemand<V> = MutableSlot<V> & { due: boolean };

function onDemand<V>(): OnDemand<V> {
  return { ...freshSlot<V>(), due: true };
}

interface Watch extends MutableSlot<T.SessionResponse> {
  refs: number;
  due: boolean;
  wake: OnDemand<WakeReasons>;
  /** `key` is the request id the city's pending list showed for the session when it was last fetched. */
  pending: OnDemand<T.SessionPendingResponse> & { key: string | null };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How current one domain of a snapshot is at `now`. */
export function domainFreshness(s: CitySnapshot, domain: Domain, now: number): Freshness {
  if (EVENT_DRIVEN.has(domain)) {
    return freshness(s[domain], now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt });
  }
  return freshness(s[domain], now, { intervalMs: intervalOf("sessions", s.onScreen) ?? 0, confirmedAt: null });
}

interface Step {
  gen: number;
  /** The subscription whose tick started it. */
  starter: object;
  progressAt: number;
  /** The probe token this step holds, if any. */
  probe: number | null;
}

/** One city's shared data and refresh steps. */
export class CityStore implements EndpointListener {
  private snap: CitySnapshot;
  private readonly slots: { [D in Domain]: MutableSlot<DomainValue[D]> } = {
    rigs: freshSlot(), agents: freshSlot(), sessions: freshSlot(), pending: freshSlot(), ready: freshSlot(), inProgress: freshSlot(),
  };
  private readonly due = new Map<Domain, Due>();
  private closedQueue: ClosedRef[] = [];
  private readonly peeks = new Map<string, Watch>();
  private readonly lookups = new Map<string, OnDemand<T.Bead>>();
  /** Watched beads (open bead details) and how many watches each has. */
  private readonly beadWatches = new Map<string, number>();
  private seed: MutableSlot<WorkList> & { due: boolean } = { ...freshSlot<WorkList>(), due: true };
  private recent: ClosedBead[] = [];
  private incomplete = false;
  private events: { cursor: number | null; polledAt: number | null; error: GcError | null; held: boolean; resyncs: number } = {
    cursor: null, polledAt: null, error: null, held: false, resyncs: 0,
  };
  private errors: ErrorEntry[] = [];
  private readonly last: TaskTimes = { events: null, sessions: null, peek: null, sweep: null };
  private onScreen: boolean;
  private step: Step | null = null;
  private generation = 0;
  private disposed = false;

  constructor(readonly key: CityKey, private readonly deps: StoreDeps) {
    this.onScreen = deps.onScreen;
    for (const d of ALL_DOMAINS) this.mark(d, 0, "snapshot");
    this.snap = this.build(0);
    deps.endpoint.addListener(this);
  }

  /** The current snapshot. */
  snapshot(): CitySnapshot {
    return this.snap;
  }

  /**
   * Called by a subscribed copy, in its own turn (its periodic timer): starts
   * a step if one is due and none is running, and abandons a stalled one.
   */
  tick(starter: object): void {
    if (this.disposed) return;
    const now = this.deps.clock.now();
    if (this.step) {
      const idleMs = now - this.step.progressAt;
      if (idleMs <= STEP_STALL_MS) return;
      this.record("step", { kind: "step-stalled", idleMs });
      this.abandon();
      this.commit();
    }
    if (!this.wantsStep(now)) return;
    const step: Step = { gen: ++this.generation, starter, progressAt: now, probe: null };
    this.step = step;
    this.runStep(step).then(
      () => this.endStep(step),
      (cause: unknown) => {
        if (this.step === step) this.record("step", { kind: "step-crashed", message: messageOf(cause) });
        this.endStep(step);
        this.commit();
      },
    );
  }

  /** The copy `starter` closes: drop the step it started (its requests may never settle). Starts nothing. */
  abandonStartedBy(starter: object): void {
    if (this.step?.starter === starter) this.abandon();
  }

  /** Switches cadence; the next tick polls at once if a gascity view appeared. */
  setOnScreen(onScreen: boolean): void {
    if (this.onScreen === onScreen) return;
    this.onScreen = onScreen;
    this.commit();
  }

  /** "Retry now": re-arms held domains and, if the endpoint is backing off, makes the probe due. */
  retryNow(): void {
    this.rearmHeld(this.deps.clock.now(), "snapshot");
    this.deps.endpoint.retryNow();
    this.commit();
  }

  /** Refetches `domains` at the next tick, held or not. */
  refresh(domains: readonly Domain[]): void {
    const now = this.deps.clock.now();
    for (const d of domains) {
      this.slots[d].held = false;
      this.mark(d, now, "snapshot");
    }
    this.commit();
  }

  /** Starts (or joins) watching a session's detail: output, wake reasons, pending prompt; returns the release. */
  watchPeek(sessionId: string): () => void {
    const p = this.peeks.get(sessionId);
    if (p) p.refs++;
    else {
      this.peeks.set(sessionId, {
        ...freshSlot<T.SessionResponse>(), refs: 1, due: true, wake: onDemand(), pending: { ...onDemand(), key: this.pendingKey(sessionId) },
      });
      this.commit();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const q = this.peeks.get(sessionId);
      if (!q) return;
      q.refs--;
      if (q.refs <= 0) {
        this.peeks.delete(sessionId);
        this.commit();
      }
    };
  }

  /** Starts (or joins) watching a bead: fetched by id, and again on an event about it or at the sweep; returns the release. */
  watchBead(beadId: string): () => void {
    this.beadWatches.set(beadId, (this.beadWatches.get(beadId) ?? 0) + 1);
    this.syncLookups();
    this.commit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.beadWatches.get(beadId) ?? 0) - 1;
      if (n > 0) this.beadWatches.set(beadId, n);
      else this.beadWatches.delete(beadId);
      this.syncLookups();
      this.commit();
    };
  }

  /** Refetches a watched session's output, wake reasons and pending prompt at the next tick. */
  refreshDetail(sessionId: string): void {
    const w = this.peeks.get(sessionId);
    if (!w) return;
    for (const part of [w, w.wake, w.pending]) {
      part.held = false;
      part.due = true;
    }
    this.commit();
  }

  /** Ends the store: a running step's late results are dropped. */
  dispose(): void {
    this.abandon();
    this.disposed = true;
    this.deps.endpoint.removeListener(this);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ---- EndpointListener -------------------------------------------------------

  endpointChanged(recovered: boolean): void {
    if (recovered) {
      const now = this.deps.clock.now();
      for (const d of ALL_DOMAINS) this.mark(d, now, "snapshot");
      this.incomplete = true;
    }
    this.commit();
  }

  // ---- steps --------------------------------------------------------------------

  private abandon(): void {
    const step = this.step;
    if (!step) return;
    this.step = null;
    this.generation++;
    if (step.probe !== null) this.deps.endpoint.endProbe(step.probe);
    this.deps.endpoint.dropQueued(step);
  }

  private endStep(step: Step): void {
    if (step.probe !== null) this.deps.endpoint.endProbe(step.probe);
    if (this.step === step) this.step = null;
  }

  private current(step: Step): boolean {
    return !this.disposed && this.step === step;
  }

  private progress(step: Step): void {
    step.progressAt = this.deps.clock.now();
  }

  private sweepDue(now: number): boolean {
    return this.last.sweep === null || now >= this.last.sweep + (intervalOf("sweep", this.onScreen) ?? 0);
  }

  private wantsStep(now: number): boolean {
    const gate = this.deps.endpoint.peekGate(now);
    if (gate.kind === "wait") return false;
    if (gate.kind === "probe") return true;
    // Without a cursor nothing else can be trusted: only the cursor read (or,
    // if it is held, the sweep that re-arms it) is due.
    if (this.events.cursor === null) return !this.events.held || this.sweepDue(now);
    if (plan(this.last, now, { onScreen: this.onScreen, peek: this.peeks.size > 0, extraWakeAt: null }).due.length > 0) return true;
    for (const d of this.due.values()) if (d.at <= now) return true;
    if (this.closedQueue.length > 0) return true;
    if (this.seed.due && !this.seed.held) return true;
    if ([...this.lookups.values()].some((b) => b.due && !b.held)) return true;
    for (const [id, w] of this.peeks) {
      if ((w.wake.due && !w.wake.held && this.templateOf(id) !== undefined) || (w.pending.due && !w.pending.held)) return true;
    }
    return this.onScreen && [...this.peeks.values()].some((q) => q.due && !q.held);
  }

  private async runStep(step: Step): Promise<void> {
    const now = this.deps.clock.now();
    const gate = this.deps.endpoint.gate(now);
    if (gate.kind === "wait") return;
    if (gate.kind === "probe") {
      step.probe = gate.token;
      this.last.events = now;
      await this.pollEvents(step, this.events.cursor === null ? 1 : EVENT_PAGE_LIMIT);
      return;
    }

    if (this.events.cursor === null) {
      if (this.sweepDue(now)) {
        this.last.sweep = now;
        this.rearmHeld(now, "sweep");
      }
      if (this.events.held) return;
      this.last.events = now;
      if (!(await this.pollEvents(step, 1))) return;
    }

    const p = plan(this.last, now, { onScreen: this.onScreen, peek: this.peeks.size > 0, extraWakeAt: null });
    for (const task of p.due) {
      if (task === "events") {
        this.last.events = now;
        if (!this.events.held && !(await this.pollEvents(step, EVENT_PAGE_LIMIT))) return;
      } else if (task === "sessions") {
        this.last.sessions = now;
        this.mark("sessions", now, "snapshot");
        this.mark("pending", now, "snapshot");
      } else if (task === "sweep") {
        this.last.sweep = now;
        this.rearmHeld(now, "sweep");
        for (const d of ALL_DOMAINS) this.mark(d, now, "sweep");
        for (const b of this.lookups.values()) b.due = true;
      } else {
        this.last.peek = now;
        for (const q of this.peeks.values()) q.due = true;
      }
    }
    if (!this.current(step)) return;
    await this.fetchDue(step);
  }

  private gateOpen(step: Step): boolean {
    return this.current(step) && this.deps.endpoint.peekGate(this.deps.clock.now()).kind === "open";
  }

  private async fetchDue(step: Step): Promise<void> {
    for (const d of ALL_DOMAINS) {
      const due = this.due.get(d);
      if (!due || due.at > this.deps.clock.now()) continue;
      if (!this.gateOpen(step)) return;
      await this.fetchDomain(step, d, due.priority);
    }
    if (this.seed.due && !this.seed.held) {
      if (!this.gateOpen(step)) return;
      await this.fetchSeed(step);
    }
    await this.fetchClosed(step);
    await this.fetchLookups(step);
    for (const [id, w] of [...this.peeks]) {
      if (w.wake.due && !w.wake.held && this.templateOf(id) !== undefined) {
        if (!this.gateOpen(step)) return;
        await this.fetchWake(step, id);
      }
      if (w.pending.due && !w.pending.held) {
        if (!this.gateOpen(step)) return;
        await this.fetchSessionPending(step, id);
      }
    }
    if (this.onScreen) {
      for (const [id, q] of [...this.peeks]) {
        if (!q.due || q.held) continue;
        if (!this.gateOpen(step)) return;
        await this.fetchPeek(step, id);
      }
    }
  }

  // ---- bookkeeping --------------------------------------------------------------

  private mark(d: Domain, at: number, priority: FetchPriority): void {
    if (this.slots[d].held) return;
    const cur = this.due.get(d);
    if (!cur) {
      this.due.set(d, { at, priority });
      return;
    }
    this.due.set(d, {
      at: Math.min(cur.at, at),
      priority: PRIORITY_RANK[priority] < PRIORITY_RANK[cur.priority] ? priority : cur.priority,
    });
  }

  private rearmHeld(now: number, priority: FetchPriority): void {
    for (const d of ALL_DOMAINS) {
      if (this.slots[d].held) {
        this.slots[d].held = false;
        this.mark(d, now, priority);
      }
    }
    this.events.held = false;
    for (const p of this.peeks.values()) {
      if (p.held) {
        p.held = false;
        p.due = true;
      }
    }
    if (this.seed.value === null) this.seed.due = true;
    this.seed.held = false;
    for (const b of this.lookups.values()) {
      if (b.held) {
        b.held = false;
        b.due = true;
      }
    }
    for (const w of this.peeks.values()) {
      for (const part of [w.wake, w.pending]) {
        if (part.held) {
          part.held = false;
          part.due = true;
        }
      }
    }
  }

  /**
   * Reports a read's outcome to the endpoint; returns true if it succeeded. A
   * cancelled request says nothing about gc: it is recorded, nothing more.
   */
  private settle<V>(r: Result<V, GcError>, source: string): boolean {
    if (r.ok) {
      this.deps.endpoint.succeeded();
      return true;
    }
    this.record(source, r.error);
    if (isCancelled(r.error)) return false;
    if (backsOff(r.error)) this.deps.endpoint.failed(r.error);
    else this.deps.endpoint.succeeded();
    return false;
  }

  private record(source: string, error: SyncError): void {
    const entry: ErrorEntry = { at: this.deps.clock.now(), source, error };
    this.errors = [...this.errors, entry].slice(-ERROR_RING);
    try {
      this.deps.onError(this.key, entry);
    } catch (cause) {
      const hookFailed: ErrorEntry = { at: entry.at, source: "onError", error: { kind: "listener-failed", message: messageOf(cause) } };
      this.errors = [...this.errors, hookFailed].slice(-ERROR_RING);
    }
  }

  // ---- reads --------------------------------------------------------------------

  private async pollEvents(step: Step, limit: number): Promise<boolean> {
    const r = await ops.pollEvents(this.deps.endpoint.client("events", step), this.key.city, { limit });
    if (!this.current(step)) return false;
    this.progress(step);
    const now = this.deps.clock.now();
    if (!this.settle(r, "events")) {
      if (!r.ok && !isCancelled(r.error)) {
        this.events.error = r.error;
        if (holds(r.error)) this.events.held = true;
      }
      this.commit();
      return false;
    }
    if (!r.ok) return false;
    for (const u of r.value.unreadable) this.record("events", u.error);
    const page = r.value;
    this.events.error = null;
    this.events.polledAt = now;
    if (this.events.cursor === null) {
      this.events.cursor = page.items.reduce((max, e) => Math.max(max, e.seq), page.items.length > 0 ? 0 : page.total);
      this.commit();
      return true;
    }
    const reading = readEventPage(this.events.cursor, { items: page.items, unreadable: page.unreadable.map((u) => u.index), total: page.total });
    this.events.cursor = reading.cursor;
    const at = now + DEBOUNCE_MS;
    if (reading.resync) {
      this.events.resyncs++;
      this.incomplete = true;
      for (const d of ALL_DOMAINS) this.mark(d, at, "events");
    }
    const inv = invalidationFor(reading.newer, this.known());
    for (const d of inv.domains) this.mark(d, at, "events");
    for (const e of reading.newer) {
      const looked = e.type.startsWith("bead.") && e.subject !== undefined ? this.lookups.get(e.subject) : undefined;
      if (looked) looked.due = true;
    }
    if (reading.resync) for (const b of this.lookups.values()) b.due = true;
    if (inv.closed.length > 0) this.closedQueue = [...this.closedQueue, ...inv.closed];
    if (reading.newer.length > 0 || reading.resync) {
      const batch: EventBatch = { key: this.key, events: reading.newer, resync: reading.resync, citiesChanged: inv.cities };
      try {
        this.deps.emit(batch);
      } catch (cause) {
        this.record("listener", { kind: "listener-failed", message: messageOf(cause) });
      }
    }
    this.commit();
    return true;
  }

  private known() {
    const sessionIds = new Set((this.slots.sessions.value?.items ?? []).map((s) => s.id));
    return { sessionIds };
  }

  private workQuery(extra: { limit: number; status?: "in_progress" | "closed"; sort?: "newest" }) {
    const q: { exclude_type: readonly string[]; limit: number; sort?: "newest"; status?: "in_progress" | "closed" } = {
      exclude_type: ops.INFRASTRUCTURE_BEAD_TYPES,
      limit: extra.limit,
    };
    if (extra.sort) q.sort = extra.sort;
    if (extra.status) q.status = extra.status;
    return q;
  }

  private async load<D extends Domain>(step: Step, d: D, priority: FetchPriority): Promise<Result<DomainValue[D], GcError>> {
    const c = this.deps.endpoint.client(priority, step);
    const city = this.key.city;
    switch (d) {
      case "rigs":
        return (await ops.listRigs(c, city)) as Result<DomainValue[D], GcError>;
      case "agents":
        return (await ops.listAgents(c, city)) as Result<DomainValue[D], GcError>;
      case "pending":
        return (await ops.listPending(c, city)) as Result<DomainValue[D], GcError>;
      case "ready":
        return (await ops.listWork(c, city, this.workQuery({ limit: BOARD_LIMIT }))) as Result<DomainValue[D], GcError>;
      case "inProgress":
        return (await ops.listWork(c, city, this.workQuery({ limit: BOARD_LIMIT, status: "in_progress" }))) as Result<DomainValue[D], GcError>;
      default:
        return (await this.loadSessions(step, priority)) as Result<DomainValue[D], GcError>;
    }
  }

  private async loadSessions(step: Step, priority: FetchPriority): Promise<Result<SessionList, GcError>> {
    const c = this.deps.endpoint.client(priority, step);
    const out: SessionList = { items: [], unreadable: [], total: 0, truncated: false, partial: false, partialErrors: [] };
    let cursor: string | undefined;
    for (;;) {
      const r = await ops.listSessions(c, this.key.city, cursor === undefined ? { limit: SESSION_PAGE } : { limit: SESSION_PAGE, cursor });
      this.progress(step);
      if (!r.ok) return r;
      const offset = out.items.length + out.unreadable.length;
      out.items.push(...r.value.items);
      out.unreadable.push(...r.value.unreadable.map((u) => ({ ...u, index: u.index + offset })));
      out.total = r.value.total;
      out.partial ||= r.value.partial === true;
      out.partialErrors.push(...r.value.partial_errors);
      const rows = out.items.length + out.unreadable.length;
      if (!r.value.next_cursor) break;
      if (rows >= MAX_SESSION_ROWS) {
        out.truncated = true;
        break;
      }
      if (!this.current(step)) break;
      cursor = r.value.next_cursor;
    }
    return { ok: true, value: out };
  }

  private async fetchDomain(step: Step, d: Domain, priority: FetchPriority): Promise<void> {
    const r = await this.load(step, d, priority);
    if (!this.current(step)) return;
    this.progress(step);
    const slot = this.slots[d] as MutableSlot<unknown>;
    if (this.settle(r, d) && r.ok) {
      slot.value = r.value;
      slot.fetchedAt = this.deps.clock.now();
      slot.error = null;
      slot.held = false;
      this.due.delete(d);
      if (d === "pending") this.pendingChanged();
      this.syncLookups();
    } else if (!r.ok && !isCancelled(r.error)) {
      slot.error = r.error;
      if (holds(r.error)) {
        slot.held = true;
        this.due.delete(d);
      }
    }
    this.commit();
  }

  private async fetchSeed(step: Step): Promise<void> {
    const r = await ops.listWork(this.deps.endpoint.client("snapshot", step), this.key.city, this.workQuery({ limit: MAX_CLOSED_RECENT, status: "closed", sort: "newest" }));
    if (!this.current(step)) return;
    this.progress(step);
    if (this.settle(r, "closed-seed") && r.ok) {
      this.seed = { value: r.value, fetchedAt: this.deps.clock.now(), error: null, held: false, due: false };
      this.syncLookups();
    } else if (!r.ok && !isCancelled(r.error)) {
      this.seed.error = r.error;
      if (holds(r.error)) {
        this.seed.held = true;
        this.seed.due = false;
      }
    }
    this.commit();
  }

  private async fetchClosed(step: Step): Promise<void> {
    if (this.closedQueue.length === 0) return;
    const newestFirst = [...this.closedQueue].sort((a, b) => b.seq - a.seq);
    if (newestFirst.length > BEAD_FETCHES_PER_STEP) {
      this.incomplete = true;
      this.closedQueue = newestFirst.slice(0, BEAD_FETCHES_PER_STEP);
    }
    for (const ref of newestFirst.slice(0, BEAD_FETCHES_PER_STEP)) {
      if (!this.gateOpen(step)) return;
      const r = await ops.getBead(this.deps.endpoint.client("snapshot", step), this.key.city, ref.id);
      if (!this.current(step)) return;
      this.progress(step);
      if (!r.ok && isCancelled(r.error)) {
        this.record(`closed:${ref.id}`, r.error);
        this.commit();
        return;
      }
      this.closedQueue = this.closedQueue.filter((c) => c !== ref);
      if (this.settle(r, `closed:${ref.id}`) && r.ok) {
        const kept = this.recent.filter((c) => c.bead.id !== ref.id || c.seq > ref.seq);
        if (!kept.some((c) => c.bead.id === ref.id)) kept.push({ seq: ref.seq, bead: r.value });
        this.recent = kept.sort((a, b) => b.seq - a.seq).slice(0, MAX_CLOSED_RECENT);
        this.syncLookups();
      } else {
        this.incomplete = true;
      }
      this.commit();
    }
  }

  private async fetchPeek(step: Step, id: string): Promise<void> {
    const r = await ops.getSession(this.deps.endpoint.client("peek", step), this.key.city, id, { peek: true, peek_lines: PEEK_LINES });
    if (!this.current(step)) return;
    this.progress(step);
    const ok = this.settle(r, `peek:${id}`);
    const q = this.peeks.get(id);
    if (!q) return; // released while in flight
    q.due = false;
    if (ok && r.ok) {
      q.value = r.value;
      q.fetchedAt = this.deps.clock.now();
      q.error = null;
    } else if (!r.ok) {
      this.failOnDemand(q, r.error);
    }
    this.commit();
  }

  /** A failed on-demand read: kept due on backoff or cancellation, held (until sweep / retry) otherwise. */
  private failOnDemand(part: MutableSlot<unknown> & { due: boolean }, error: GcError): void {
    if (isCancelled(error)) {
      part.due = true;
      return;
    }
    part.error = error;
    if (backsOff(error)) part.due = true;
    else {
      part.due = false;
      part.held = true;
    }
  }

  /** A session's template from the session list: wake reasons are asked per template, so until it is known there is nothing to ask. */
  private templateOf(id: string): string | undefined {
    return this.slots.sessions.value?.items.find((x) => x.id === id)?.template;
  }

  private async fetchWake(step: Step, id: string): Promise<void> {
    const template = this.templateOf(id);
    if (template === undefined) return;
    const r = await ops.listSessions(this.deps.endpoint.client("peek", step), this.key.city, { limit: SESSION_PAGE, template, wake_reasons: true });
    if (!this.current(step)) return;
    this.progress(step);
    const ok = this.settle(r, `wake-reasons:${id}`);
    const w = this.peeks.get(id);
    if (!w) return;
    w.wake.due = false;
    if (ok && r.ok) {
      const listed = r.value.items.find((x) => x.id === id);
      w.wake.value = { listed: listed !== undefined, reasons: listed?.wake_reasons ?? [] };
      w.wake.fetchedAt = this.deps.clock.now();
      w.wake.error = null;
    } else if (!r.ok) {
      this.failOnDemand(w.wake, r.error);
    }
    this.commit();
  }

  private async fetchSessionPending(step: Step, id: string): Promise<void> {
    const r = await ops.getSessionPending(this.deps.endpoint.client("peek", step), this.key.city, id);
    if (!this.current(step)) return;
    this.progress(step);
    const ok = this.settle(r, `pending:${id}`);
    const w = this.peeks.get(id);
    if (!w) return;
    w.pending.due = false;
    if (ok && r.ok) {
      w.pending.value = r.value;
      w.pending.fetchedAt = this.deps.clock.now();
      w.pending.error = null;
    } else if (!r.ok) {
      this.failOnDemand(w.pending, r.error);
    }
    this.commit();
  }

  private async fetchLookups(step: Step): Promise<void> {
    const due = [...this.lookups].filter(([, b]) => b.due && !b.held).slice(0, BEAD_FETCHES_PER_STEP);
    for (const [id] of due) {
      if (!this.gateOpen(step)) return;
      const r = await ops.getBead(this.deps.endpoint.client("snapshot", step), this.key.city, id);
      if (!this.current(step)) return;
      this.progress(step);
      const ok = this.settle(r, `bead:${id}`);
      const b = this.lookups.get(id);
      if (!b) continue; // no session works on it any more
      b.due = false;
      if (ok && r.ok) {
        b.value = r.value;
        b.fetchedAt = this.deps.clock.now();
        b.error = null;
      } else if (!r.ok) {
        this.failOnDemand(b, r.error);
      }
      this.commit();
    }
  }

  /** The request id the city's pending list shows for a session, or null. */
  private pendingKey(sessionId: string): string | null {
    return this.slots.pending.value?.items.find((p) => p.session_id === sessionId)?.request_id ?? null;
  }

  /** The city's pending list changed: refetch the prompt of each watched session whose entry changed. */
  private pendingChanged(): void {
    for (const [id, w] of this.peeks) {
      const key = this.pendingKey(id);
      if (key === w.pending.key) continue;
      w.pending.key = key;
      w.pending.due = true;
      w.pending.held = false;
    }
  }

  /** Keeps a lookup for every watched bead and every active bead of a session or agent that the board does not carry, and only those. */
  private syncLookups(): void {
    const onBoard = new Set<string>();
    for (const list of [this.slots.ready.value, this.slots.inProgress.value, this.seed.value]) {
      for (const b of list?.items ?? []) onBoard.add(b.id);
    }
    for (const c of this.recent) onBoard.add(c.bead.id);
    const wanted = new Set<string>(this.beadWatches.keys());
    for (const x of [...(this.slots.sessions.value?.items ?? []), ...(this.slots.agents.value?.items ?? [])]) {
      if (x.active_bead !== undefined && x.active_bead !== "" && !onBoard.has(x.active_bead)) wanted.add(x.active_bead);
    }
    for (const id of [...this.lookups.keys()]) if (!wanted.has(id)) this.lookups.delete(id);
    for (const id of wanted) if (!this.lookups.has(id)) this.lookups.set(id, onDemand());
  }

  // ---- snapshot -----------------------------------------------------------------

  private slotOf<V>(s: MutableSlot<V>, dirty: boolean): Slot<V> {
    if (s.value === null && s.fetchedAt === null && s.error === null && dirty && !s.held) return EMPTY_SLOT;
    return { value: s.value, fetchedAt: s.fetchedAt, error: s.error, dirty, held: s.held };
  }

  private build(rev: number): CitySnapshot {
    const dirty = (d: Domain) => this.due.has(d);
    return {
      rev,
      key: this.key,
      onScreen: this.onScreen,
      connection: this.deps.endpoint.connection(),
      events: { ...this.events },
      rigs: this.slotOf(this.slots.rigs, dirty("rigs")),
      agents: this.slotOf(this.slots.agents, dirty("agents")),
      sessions: this.slotOf(this.slots.sessions, dirty("sessions")),
      pending: this.slotOf(this.slots.pending, dirty("pending")),
      ready: this.slotOf(this.slots.ready, dirty("ready")),
      inProgress: this.slotOf(this.slots.inProgress, dirty("inProgress")),
      closed: { seed: this.slotOf(this.seed, this.seed.due), recent: this.recent, incomplete: this.incomplete },
      peeks: new Map([...this.peeks].map(([id, s]) => [id, this.slotOf(s, s.due)])),
      details: new Map([...this.peeks].map(([id, w]) => [id, { wakeReasons: this.slotOf(w.wake, w.wake.due), pending: this.slotOf(w.pending, w.pending.due) }])),
      beads: new Map([...this.lookups].map(([id, b]) => [id, this.slotOf(b, b.due)])),
      errors: this.errors,
    };
  }

  private commit(): void {
    this.snap = this.build(this.snap.rev + 1);
  }
}
