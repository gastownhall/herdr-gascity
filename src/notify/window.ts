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

/** The open window rewrites its shared flag this often. */
export const WINDOW_REFRESH_MS = 5_000;
/**
 * A flag older than this is stale: shared state is persisted, and a window
 * that died with herdr (a crash, a kill) never cleared it.
 */
export const WINDOW_TTL_MS = 15_000;

/** The shared flag of a window open at `now`. */
export interface WindowFlag {
  open: true;
  at: number;
}

/** The flag the open window writes. */
export function windowFlag(now: number): WindowFlag {
  return { open: true, at: now };
}

/** Whether the shared flag says a window is open now: written by an open window within the TTL. */
export function windowOpenAt(value: unknown, now: number): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const at = v["at"];
  return v["open"] === true && typeof at === "number" && Number.isFinite(at) && Math.abs(now - at) <= WINDOW_TTL_MS;
}
