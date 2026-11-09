// The poll cadences and a pure planner over an injected clock:
// given when each task last ran, what is due now and when to wake next.
// Intervals run from the end of the previous run, like cx.timer.every.

/** The store's timed tasks. */
export const TASKS = ["events", "sessions", "peek", "sweep"] as const;
export type Task = (typeof TASKS)[number];

/** Per task: the interval while a gascity view may be on screen, and while none is (null = paused). */
export interface Cadence {
  onScreenMs: number;
  hiddenMs: number | null;
}

/**
 * - events: the short event poll; it runs hidden too, so "needs you" toasts work;
 * - sessions: sessions + pending (program_status changes are not evented);
 * - peek: the open detail's output, paused while hidden;
 * - sweep: every domain, catching missed or unmapped changes.
 */
export const CADENCE: Readonly<Record<Task, Cadence>> = {
  events: { onScreenMs: 2_000, hiddenMs: 10_000 },
  sessions: { onScreenMs: 5_000, hiddenMs: 30_000 },
  peek: { onScreenMs: 2_000, hiddenMs: null },
  sweep: { onScreenMs: 60_000, hiddenMs: 60_000 },
};

/** Event-driven refetches wait this long so a burst of events costs one refetch per domain. */
export const DEBOUNCE_MS = 300;

/** When each task last ran (null: never). */
export type TaskTimes = Record<Task, number | null>;

/** The interval of `task` at the given visibility; null when paused. */
export function intervalOf(task: Task, onScreen: boolean): number | null {
  const c = CADENCE[task];
  return onScreen ? c.onScreenMs : c.hiddenMs;
}

/** What `plan` needs besides the task times. */
export interface PlanInput {
  onScreen: boolean;
  /** A detail pane watches a session's output. */
  peek: boolean;
  /** Another reason to wake (a debounced refetch, a backoff retry), or null. */
  extraWakeAt: number | null;
}

/** The tasks due now, in TASKS order, and the time to wake for the next one. */
export interface Plan {
  due: Task[];
  wakeAt: number;
}

/** Plans one scheduler step at `now`. */
export function plan(last: TaskTimes, now: number, input: PlanInput): Plan {
  const due: Task[] = [];
  let wakeAt = input.extraWakeAt ?? Infinity;
  for (const task of TASKS) {
    if (task === "peek" && !input.peek) continue;
    const interval = intervalOf(task, input.onScreen);
    if (interval === null) continue;
    const ran = last[task];
    const at = ran === null ? now : ran + interval;
    if (at <= now) {
      due.push(task);
      wakeAt = Math.min(wakeAt, now + interval);
    } else {
      wakeAt = Math.min(wakeAt, at);
    }
  }
  return { due, wakeAt };
}
