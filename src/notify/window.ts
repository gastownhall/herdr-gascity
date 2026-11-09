// The "needs you" window: the copy herdr opens for `mod.open gascity` (a
// toast's action, or the ctrl-alt-g key fragment), from mod.json's
// `overlay` spec. herdr gives an overlay copy the props {overlay: <id>}, so
// a copy knows it is the window, and closes itself with closeOverlay(id).
//
// Pure.

/** This copy's overlay id when herdr opened it as an overlay (the window), else null. */
export function overlayOf(props: unknown): string | null {
  if (typeof props !== "object" || props === null || Array.isArray(props)) return null;
  const v = (props as Record<string, unknown>)["overlay"];
  return typeof v === "string" && v !== "" ? v : null;
}
