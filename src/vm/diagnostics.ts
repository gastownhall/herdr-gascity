// The diagnostics drawer: the last failures with their time and where they
// happened (a store domain, the event watcher, a step, the city list, the
// probe writer), newest first, plus the entries gc sent that could not be
// read and the values this version does not know. Pure.

import type { ErrorEntry, SyncError } from "../sync/store.ts";
import { errorText } from "./errorText.ts";
import { cleanLine } from "./sanitize.ts";

/** How many failures the drawer keeps. */
export const DIAGNOSTICS_LIMIT = 100;

export interface DiagnosticLine {
  /** ISO time, seconds precision; null for a standing note. */
  at: string | null;
  source: string;
  text: string;
}

export interface DiagnosticsInput {
  /** Recorded failures, any order. */
  entries: readonly ErrorEntry[];
  /** Distinct unknown values (agents view-model drift). */
  drift: readonly string[];
  /** Unreadable list entries (agents view-model), already worded. */
  unreadable?: readonly string[];
}

/** The text of any failure the sync engine records. */
export function syncErrorText(e: SyncError): string {
  switch (e.kind) {
    case "listener-failed":
      return cleanLine(`an app-wide listener failed: ${e.message}`);
    case "step-crashed":
      return cleanLine(`a refresh step crashed: ${e.message}`);
    case "step-stalled":
      return `a refresh step made no progress for ${Math.round(e.idleMs / 1000)} s and was abandoned`;
    default:
      return errorText(e);
  }
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** The drawer's lines. */
export function diagnosticsModel(input: DiagnosticsInput): DiagnosticLine[] {
  const failures = [...input.entries]
    .sort((a, b) => b.at - a.at)
    .slice(0, DIAGNOSTICS_LIMIT)
    .map((e) => ({ at: iso(e.at), source: cleanLine(e.source), text: syncErrorText(e.error) }));
  const unreadable = (input.unreadable ?? []).map((u) => ({ at: null, source: "gc", text: cleanLine(u) }));
  const drift = input.drift.map((d) => ({ at: null, source: "gc", text: cleanLine(`value this version does not know: ${d}`) }));
  return [...failures, ...unreadable, ...drift];
}
