// Checks over what the integration run recorded. Pure: unit-tested with
// synthetic records (test/unit/integration/checks.test.ts).

import type { FetchRecord } from "./herdr.ts";

/** What was true when the mod opened an attach tab. */
export interface AttachMoment {
  sessionId: string;
  /** When tab.new ran. */
  at: number;
  /** gc said the session was running before the mod was asked to open its terminal. */
  wasRunning: boolean;
  /** gc's answer, read by the test right when tab.new ran. */
  runningAtTabNew: boolean;
}

/** `…/session/<id>/wake`. */
function isWakeOf(r: FetchRecord, sessionId: string): boolean {
  if (r.method !== "POST") return false;
  try {
    return new URL(r.url).pathname.endsWith(`/session/${encodeURIComponent(sessionId)}/wake`);
  } catch {
    return false;
  }
}

/**
 * Wake before attach: an attach tab may open only for a session gc reports
 * running, and a session that was not running must have been woken through
 * gc's API (a wake gc accepted, answered before the tab opened). Returns the
 * rules broken (empty: none).
 */
export function wakeBeforeAttach(m: AttachMoment, fetches: readonly FetchRecord[]): string[] {
  const broken: string[] = [];
  if (!m.runningAtTabNew) broken.push(`gc did not report session ${m.sessionId} running when the attach tab opened`);
  if (!m.wasRunning) {
    const woke = fetches.some((r) => isWakeOf(r, m.sessionId) && r.status !== null && r.status >= 200 && r.status < 300 && r.endedAt !== null && r.endedAt <= m.at);
    if (!woke) broken.push(`session ${m.sessionId} was not running and the mod did not wake it through gc's API before opening the tab`);
  }
  return broken;
}

/** Requests started while the endpoint was failing, with more than `limit` in flight at once (the degraded budget). */
export function overBudget(fetches: readonly FetchRecord[], from: number, to: number, limit: number): FetchRecord[] {
  return fetches.filter((r) => r.startedAt >= from && r.startedAt < to && r.concurrent > limit);
}
