// "May a gascity view be on screen?". Pure, over host data the
// caller has already decoded. A copy cannot tell which gascity pane is itself
// (panes() carries no props), so the answer is per app and conservative: if
// any gascity view may be on screen, every subscribed city polls at the
// on-screen cadence.

import type { HostFocus, HostPane } from "../host.schemas.ts";

/** This mod's name in herdr (the mod folder and `pane.mod`). */
export const MOD_NAME = "gascity";

/** What the answer depends on. */
export interface VisibilityInput {
  /** shared("gascity.window"): the "needs you" overlay window is open. */
  windowOpen: boolean;
  /** The mod names of the shown layout()'s blocks (docked mods outside tabs). */
  layoutMods: readonly string[];
  /** panes(), decoded. */
  panes: readonly HostPane[];
  /** focused(), decoded; null when nothing is focused. */
  focus: HostFocus | null;
}

/** True if a gascity view may be on screen right now. */
export function mayBeOnScreen(input: VisibilityInput): boolean {
  if (input.windowOpen) return true;
  if (input.layoutMods.includes(MOD_NAME)) return true;
  const focus = input.focus;
  if (focus === null) return false;
  return input.panes.some((p) => p.mod === MOD_NAME && p.tab === focus.tab);
}
