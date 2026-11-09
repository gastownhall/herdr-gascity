// What a person's action is and what became of it. An action is one gc API
// call (ActionSpec); the ledger (outcome.ts) sends it, follows a 202 to its
// outcome, and keeps the result as an ActionEntry in the city's activity log.
//
// The states, as the person sees them:
//   sending  – the request is on its way (or queued in the fetch budget);
//   polling  – gc accepted it (202) and the mod is asking for its outcome;
//   done     – gc says it happened;
//   failed   – gc says it did not happen (a refusal, or a failed outcome);
//   unknown  – it may or may not have happened: the transport failed, gc
//              answered with a server error or "same key still in flight",
//              the outcome could not be learned in time, or the view that
//              started it closed with the request in flight. The affected
//              state is refetched before a retry;
//   not-sent – it was dropped from the fetch queue before it was sent (its
//              view closed, or the queue did not reach it in time): known
//              not to have happened.
// Nothing here or in the ledger ever retries on its own.

import type { GcClient } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import type { OperationId } from "../gc/operations.gen.ts";
import type { Result } from "../result.ts";
import type { Domain } from "../sync/invalidate.ts";

/** Every action the panel offers. */
export type ActionKind =
  | "session.new"
  | "session.wake"
  | "session.suspend"
  | "session.stop"
  | "session.close"
  | "session.kill"
  | "session.kill-force"
  | "session.pin"
  | "session.unpin"
  | "session.submit"
  | "session.interrupt"
  | "session.message"
  | "session.respond"
  | "agent.suspend"
  | "agent.resume"
  | "rig.suspend"
  | "rig.resume";

/** What an action acts on, by gc's own id or name. */
export type ActionTarget =
  | { kind: "session"; id: string }
  | { kind: "agent"; name: string }
  | { kind: "rig"; name: string };

/** A question asked before a destructive action is sent. */
export interface Confirmation {
  question: string;
  /** What gc will do, in one or two sentences. */
  detail: string;
}

/** What a sent action's answer says: done now, or accepted (202) with an outcome to follow. */
export type Sent =
  | { kind: "done"; detail: string }
  | { kind: "accepted"; requestId: string; afterSeq: string };

/** One action: a single gc API call and what the panel needs to know about it. */
export interface ActionSpec {
  readonly kind: ActionKind;
  /** The button's word, e.g. "Wake"; for an answer, gc's own option text. */
  readonly verb: string;
  readonly target: ActionTarget;
  readonly operationId: OperationId;
  /** gc declares Idempotency-Key on the operation, so a retry with the same key is deduplicated by gc. */
  readonly idempotent: boolean;
  /** Asked first when not null. */
  readonly confirm: Confirmation | null;
  /** The city data to refetch after the action, and before a retry when its outcome is unknown. */
  readonly refresh: readonly Domain[];
  /** Sends the request; `key` goes out only where gc declares Idempotency-Key. Never throws, never retries. */
  send(c: GcClient, city: string, key: string): Promise<Result<Sent, GcError>>;
}

/** An outcome-unknown error. */
export type OutcomeUnknown = Extract<GcError, { kind: "outcome-unknown" }>;

/** Where an action is. */
export type ActionState =
  | { kind: "sending"; since: number }
  | {
    kind: "polling";
    requestId: string;
    afterSeq: string;
    acceptedAt: number;
    polls: number;
    /** When the next outcome poll is due. */
    nextAt: number;
    inFlight: boolean;
    /** The last poll's transport error, if it failed (polling goes on until the deadline). */
    lastError: GcError | null;
  }
  | { kind: "done"; at: number; detail: string; requestId: string | null }
  | { kind: "failed"; at: number; error: GcError }
  | { kind: "unknown"; at: number; error: OutcomeUnknown }
  | { kind: "not-sent"; at: number; reason: string };

/** One action in the activity log. */
export interface ActionEntry {
  readonly id: number;
  readonly spec: ActionSpec;
  /** The Idempotency-Key of the current attempt (reused by a retry after an unknown outcome). */
  readonly key: string;
  readonly attempt: number;
  readonly startedAt: number;
  readonly state: ActionState;
  /**
   * Some attempt ended with an unknown outcome, so it may have landed: every
   * retry keeps `key` from then on, whatever later attempts end as (a later
   * refusal or an unsent retry does not prove the earlier attempt failed).
   */
  readonly keyPinned: boolean;
}

/** The activity log of one city, oldest first; a new object (and rev) per change. */
export interface ActivitySnapshot {
  readonly rev: number;
  readonly entries: readonly ActionEntry[];
}

/** Is the action still under way? */
export function isPending(state: ActionState): state is Extract<ActionState, { kind: "sending" | "polling" }> {
  return state.kind === "sending" || state.kind === "polling";
}

/** A stable key for a target, e.g. "session:sc-20". */
export function targetKey(t: ActionTarget): string {
  return t.kind === "session" ? `session:${t.id}` : `${t.kind}:${t.name}`;
}

/** The target as the activity log names it. */
export function targetText(t: ActionTarget): string {
  return t.kind === "session" ? `session ${t.id}` : `${t.kind} ${t.name}`;
}
