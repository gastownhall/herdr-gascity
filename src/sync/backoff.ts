// Read backoff per gc endpoint: exponential from 1 s to a 60 s
// cap, full jitter within [1 s, ceiling], reset on the next success. Only
// failures that mean gc is not answering back off: transport failures
// (unreachable, timeout), 5xx, and an answer from off the loopback origin
// (herdr's fetch followed a redirect: whatever answered is not gc). Other read
// errors are shown and held until the next sweep or "retry now". Mutations
// never come here: they are never retried automatically.

import type { GcError } from "../gc/errors.ts";

/** The first retry delay. */
export const BACKOFF_BASE_MS = 1_000;
/** The longest retry delay. */
export const BACKOFF_CAP_MS = 60_000;

/** An endpoint that is backing off: the failed attempts so far, when to probe next, and why. */
export interface BackoffState {
  readonly attempt: number;
  readonly retryAt: number;
  readonly cause: GcError;
}

/** The upper bound of the delay before retry number `attempt` (1-based). */
export function backoffCeiling(attempt: number): number {
  const exp = Math.min(Math.max(attempt, 1) - 1, 16);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exp);
}

/** The delay before retry number `attempt`: uniform in [1 s, ceiling] from `random` in [0, 1). */
export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = backoffCeiling(attempt);
  return BACKOFF_BASE_MS + Math.floor(random() * (ceiling - BACKOFF_BASE_MS));
}

/** The state after one more failed read at `now`. */
export function failBackoff(state: BackoffState | null, now: number, cause: GcError, random: () => number): BackoffState {
  const attempt = (state?.attempt ?? 0) + 1;
  return { attempt, retryAt: now + backoffDelay(attempt, random), cause };
}

/** "Retry now": same attempt count, due at `now`. */
export function retryBackoffNow(state: BackoffState, now: number): BackoffState {
  return { ...state, retryAt: now };
}

/** True for a read failure that means gc is not answering at the endpoint: back off instead of holding the domain. */
export function backsOff(error: GcError): boolean {
  switch (error.kind) {
    case "unreachable":
    case "timeout":
    case "not-loopback":
      return true;
    case "http":
      return error.status >= 500;
    default:
      return false;
  }
}
