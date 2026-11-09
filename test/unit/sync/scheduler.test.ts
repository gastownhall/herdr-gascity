// The cadence table and the pure "what is due, when to wake" planner.

import { describe, expect, test } from "bun:test";
import { CADENCE, DEBOUNCE_MS, intervalOf, plan, type TaskTimes } from "../../../src/sync/scheduler.ts";

const never: TaskTimes = { events: null, sessions: null, peek: null, sweep: null };

describe("cadence", () => {
  test("matches the design's table", () => {
    expect(CADENCE).toEqual({
      events: { onScreenMs: 2000, hiddenMs: 10000 },
      sessions: { onScreenMs: 5000, hiddenMs: 30000 },
      peek: { onScreenMs: 2000, hiddenMs: null },
      sweep: { onScreenMs: 60000, hiddenMs: 60000 },
    });
    expect(DEBOUNCE_MS).toBe(300);
  });

  test("intervalOf picks the visibility column; null means paused", () => {
    expect(intervalOf("events", true)).toBe(2000);
    expect(intervalOf("events", false)).toBe(10000);
    expect(intervalOf("peek", false)).toBeNull();
  });
});

describe("plan", () => {
  test("everything is due on the first run (peek only when watched)", () => {
    expect(plan(never, 0, { onScreen: true, peek: false, extraWakeAt: null }).due).toEqual(["events", "sessions", "sweep"]);
    expect(plan(never, 0, { onScreen: true, peek: true, extraWakeAt: null }).due).toEqual(["events", "sessions", "peek", "sweep"]);
  });

  test("wakes at the earliest next due time on screen", () => {
    const last: TaskTimes = { events: 1000, sessions: 1000, peek: null, sweep: 1000 };
    const p = plan(last, 1500, { onScreen: true, peek: false, extraWakeAt: null });
    expect(p.due).toEqual([]);
    expect(p.wakeAt).toBe(3000);
  });

  test("hidden: slower cadence, peek paused even when watched", () => {
    const last: TaskTimes = { events: 1000, sessions: 1000, peek: 1000, sweep: 1000 };
    const p = plan(last, 3000, { onScreen: false, peek: true, extraWakeAt: null });
    expect(p.due).toEqual([]);
    expect(p.wakeAt).toBe(11000);
    expect(plan(last, 11000, { onScreen: false, peek: true, extraWakeAt: null }).due).toEqual(["events"]);
    expect(plan(last, 31000, { onScreen: false, peek: true, extraWakeAt: null }).due).toEqual(["events", "sessions"]);
  });

  test("an earlier extra wake (a debounced refetch, a backoff retry) wins", () => {
    const last: TaskTimes = { events: 1000, sessions: 1000, peek: null, sweep: 1000 };
    expect(plan(last, 1100, { onScreen: true, peek: false, extraWakeAt: 1400 }).wakeAt).toBe(1400);
    expect(plan(last, 1100, { onScreen: true, peek: false, extraWakeAt: 9000 }).wakeAt).toBe(3000);
  });

  test("becoming visible makes an overdue on-screen task due at once", () => {
    const last: TaskTimes = { events: 1000, sessions: 1000, peek: null, sweep: 1000 };
    expect(plan(last, 4000, { onScreen: false, peek: false, extraWakeAt: null }).due).toEqual([]);
    expect(plan(last, 4000, { onScreen: true, peek: false, extraWakeAt: null }).due).toEqual(["events"]);
  });
});
