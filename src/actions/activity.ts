// What a person's action is and what became of it. An action is one gc API
// call (ActionSpec); the ledger (outcome.ts) sends it, follows a 202 to its
// outcome, and keeps the result as an ActionEntry in the city's activity log.
//
// The states, as the person sees them:
//   sending  – the request is on its way (or queued in the fetch budget);
//   polling  – gc accepted it (202) and the mod is asking for its outcome;
//   watching – gc answered and the action goes on in steps of its own (open
//              terminal: wait until gc says the session runs, open the tab,
//              confirm it in herdr's terminal list), each from its copy's ticks;
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
  | "session.attach"
  | "agent.suspend"
  | "agent.resume"
  | "rig.suspend"
  | "rig.resume"
  | "bead.create"
  | "bead.sling"
  | "bead.close"
  | "bead.reopen";

/** What an action acts on, by gc's own id or name. */
export type ActionTarget =
  | { kind: "session"; id: string }
  | { kind: "agent"; name: string }
  | { kind: "rig"; name: string }
  | { kind: "bead"; id: string }
  /** A bead not created yet, by the title the person gave it. */
  | { kind: "new-bead"; title: string };

/** A question asked before a destructive action is sent. */
export interface Confirmation {
  question: string;
  /** What gc will do, in one or two sentences. */
  detail: string;
}

/**
 * What a sent action's answer says: done now, or accepted (202) with an
 * outcome to follow. `created` is the id gc gave what the action created
 * (a new bead), for a follow-up action.
 */
export type Sent =
  | { kind: "done"; detail: string; created?: string }
  | { kind: "accepted"; requestId: string; afterSeq: string }
  | { kind: "watch"; watch: Watch };

/** How a watched action ends. */
export type WatchEnd =
  | { kind: "done"; detail: string }
  | { kind: "failed"; error: GcError }
  | { kind: "not-sent"; reason: string };

/**
 * An action that goes on after its request, in steps the ledger runs from the
 * ticks of the copy that started it (open terminal). Each step returns the
 * next Watch or how the action ends. Every Watch says how it ends at its
 * deadline (a step in flight then is ignored) and if its copy closes first.
 */
export interface Watch {
  /** What is happening now, for the log, e.g. "waiting for gc to report session sc-20 running". */
  readonly detail: string;
  /** When the next step is due. */
  readonly nextAt: number;
  /** When it ends as `expired`, whatever a step in flight would say. */
  readonly deadline: number;
  readonly expired: WatchEnd;
  /** How it ends when the copy that started it closes first (it is never taken over: its next steps are that copy's). */
  readonly abandoned: WatchEnd;
  /** The next step. Never rejects for a gc or host failure: those are a WatchEnd or the next Watch. */
  step(c: GcClient, city: string): Promise<Watch | WatchEnd>;
}

/**
 * A second action sent once the first one is done, built from what the
 * first created (create a bead, then sling it). It is sent once, from the
 * turn that learned the first is done, and only then: a first action that
 * failed, is unknown or was not sent leaves it unsent, and a retry of the
 * first sends it once that retry is done. It is its own action in the log,
 * with its own outcome and retry; retrying it never repeats the first.
 */
export interface FollowUp {
  /** What it does, as the log names it before it is sent, e.g. "Sling to worker". */
  readonly verb: string;
  /** The action, for the id gc gave what the first action created. */
  spec(created: string): ActionSpec;
}

/** Where an action's follow-up is. */
export type FollowUpState =
  /** Not sent: the first action is not done (yet). */
  | { kind: "waiting" }
  /** Sent as action `id` of the same log. */
  | { kind: "started"; id: number }
  /** Never sent, and never will be: `reason`. */
  | { kind: "not-sent"; reason: string };

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
  /** Sent once this action is done (FollowUp). */
  readonly then?: FollowUp;
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
  /** A watched action between its steps (Watch); `since` is when gc answered its request. */
  | { kind: "watching"; since: number; watch: Watch; inFlight: boolean }
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
  /** The follow-up's state; null for an action without one. */
  readonly followUp: { readonly verb: string; readonly state: FollowUpState } | null;
}

/** The activity log of one city, oldest first; a new object (and rev) per change. */
export interface ActivitySnapshot {
  readonly rev: number;
  readonly entries: readonly ActionEntry[];
}

/** Is the action still under way? */
export function isPending(state: ActionState): state is Extract<ActionState, { kind: "sending" | "polling" | "watching" }> {
  return state.kind === "sending" || state.kind === "polling" || state.kind === "watching";
}

/** A stable key for a target, e.g. "session:sc-20". */
export function targetKey(t: ActionTarget): string {
  switch (t.kind) {
    case "session":
    case "bead":
      return `${t.kind}:${t.id}`;
    case "new-bead":
      return `new-bead:${t.title}`;
    default:
      return `${t.kind}:${t.name}`;
  }
}

/** The target as the activity log names it. */
export function targetText(t: ActionTarget): string {
  switch (t.kind) {
    case "session":
    case "bead":
      return `${t.kind} ${t.id}`;
    case "new-bead":
      return `new bead "${t.title}"`;
    default:
      return `${t.kind} ${t.name}`;
  }
}
