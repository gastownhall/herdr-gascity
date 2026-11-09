// The shared focus target: which session the "needs you" window should show.
//
// herdr delivers `gascity.<command>` only to copies on screen, so a toast
// cannot tell a hidden copy what to show. Instead, before posting a toast,
// the mod writes the target into herdr's shared state (`gascity.focus`);
// the toast's action (`mod.open`) brings the "needs you" window on screen,
// and that copy applies the newest fresh target on its next tick. Every mod
// re-renders on setShared, so an open window follows a newer target too.
//
// Pure: host.ts reads and writes the shared value.

/** herdr's shared key of the focus target. */
export const FOCUS_KEY = "gascity.focus";
/** A target older than this is ignored (a stale toast clicked hours later shows the plain window). */
export const FOCUS_MAX_AGE_MS = 10 * 60_000;

/** One focus target. `seq` grows with every target written, so the newest wins. */
export interface FocusTarget {
  city: string;
  session: string;
  seq: number;
  /** When it was written (ms since the epoch). */
  at: number;
}

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Decodes the shared value; null when there is none or it is not a target this build wrote. */
export function decodeFocus(value: unknown): FocusTarget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const { city, session, seq, at } = v;
  if (!isText(city) || !isText(session) || !isCount(seq) || !isCount(at)) return null;
  return { city, session, seq, at };
}

/** The next target after `current` (the shared value as read). */
export function nextFocus(current: unknown, city: string, session: string, now: number): FocusTarget {
  return { city, session, seq: (decodeFocus(current)?.seq ?? 0) + 1, at: now };
}

/**
 * The target a copy should apply now: newer than the last one it applied
 * and fresh. Null otherwise.
 */
export function focusToApply(current: unknown, appliedSeq: number, now: number): FocusTarget | null {
  const t = decodeFocus(current);
  if (t === null || t.seq <= appliedSeq) return null;
  if (now - t.at > FOCUS_MAX_AGE_MS || t.at - now > FOCUS_MAX_AGE_MS) return null;
  return t;
}
