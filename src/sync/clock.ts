// Time for the sync engine, injected so every schedule is testable with a
// fake clock. The engine owns no timer: herdr gives every async host
// operation (fetch, cx.sleep, cx.timer) to the copy whose code is running
// when it starts, and cancels it — its promise never settles — when that copy
// closes. So the engine never sleeps; each copy calls its subscription's
// `tick()` from a periodic timer of its own (registry.ts), and every step
// starts in a live copy's own turn.

/** Milliseconds since some fixed origin. */
export interface Clock {
  now(): number;
}

/** The host's wall clock. */
export const systemClock: Clock = { now: () => Date.now() };
