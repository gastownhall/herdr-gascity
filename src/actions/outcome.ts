// The outcome machinery: the ledger that sends a person's actions, follows a
// 202 to its outcome, and keeps the city's activity log. One per city store
// (registry.ts), shared by every copy of the city, so the outcome of an
// action stays visible in the other copies after the one that started it
// closes.
//
// herdr's ownership rule shapes it, as it shapes the store: every fetch
// belongs to the copy whose code starts it and never settles once that copy
// closes. So:
//   - an action is sent in the turn of the copy that started it (a click, a
//     key, a command), and its outcome is polled only from that copy's own
//     ticks;
//   - when that copy goes (ownerGone, from its close), every action it still
//     had under way becomes "unknown" at once (cause "cancelled"): its queued
//     request is dropped from the fetch budget (never sent), a late answer is
//     ignored, the affected state is refetched by the next tick of any live
//     copy, and nothing is resent;
//   - every step has a deadline (SEND_DEADLINE_MS for the request,
//     OUTCOME_POLL_LIMIT_MS for the outcome), so nothing hangs.
//
// Nothing here retries. A retry is a person's explicit act (retry), allowed
// after a failure, or after an unknown outcome once the affected state has
// been refetched (retryGate). After an unknown outcome a retry reuses the
// action's Idempotency-Key, so gc deduplicates it where gc declares the
// header; where it does not, the retry is a new request.

import { outcomeFailure, type GcError } from "../gc/errors.ts";
import type { GcClient } from "../gc/client.ts";
import { decodeValue, isUnrecognized } from "../gc/decode.ts";
import * as ops from "../gc/ops.ts";
import {
  SessionCreateSucceededPayloadSchema, SessionMessageSucceededPayloadSchema, SessionSubmitSucceededPayloadSchema,
} from "../gc/schemas.gen.ts";
import type { RequestOutcome } from "../gc/types.gen.ts";
import { err, ok, type Result } from "../result.ts";
import { backsOff } from "../sync/backoff.ts";
import { RECLAIM_AFTER_MS, type FetchPriority } from "../sync/budget.ts";
import type { Clock } from "../sync/clock.ts";
import type { Domain } from "../sync/invalidate.ts";
import type { CitySnapshot } from "../sync/store.ts";
import {
  isPending, type ActionEntry, type ActionSpec, type ActionState, type ActivitySnapshot, type OutcomeUnknown, type Sent,
} from "./activity.ts";

/** Delays before the first outcome polls, each measured from the previous answer… */
export const OUTCOME_POLL_DELAYS_MS: readonly number[] = [500, 1000, 2000];
/** …then this between polls… */
export const OUTCOME_POLL_EVERY_MS = 2000;
/** …until this long after gc accepted the request: then the outcome is unknown. */
export const OUTCOME_POLL_LIMIT_MS = 120_000;
/**
 * A request still unanswered this long after it was started is unknown. The
 * budget reclaims a request herdr cancelled after RECLAIM_AFTER_MS; a
 * mutation queues behind at most the requests in flight, so twice that is
 * never reached by a live request.
 */
export const SEND_DEADLINE_MS = 2 * RECLAIM_AFTER_MS;
/** The activity log keeps this many actions (never dropping one under way). */
export const ACTIVITY_LIMIT = 50;

/** What the ledger needs from its city store and endpoint. */
export interface LedgerDeps {
  city: string;
  clock: Clock;
  /** A client whose requests queue at `priority` and can be dropped together with `group`. */
  client(priority: FetchPriority, group: object): GcClient;
  /** Drops `group`'s queued requests: they are never sent. Starts nothing. */
  dropQueued(group: object): void;
  /** Refetches these domains at the next tick of any copy. */
  refresh(domains: readonly Domain[]): void;
  /** Refetches a watched session's detail at the next tick. */
  refreshDetail(sessionId: string): void;
  /** A fresh Idempotency-Key. */
  newKey(): string;
}

interface ActionRecord {
  id: number;
  spec: ActionSpec;
  key: string;
  attempt: number;
  startedAt: number;
  state: ActionState;
  /** The copy whose turn sent the current attempt. */
  owner: object;
  /** The current attempt's requests, for dropping them from the queue. */
  group: object;
  /** Answers carrying another token belong to an earlier attempt or a resolved one: ignored. */
  token: number;
}

/** Why a retry is or is not offered now. */
export type RetryGate = { allowed: true } | { allowed: false; reason: string };

/**
 * May the person retry this action now? After a failure, yes. After an
 * unknown outcome, only once every domain the action changes has been
 * refetched since: the person sees the current state before choosing to
 * send it again.
 */
export function retryGate(entry: ActionEntry, snapshot: CitySnapshot): RetryGate {
  const s = entry.state;
  if (isPending(s)) return { allowed: false, reason: "the action is still under way" };
  if (s.kind === "done") return { allowed: false, reason: "the action is done" };
  if (s.kind === "failed") return { allowed: true };
  for (const d of entry.spec.refresh) {
    const fetchedAt = snapshot[d].fetchedAt;
    if (fetchedAt === null || fetchedAt < s.at) return { allowed: false, reason: `refreshing ${d} before a retry` };
  }
  return { allowed: true };
}

/** What a succeeded 202 request did, from gc's typed result payload. */
export function successDetail(outcome: RequestOutcome): string {
  const op = outcome.operation;
  const payload = outcome.event?.payload;
  if (isUnrecognized(op)) return "succeeded";
  if (op === "session.create") {
    const p = decodeValue(SessionCreateSucceededPayloadSchema, payload, "get-request-outcome", "event.payload");
    if (!p.ok) return unreadable(p.error);
    const alias = p.value.session.alias;
    return `created session ${p.value.session.id}${alias !== undefined && alias !== "" ? ` (${alias})` : ""}`;
  }
  const p = op === "session.submit"
    ? decodeValue(SessionSubmitSucceededPayloadSchema, payload, "get-request-outcome", "event.payload")
    : decodeValue(SessionMessageSucceededPayloadSchema, payload, "get-request-outcome", "event.payload");
  if (!p.ok) return unreadable(p.error);
  return p.value.queued ? "queued: the session gets it when it next runs" : "delivered";
}

function unreadable(e: Extract<GcError, { kind: "decode" }>): string {
  return `succeeded (gc's result could not be read: ${e.issues.join("; ")})`;
}

/** A version 4 UUID for Idempotency-Key: the host's crypto.randomUUID when it has one. */
export function newIdempotencyKey(random: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join("");
  const variant = "89ab"[Math.floor(random() * 4)] ?? "8";
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

function unknown(requestId: string | null, operationId: string, cause: OutcomeUnknown["cause"], issues?: string[]): OutcomeUnknown {
  const e: OutcomeUnknown = { kind: "outcome-unknown", requestId, operationId, cause };
  if (issues !== undefined) e.issues = issues;
  return e;
}

function pollDelay(polls: number): number {
  return OUTCOME_POLL_DELAYS_MS[polls] ?? OUTCOME_POLL_EVERY_MS;
}

/** One city's actions and their outcomes. */
export class ActionLedger {
  private readonly records: ActionRecord[] = [];
  private seq = 0;
  private tokens = 0;
  private rev = 0;
  private snap: ActivitySnapshot = { rev: 0, entries: [] };
  private disposed = false;

  constructor(private readonly deps: LedgerDeps) {}

  /** The activity log. */
  snapshot(): ActivitySnapshot {
    return this.snap;
  }

  /** Sends a new action now, in the turn of `owner` (the caller's copy). Returns its id. */
  start(owner: object, spec: ActionSpec): number {
    const now = this.deps.clock.now();
    const rec: ActionRecord = {
      id: ++this.seq, spec, key: this.deps.newKey(), attempt: 1, startedAt: now,
      state: { kind: "sending", since: now }, owner, group: {}, token: 0,
    };
    this.records.push(rec);
    this.trim();
    this.send(rec, owner);
    return rec.id;
  }

  /**
   * The person retries an action, in the turn of `owner`. Refused while it is
   * under way, once it is done, and after an unknown outcome until its state
   * has been refetched (retryGate).
   */
  retry(owner: object, id: number, snapshot: CitySnapshot): Result<number, string> {
    const rec = this.records.find((r) => r.id === id);
    if (!rec) return err("the action is no longer in the activity log");
    const gate = retryGate(this.entry(rec), snapshot);
    if (!gate.allowed) return err(gate.reason);
    // After an unknown outcome the first request may have been applied: the
    // same key lets gc deduplicate it. After a refusal it was not: a new key.
    if (!(rec.state.kind === "unknown" && rec.spec.idempotent)) rec.key = this.deps.newKey();
    rec.attempt++;
    rec.startedAt = this.deps.clock.now();
    this.send(rec, owner);
    return ok(rec.id);
  }

  /** Refetches what an action changes now ("refresh before retry"). */
  refreshFor(id: number): void {
    const rec = this.records.find((r) => r.id === id);
    if (rec) this.refreshAfter(rec);
  }

  /**
   * Called from a copy's own periodic tick: resolves actions past their
   * deadlines, and polls the outcomes of the actions this copy started.
   */
  tick(owner: object): void {
    if (this.disposed) return;
    const now = this.deps.clock.now();
    for (const rec of [...this.records]) {
      const s = rec.state;
      if (s.kind === "sending" && now - s.since > SEND_DEADLINE_MS) {
        this.resolve(rec, { kind: "unknown", at: now, error: unknown(null, rec.spec.operationId, "timeout", [`no answer within ${Math.round(SEND_DEADLINE_MS / 1000)} s`]) });
      } else if (s.kind === "polling" && now - s.acceptedAt >= OUTCOME_POLL_LIMIT_MS) {
        this.resolve(rec, { kind: "unknown", at: now, error: unknown(s.requestId, rec.spec.operationId, "outcome-poll-expired") });
      } else if (s.kind === "polling" && rec.owner === owner && !s.inFlight && now >= s.nextAt) {
        this.poll(rec, s);
      }
    }
  }

  /**
   * The copy `owner` closed: its actions still under way can no longer learn
   * their outcome (herdr never settles its requests), so they become unknown
   * now. Their queued requests are dropped and never sent. Starts nothing.
   */
  ownerGone(owner: object): void {
    const now = this.deps.clock.now();
    for (const rec of this.records) {
      if (rec.owner !== owner || !isPending(rec.state)) continue;
      this.deps.dropQueued(rec.group);
      const requestId = rec.state.kind === "polling" ? rec.state.requestId : null;
      this.resolve(rec, {
        kind: "unknown", at: now,
        error: unknown(requestId, rec.spec.operationId, "cancelled", ["the Gas City view that started it closed before gc's answer arrived"]),
      });
    }
  }

  /** The store went away: late answers are ignored. */
  dispose(): void {
    this.disposed = true;
  }

  // ---- internals ------------------------------------------------------------------

  private send(rec: ActionRecord, owner: object): void {
    rec.owner = owner;
    rec.group = {};
    const token = ++this.tokens;
    rec.token = token;
    rec.state = { kind: "sending", since: this.deps.clock.now() };
    this.commit();
    let answer: Promise<Result<Sent, GcError>>;
    try {
      answer = rec.spec.send(this.deps.client("mutation", rec.group), this.deps.city, rec.key);
    } catch (cause) {
      answer = Promise.reject(cause);
    }
    answer.then(
      (r) => this.sent(rec, token, r),
      (cause: unknown) => this.sent(rec, token, err(unknown(null, rec.spec.operationId, "unreadable-response", [`the action threw: ${String(cause)}`]))),
    );
  }

  private live(rec: ActionRecord, token: number): boolean {
    return !this.disposed && rec.token === token;
  }

  private sent(rec: ActionRecord, token: number, r: Result<Sent, GcError>): void {
    if (!this.live(rec, token)) return;
    const now = this.deps.clock.now();
    if (!r.ok) {
      if (r.error.kind === "outcome-unknown") this.resolve(rec, { kind: "unknown", at: now, error: r.error });
      else this.resolve(rec, { kind: "failed", at: now, error: r.error });
      return;
    }
    const sent = r.value;
    if (sent.kind === "done") {
      this.resolve(rec, { kind: "done", at: now, detail: sent.detail, requestId: null });
      return;
    }
    rec.state = {
      kind: "polling", requestId: sent.requestId, afterSeq: sent.afterSeq, acceptedAt: now, polls: 0,
      nextAt: now + pollDelay(0), inFlight: false, lastError: null,
    };
    this.commit();
  }

  private poll(rec: ActionRecord, s: Extract<ActionState, { kind: "polling" }>): void {
    const token = rec.token;
    rec.state = { ...s, inFlight: true };
    this.commit();
    ops.getRequestOutcome(this.deps.client("events", rec.group), this.deps.city, s.requestId, s.afterSeq).then(
      (r) => this.polled(rec, token, r),
      (cause: unknown) => this.polled(rec, token, err(unknown(s.requestId, "get-request-outcome", "unreadable-response", [String(cause)]))),
    );
  }

  private polled(rec: ActionRecord, token: number, r: Result<RequestOutcome, GcError>): void {
    const s = rec.state;
    if (!this.live(rec, token) || s.kind !== "polling") return;
    const now = this.deps.clock.now();
    const next = { ...s, inFlight: false, polls: s.polls + 1, nextAt: now + pollDelay(s.polls + 1) };
    if (!r.ok) {
      const e = r.error;
      if (e.kind === "cancelled" || backsOff(e)) {
        rec.state = { ...next, lastError: e };
        this.commit();
        return;
      }
      this.resolve(rec, { kind: "unknown", at: now, error: unknown(s.requestId, rec.spec.operationId, "outcome-poll-failed", [describe(e)]) });
      return;
    }
    const outcome = r.value;
    const failure = outcomeFailure(outcome);
    if (failure?.kind === "outcome-failed") {
      this.resolve(rec, { kind: "failed", at: now, error: failure });
    } else if (failure?.kind === "outcome-unknown") {
      this.resolve(rec, { kind: "unknown", at: now, error: { ...failure, operationId: rec.spec.operationId } });
    } else if (failure !== null) {
      this.resolve(rec, { kind: "unknown", at: now, error: unknown(s.requestId, rec.spec.operationId, "unreadable-response", [describe(failure)]) });
    } else if (outcome.state === "succeeded") {
      this.resolve(rec, { kind: "done", at: now, detail: successDetail(outcome), requestId: s.requestId });
    } else {
      rec.state = { ...next, lastError: null };
      this.commit();
    }
  }

  /** Ends an action and refetches what it changed (a done one too: rig and agent changes are not evented). */
  private resolve(rec: ActionRecord, state: Extract<ActionState, { kind: "done" | "failed" | "unknown" }>): void {
    rec.token = ++this.tokens;
    rec.state = state;
    this.refreshAfter(rec);
    this.trim();
    this.commit();
  }

  private refreshAfter(rec: ActionRecord): void {
    this.deps.refresh(rec.spec.refresh);
    if (rec.spec.target.kind === "session") this.deps.refreshDetail(rec.spec.target.id);
  }

  /** Drops the oldest finished actions beyond ACTIVITY_LIMIT. */
  private trim(): void {
    let excess = this.records.length - ACTIVITY_LIMIT;
    for (let i = 0; i < this.records.length && excess > 0;) {
      if (isPending((this.records[i] as ActionRecord).state)) {
        i++;
        continue;
      }
      this.records.splice(i, 1);
      excess--;
    }
  }

  private entry(rec: ActionRecord): ActionEntry {
    return { id: rec.id, spec: rec.spec, key: rec.key, attempt: rec.attempt, startedAt: rec.startedAt, state: rec.state };
  }

  private commit(): void {
    this.snap = { rev: ++this.rev, entries: this.records.map((r) => this.entry(r)) };
  }
}

/** A short text of an error for an outcome-unknown's issues. */
function describe(e: GcError): string {
  switch (e.kind) {
    case "http":
      return `gc answered ${e.status}${e.problem?.detail ? `: ${e.problem.detail}` : ""}`;
    case "decode":
      return `unreadable answer: ${e.issues.join("; ")}`;
    default:
      return e.kind;
  }
}
