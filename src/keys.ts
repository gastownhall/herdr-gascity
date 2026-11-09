// The keys a focused copy handles. herdr hands a focusable mod the keyboard
// with pane.go (the copy then gets the bare `focus` command and focuses its
// root); each key calls the same copy method as the button it stands for.
//
// Pure: main.ts routes the root's on_key_down here.

/** What a key does. */
export type KeyAction =
  /** Open the next session's detail, in the agents region's order (clicking its row). */
  | "next-session"
  /** Open the previous session's detail. */
  | "prev-session"
  /** Retry now: refetch everything. */
  | "refresh"
  /** Close the open question or form (Cancel), else the open session's detail (Close). */
  | "back";

/** The key map, by keystroke as GPUI spells it. */
export const KEY_MAP: Readonly<Record<string, KeyAction>> = {
  j: "next-session",
  down: "next-session",
  k: "prev-session",
  up: "prev-session",
  r: "refresh",
  escape: "back",
};

/** The action of a keystroke, or null for a key the copy leaves alone. */
export function keyAction(keystroke: string): KeyAction | null {
  return Object.hasOwn(KEY_MAP, keystroke) ? (KEY_MAP[keystroke] ?? null) : null;
}

/** The session `delta` rows from `current` in `order` (wrapping); the first (or last) when none is open. */
export function moveIn(order: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return delta === 1 ? (order[0] ?? null) : (order[order.length - 1] ?? null);
  return order[(at + delta + order.length) % order.length] ?? null;
}
