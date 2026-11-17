// The shared "needs a human" poll: one per gc API per app, whatever the
// number of copies (the sidebar block, the Needs a human pane). Every
// NEEDS_POLL_MS it reads, for every running city the supervisor lists:
//   - GET …/pending: sessions paused on a question or tool approval;
//     for a request it has not seen, the session (its name, when it was
//     last active) and the session's pending prompt (its text), at most
//     LOOKUPS_PER_POLL of each per poll;
//   - open beads waiting on a decision: GET …/beads with label=human (gc's
//     marker for "waiting on a person"), with the dashboard's decision label
//     (what mdash's decision queue lists; read once per API from
//     /api/city/{city}/config, else DEFAULT_DECISION_LABEL), and with
//     type=decision; a bead in several is listed once, with every reason;
//   - GET …/status, every STATUS_POLL_MS: agent, rig and work counts.
// Never the agent or session lists: the sidebar must stay cheap for a city
// of a thousand agents.
//
// It follows the ownership rule of the city list (cities.ts): no timer of
// its own; a subscribed copy's tick starts a poll; closing the copy that
// started one abandons it; one with no answer for POLL_DEADLINE_MS (since
// its last answer: a round over every city may take longer than that) is
// abandoned. A request that backs off the endpoint (transport, 5xx) ends
// the poll; any other failure is kept on its city and the poll goes on.

import type { GcError } from "../gc/errors.ts";
import { DECISION_TYPE, DEFAULT_DECISION_LABEL, HUMAN_LABEL, getCityStatus, getSession, getSessionPending, listOpenBeads, listPending } from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import type { Result } from "../result.ts";
import { backsOff } from "./backoff.ts";
import { POLL_DEADLINE_MS } from "./cities.ts";
import type { Clock } from "./clock.ts";
import type { Endpoint, EndpointListener } from "./endpoint.ts";

/** How often the cities' pending prompts and human beads are read. */
export const NEEDS_POLL_MS = 15_000;
/** How often each city's status is read (its body lists every agent: the heaviest read). */
export const STATUS_POLL_MS = 30_000;
/** At most this many beads per city and query (human, the decision label, type decision). */
export const NEEDS_HUMAN_LIMIT = 50;
/** How often the dashboard's decision label is read again (it changes only with gc's environment). */
export const LABEL_POLL_MS = 10 * 60_000;

/** Why a bead waits on a person: its `human` label, the dashboard's decision label, or its type. */
export type DecisionReason = "human" | "operator" | "decision";

/** Reads gc's dashboard config for a city (GET {api}/api/city/{city}/config), as JSON; null when it cannot. */
export type ReadDashboardConfig = (city: string) => Promise<unknown>;
/** At most this many session and prompt lookups per city per poll. */
export const LOOKUPS_PER_POLL = 8;

/** A session paused on a question, with what the poll learned about it. */
export interface WaitingSession {
  sessionId: string;
  requestId: string;
  kind: string;
  /** The session's alias or template; null until looked up. */
  who: string | null;
  /** When gc last saw it active (ISO); null when unknown. */
  lastActive: string | null;
  /** The prompt's text; null until looked up or when the provider gives none. */
  prompt: string | null;
}

/** One city's part of the poll. */
export interface CityNeeds {
  readonly city: string;
  readonly waiting: readonly WaitingSession[];
  /** Open beads waiting on a decision (human, the decision label, type decision), each once. */
  readonly human: readonly T.Bead[];
  /** Why each listed bead is there, by bead id. */
  readonly reasons: ReadonlyMap<string, readonly DecisionReason[]>;
  /** gc's counts summed over the three queries, less the beads listed more than once. */
  readonly humanTotal: number;
  readonly status: T.StatusBody | null;
  readonly fetchedAt: number | null;
  /** The last failed read of this city, worded by the caller. */
  readonly error: GcError | null;
}

export interface NeedsSnapshot {
  readonly rev: number;
  /** The dashboard's decision label in use (gc's, or the default until read). */
  readonly decisionLabel: string;
  readonly cities: ReadonlyMap<string, CityNeeds>;
  /** A poll's failure that ended it (the endpoint backs off). */
  readonly error: GcError | null;
}

interface Poll {
  starter: object;
  startedAt: number;
  /** When its last request answered (or it started). */
  progressAt: number;
  probe: number | null;
}

interface Known {
  who: string | null;
  lastActive: string | null;
}

/** One gc API's shared poll of what waits on a person, across its cities. */
export class NeedsPoller implements EndpointListener {
  private snap: NeedsSnapshot = { rev: 0, decisionLabel: DEFAULT_DECISION_LABEL, cities: new Map(), error: null };
  private labelAt: number | null = null;
  private last: number | null = null;
  private wanted = false;
  private poll: Poll | null = null;
  private disposed = false;
  private readonly statusAt = new Map<string, number>();
  /** Session names and activity, by city then session id. */
  private readonly sessions = new Map<string, Map<string, Known>>();
  /** Prompt texts by city then request id (a request's prompt never changes). */
  private readonly prompts = new Map<string, Map<string, string | null>>();

  constructor(private readonly endpoint: Endpoint, private readonly clock: Clock, private readonly readConfig: ReadDashboardConfig | null = null) {
    endpoint.addListener(this);
  }

  snapshot(): NeedsSnapshot {
    return this.snap;
  }

  /** Called by a subscribed copy in its own turn with the running cities; starts a poll when one is due. */
  tick(starter: object, cities: readonly string[]): void {
    if (this.disposed) return;
    const now = this.clock.now();
    if (this.poll) {
      if (now - this.poll.progressAt <= POLL_DEADLINE_MS) return;
      this.abandon();
    }
    this.forget(cities);
    if (cities.length === 0) return;
    if (!this.wanted && this.last !== null && now < this.last + NEEDS_POLL_MS) return;
    const gate = this.endpoint.gate(now);
    if (gate.kind === "wait") return;
    const poll: Poll = { starter, startedAt: now, progressAt: now, probe: gate.kind === "probe" ? gate.token : null };
    this.poll = poll;
    this.wanted = false;
    this.last = now;
    void this.run(poll, [...cities]).finally(() => {
      if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
      if (this.poll === poll) this.poll = null;
    });
  }

  /** Polls at the next tick ("retry now", an action that may have changed what waits). */
  refresh(): void {
    this.wanted = true;
  }

  abandonStartedBy(starter: object): void {
    if (this.poll?.starter === starter) {
      this.abandon();
      this.wanted = true;
    }
  }

  dispose(): void {
    this.abandon();
    this.disposed = true;
    this.endpoint.removeListener(this);
  }

  endpointChanged(recovered: boolean): void {
    if (recovered) this.wanted = true;
  }

  private abandon(): void {
    const poll = this.poll;
    if (!poll) return;
    this.poll = null;
    if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
    this.endpoint.dropQueued(poll);
  }

  /** Drops cities the supervisor no longer runs. */
  private forget(cities: readonly string[]): void {
    const keep = new Set(cities);
    if ([...this.snap.cities.keys()].every((c) => keep.has(c))) return;
    const next = new Map([...this.snap.cities].filter(([c]) => keep.has(c)));
    for (const c of [...this.sessions.keys()]) if (!keep.has(c)) this.sessions.delete(c);
    for (const c of [...this.prompts.keys()]) if (!keep.has(c)) this.prompts.delete(c);
    this.snap = { ...this.snap, rev: this.snap.rev + 1, cities: next };
  }

  private current(poll: Poll): boolean {
    return this.poll === poll && !this.disposed;
  }

  /** A request's answer: true to go on; false when the poll must end (abandoned, or the endpoint backs off). */
  private settle<V>(poll: Poll, r: Result<V, GcError>): boolean {
    if (!this.current(poll)) return false;
    poll.progressAt = this.clock.now();
    if (r.ok) {
      this.endpoint.succeeded();
      return true;
    }
    if (r.error.kind === "cancelled") {
      this.wanted = true;
      return false;
    }
    if (backsOff(r.error)) {
      this.endpoint.failed(r.error);
      this.snap = { ...this.snap, rev: this.snap.rev + 1, error: r.error };
      return false;
    }
    this.endpoint.succeeded();
    return true;
  }

  private async run(poll: Poll, cities: string[]): Promise<void> {
    await this.readLabel(poll, cities[0]);
    for (const city of cities) {
      if (!(await this.pollCity(poll, city))) return;
    }
    if (this.current(poll) && this.snap.error !== null) this.snap = { ...this.snap, rev: this.snap.rev + 1, error: null };
  }

  /** Reads the dashboard's decision label (one supervisor-wide value) at most every LABEL_POLL_MS. */
  private async readLabel(poll: Poll, city: string | undefined): Promise<void> {
    const now = this.clock.now();
    if (this.readConfig === null || city === undefined || (this.labelAt !== null && now - this.labelAt < LABEL_POLL_MS)) return;
    this.labelAt = now;
    let raw: unknown = null;
    try {
      raw = await this.readConfig(city);
    } catch {
      raw = null;
    }
    if (!this.current(poll)) return;
    const label = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["decisionLabel"] : undefined;
    if (typeof label === "string" && label.trim() !== "" && label !== this.snap.decisionLabel) {
      this.snap = { ...this.snap, rev: this.snap.rev + 1, decisionLabel: label.trim() };
    }
  }

  private async pollCity(poll: Poll, city: string): Promise<boolean> {
    const client = this.endpoint.client("snapshot", poll);
    const before = this.snap.cities.get(city);
    let error: GcError | null = null;

    const pending = await listPending(client, city);
    if (!this.settle(poll, pending)) return false;
    let waiting = before?.waiting ?? [];
    if (pending.ok) {
      waiting = await this.waitingOf(poll, city, pending.value.items);
      if (!this.current(poll)) return false;
    } else error = pending.error;

    let beads = before?.human ?? [];
    let reasons = before?.reasons ?? new Map<string, readonly DecisionReason[]>();
    let total = before?.humanTotal ?? 0;
    type Query = [DecisionReason, { label: string; limit: number } | { type: string; limit: number }];
    const queries: Query[] = [["human", { label: HUMAN_LABEL, limit: NEEDS_HUMAN_LIMIT }]];
    if (this.snap.decisionLabel !== HUMAN_LABEL) queries.push(["operator", { label: this.snap.decisionLabel, limit: NEEDS_HUMAN_LIMIT }]);
    queries.push(["decision", { type: DECISION_TYPE, limit: NEEDS_HUMAN_LIMIT }]);
    const byId = new Map<string, T.Bead>();
    const why = new Map<string, DecisionReason[]>();
    let sum = 0;
    let complete = true;
    for (const [reason, query] of queries) {
      const r = await listOpenBeads(client, city, query);
      if (!this.settle(poll, r)) return false;
      if (!r.ok) {
        error ??= r.error;
        complete = false;
        continue;
      }
      sum += Math.max(r.value.total ?? 0, r.value.items.length);
      for (const b of r.value.items) {
        if (!byId.has(b.id)) byId.set(b.id, b);
        why.set(b.id, [...(why.get(b.id) ?? []), reason]);
      }
    }
    if (complete) {
      beads = [...byId.values()];
      reasons = why;
      const repeats = [...why.values()].reduce((n, w) => n + w.length - 1, 0);
      total = Math.max(sum - repeats, beads.length);
    }

    let status = before?.status ?? null;
    const now = this.clock.now();
    if (now - (this.statusAt.get(city) ?? -Infinity) >= STATUS_POLL_MS) {
      const s = await getCityStatus(client, city);
      if (!this.settle(poll, s)) return false;
      if (s.ok) {
        status = s.value;
        this.statusAt.set(city, now);
      } else error ??= s.error;
    }

    const cities = new Map(this.snap.cities);
    cities.set(city, { city, waiting, human: beads, reasons, humanTotal: total, status, fetchedAt: this.clock.now(), error });
    this.snap = { ...this.snap, rev: this.snap.rev + 1, cities };
    return true;
  }

  /** The city's pending entries with what is known of each, looking up at most LOOKUPS_PER_POLL new ones. */
  private async waitingOf(poll: Poll, city: string, entries: readonly T.CityPendingEntry[]): Promise<WaitingSession[]> {
    let known = this.sessions.get(city);
    if (!known) {
      known = new Map();
      this.sessions.set(city, known);
    }
    let prompts = this.prompts.get(city);
    if (!prompts) {
      prompts = new Map();
      this.prompts.set(city, prompts);
    }
    const live = new Set(entries.map((e) => e.session_id));
    for (const id of [...known.keys()]) if (!live.has(id)) known.delete(id);
    const requests = new Set(entries.map((e) => e.request_id));
    for (const id of [...prompts.keys()]) if (!requests.has(id)) prompts.delete(id);
    let lookups = 0;
    const client = this.endpoint.client("snapshot", poll);
    for (const e of entries) {
      if (lookups >= LOOKUPS_PER_POLL) break;
      if (!known.has(e.session_id)) {
        lookups++;
        const s = await getSession(client, city, e.session_id);
        if (!this.settle(poll, s)) return [];
        known.set(e.session_id, s.ok ? { who: s.value.alias || s.value.template || null, lastActive: s.value.last_active ?? s.value.created_at ?? null } : { who: null, lastActive: null });
      }
      if (!prompts.has(e.request_id)) {
        lookups++;
        const p = await getSessionPending(client, city, e.session_id);
        if (!this.settle(poll, p)) return [];
        prompts.set(e.request_id, p.ok ? (p.value.pending?.prompt ?? null) : null);
      }
    }
    return entries.map((e) => ({
      sessionId: e.session_id,
      requestId: e.request_id,
      kind: e.kind,
      who: known.get(e.session_id)?.who ?? null,
      lastActive: known.get(e.session_id)?.lastActive ?? null,
      prompt: prompts.get(e.request_id) ?? null,
    }));
  }
}
