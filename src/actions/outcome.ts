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
//   - when that copy goes (ownerGone, from its close), an action it was still
//     sending is resolved at once: "not-sent" if its request was still queued
//     (dropped, never sent), else "unknown" (cause "cancelled"); a late answer
//     is ignored, the affected state is refetched by the next tick of any live
//     copy, and nothing is resent;
//   - every step has a deadline (SEND_DEADLINE_MS for the request,
//     OUTCOME_POLL_LIMIT_MS for the outcome), so nothing hangs.
//
// When the owner goes, a request it still had queued is dropped (never sent:
// "not-sent"); one in flight can no longer be observed ("unknown"); and an
// accepted request's outcome is a read gc serves by request id, so the next
// tick of any surviving copy takes over polling it.
//
// Nothing here retries. A retry is a person's explicit act (retry), allowed
// after a definite failure or a request that was never sent, or after an
// unknown outcome once the affected state has been refetched by a request
// started after it became unknown (retryGate). After an unknown outcome a
// retry reuses the action's Idempotency-Key, so gc can deduplicate it where it
// declares the header (gc keeps keys in memory for 30 minutes; a gc restart
// forgets them); where it does not, the retry is a new request.
//
// An action may carry a follow-up (activity.ts FollowUp: create a bead, then
// sling it). The follow-up is started once, as its own action, from the turn
// in which the first action is learned to be done — a turn of the copy that
// owns the first action, so the follow-up's request belongs to a live copy
// and is subject to the same ownership rules. A first action that ends any
// other way leaves its follow-up unsent; it is sent when a retry of the first
// is done. Retrying the follow-up never repeats the first.

import { outcomeFailure, type GcError } from "../gc/errors.ts";
import type { GcClient } from "../gc/client.ts";
import { decodeValue, isUnrecognized } from "../gc/decode.ts";
import * as ops from "../gc/ops.ts";
import {
  SessionCreateSucceededPayloadSchema, SessionMessageSucceededPayloadSchema, SessionSubmitSucceededPayloadSchema,
} from "../gc/schemas.gen.ts";
import type { RequestOutcome } from "../gc/types.gen.ts";
import { err, ok, type Result } from "../result.ts";
import { errorText } from "../vm/errorText.ts";
import { backsOff } from "../sync/backoff.ts";
import { RECLAIM_AFTER_MS, type FetchPriority } from "../sync/budget.ts";
import type { Clock } from "../sync/clock.ts";
import type { Domain } from "../sync/invalidate.ts";
import type { CitySnapshot } from "../sync/store.ts";
import {
  isPending, type ActionEntry, type ActionSpec, type ActionState, type ActivitySnapshot, type FollowUpState, type OutcomeUnknown, type Sent,
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
  /** Drops `group`'s queued requests: they are never sent. Starts nothing. Returns how many. */
  dropQueued(group: object): number;
  /** Refetches these domains at the next tick of any copy. */
  refresh(domains: readonly Domain[]): void;
  /** Refetches a watched session's detail at the next tick. */
  refreshDetail(sessionId: string): void;
  /** Refetches a bead the store fetches by id (a watched or active bead) at the next tick. */
  refreshBead(beadId: string): void;
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
  /** An attempt ended unknown: it may have landed, so every retry keeps the key (ActionEntry.keyPinned). */
  keyPinned: boolean;
  /** The follow-up's state (ActionEntry.followUp). */
  followUp: FollowUpState | null;
  /** The copy whose turn sent the current attempt; null once it closed while the outcome is being polled (any copy's tick polls it). */
  owner: object | null;
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
  if (s.kind === "failed" || s.kind === "not-sent") return { allowed: true };
  for (const d of entry.spec.refresh) {
    // A request started before the outcome became unknown may show the state before the action landed.
    const startedAt = snapshot.fetchStarts[d];
    if (startedAt === undefined || startedAt < s.at) return { allowed: false, reason: `refreshing ${d} before a retry` };
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

  /** Sends a new action now, in the turn of `owner` (the caller's copy), with `key` or a fresh Idempotency-Key. Returns its id. */
  start(owner: object, spec: ActionSpec, key?: string): number {
    const now = this.deps.clock.now();
    const rec: ActionRecord = {
      id: ++this.seq, spec, key: key ?? this.deps.newKey(), attempt: 1, startedAt: now,
      state: { kind: "sending", since: now }, owner, group: {}, token: 0, keyPinned: false,
      followUp: spec.then ? { kind: "waiting" } : null,
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
    // Once any attempt ended unknown it may have been applied: every retry
    // keeps that key so gc can deduplicate it, even after a later attempt was
    // refused or never sent. Without such an attempt a refusal means nothing
    // was applied: a new key.
    if (!(rec.keyPinned && rec.spec.idempotent)) rec.key = this.deps.newKey();
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
        const secs = Math.round(SEND_DEADLINE_MS / 1000);
        // Still queued: drop it, so it is never sent after being reported.
        if (this.deps.dropQueued(rec.group) > 0) this.resolve(rec, { kind: "not-sent", at: now, reason: `the fetch queue did not reach it within ${secs} s` });
        else this.resolve(rec, { kind: "unknown", at: now, error: unknown(null, rec.spec.operationId, "timeout", [`no answer within ${secs} s`]) });
      } else if (s.kind === "polling" && now - s.acceptedAt >= OUTCOME_POLL_LIMIT_MS) {
        this.resolve(rec, { kind: "unknown", at: now, error: unknown(s.requestId, rec.spec.operationId, "outcome-poll-expired") });
      } else if (s.kind === "polling" && (rec.owner === owner || rec.owner === null) && !s.inFlight && now >= s.nextAt) {
        // An orphaned outcome poll is taken over by whichever live copy ticks first.
        rec.owner = owner;
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
      if (rec.owner !== owner) continue;
      const s = rec.state;
      if (s.kind === "polling") {
        // gc serves the outcome by request id: a surviving copy's tick polls it next.
        // The closed copy's poll in flight never settles; its slot is reclaimed.
        this.deps.dropQueued(rec.group);
        rec.owner = null;
        rec.group = {};
        rec.token = ++this.tokens;
        rec.state = { ...s, inFlight: false, nextAt: now };
        this.commit();
      } else if (s.kind === "sending") {
        if (this.deps.dropQueued(rec.group) > 0) {
          this.resolve(rec, { kind: "not-sent", at: now, reason: "the Gas City view that started it closed before it was sent" });
        } else {
          this.resolve(rec, {
            kind: "unknown", at: now,
            error: unknown(null, rec.spec.operationId, "cancelled", ["the Gas City view that started it closed before gc's answer arrived"]),
          });
        }
      }
    }
  }

  /** The store went away: late answers are ignored. */
  dispose(): void {
    this.disposed = true;
  }

  // ---- internals ------------------------------------------------------------------

  private send(rec: ActionRecord, owner: object | null): void {
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
      this.startFollowUp(rec, sent.created);
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
      this.startFollowUp(rec, undefined);
    } else {
      rec.state = { ...next, lastError: null };
      this.commit();
    }
  }

  /** Ends an action and refetches what it changed (a done one too: rig and agent changes are not evented). */
  private resolve(rec: ActionRecord, state: Extract<ActionState, { kind: "done" | "failed" | "unknown" | "not-sent" }>): void {
    rec.token = ++this.tokens;
    rec.state = state;
    if (state.kind === "unknown") rec.keyPinned = true;
    this.refreshAfter(rec);
    this.trim();
    this.commit();
  }

  /**
   * The first action is done: sends its follow-up now, in this turn (the
   * owner's), for the id gc gave what it created. Once only.
   */
  private startFollowUp(rec: ActionRecord, created: string | undefined): void {
    const then = rec.spec.then;
    if (!then || rec.followUp?.kind !== "waiting") return;
    const owner = rec.owner;
    if (created === undefined || owner === null) {
      rec.followUp = {
        kind: "not-sent",
        reason: created === undefined ? "gc's answer did not name what it created" : "no Gas City view was left to send it",
      };
      this.commit();
      return;
    }
    rec.followUp = { kind: "started", id: this.start(owner, then.spec(created)) };
    this.commit();
  }

  private refreshAfter(rec: ActionRecord): void {
    this.deps.refresh(rec.spec.refresh);
    const t = rec.spec.target;
    if (t.kind === "session") this.deps.refreshDetail(t.id);
    if (t.kind === "bead") this.deps.refreshBead(t.id);
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
    return { id: rec.id, spec: rec.spec, key: rec.key, attempt: rec.attempt, startedAt: rec.startedAt, state: rec.state, keyPinned: rec.keyPinned,
      followUp: rec.spec.then && rec.followUp ? { verb: rec.spec.then.verb, state: rec.followUp } : null,
    };
  }

  private commit(): void {
    this.snap = { rev: ++this.rev, entries: this.records.map((r) => this.entry(r)) };
  }
}

/** An error as one line for an outcome-unknown's issues, keeping every detail it has (cause, issues, gc's text). */
function describe(e: GcError): string {
  return errorText(e);
}
