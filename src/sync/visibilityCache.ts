// The app-wide read of "may a gascity view be on screen?" (visibility.ts).
// herdr's guide asks mods not to poll its live data (panes(), focused(),
// layout()): it re-renders a copy whenever that data changes. Every copy
// ticks every TICK_MS, and the answer is per app anyway, so the copies share
// one read:
//   - at most one read per tick window for the whole app, however many copies;
//   - an answer is used for at most VISIBILITY_MAX_AGE_MS;
//   - a render (herdr re-renders a copy after its live data changed, or after
//     the copy notified) makes the next tick window read again.
// One cache per module run (module scope), shared by every copy.

import { TICK_MS } from "./registry.ts";

/** An answer is read again once it is this old, render or not. */
export const VISIBILITY_MAX_AGE_MS = 1_000;

/** One shared, rate-limited read of a host value. */
export class VisibilityCache<T> {
  private last: { at: number; value: T } | null = null;
  private stale = false;

  constructor(private readonly read: () => T) {}

  /** The answer at `now`: the shared one while it is current, else a new read. */
  get(now: number): T {
    const last = this.last;
    if (last !== null) {
      const age = now - last.at;
      if (age >= 0 && (age < TICK_MS || (!this.stale && age < VISIBILITY_MAX_AGE_MS))) return last.value;
    }
    const value = this.read();
    this.last = { at: now, value };
    this.stale = false;
    return value;
  }

  /** herdr re-rendered a copy: its live data may have changed, so read again at the next tick window. */
  invalidate(): void {
    this.stale = true;
  }
}

let shared: VisibilityCache<unknown> | null = null;

/** The app's visibility cache, created on first use (module scope, shared by every copy). */
export function sharedVisibilityCache<T>(create: () => VisibilityCache<T>): VisibilityCache<T> {
  shared ??= create();
  return shared as VisibilityCache<T>;
}
