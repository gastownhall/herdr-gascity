// The status chip of a session or agent, a pure function of gc's data.
// Precedence, most specific first:
//   1. a pending interaction (from the city's /pending list) → needs you;
//   2. a lifecycle state other than "active" (suspended, asleep, …) → that
//      state with gc's reason: a session that is not live is not working;
//   3. program_status.state → that state (+ kind, progress, app);
//   4. no program_status → the transcript's activity ("in-turn" → working,
//      "idle" → idle), marked "(transcript)";
//   5. neither → unknown. gc's contract: an absent program_status means
//      unknown, never idle.
// A roll-up (agent row, rig) takes the most urgent child, as herdr's own
// agent roll-up does (blocked > working > idle).
// Values this pin does not know are shown raw and flagged (`unrecognized`)
// for the diagnostics, never dropped.

import { isUnrecognized, type Drift } from "../gc/decode.ts";
import type { AgentResponse, SessionResponse } from "../gc/types.gen.ts";
import { cleanLine } from "./sanitize.ts";

export type StatusKind = "needs-you" | "blocked" | "error" | "working" | "done" | "idle" | "unknown" | "lifecycle";

/** A status chip. */
export interface Status {
  kind: StatusKind;
  /** The chip's text. */
  label: string;
  /** Which of gc's fields decided it. */
  source: "pending" | "lifecycle" | "program" | "transcript" | "none";
  /** Progress, app, gc's reason; null when there is nothing to add. */
  detail: string | null;
  /** A value this pin does not know ("<field> <raw>"), for the diagnostics. */
  unrecognized: string | null;
}

/** The session fields the status reads. */
export type StatusInput = Pick<SessionResponse, "state" | "running" | "reason" | "program_status" | "activity">;

/** A pending interaction from the city's /pending list. */
export interface PendingMark {
  kind: string;
  requestId: string;
}

/** Lifecycle states shown as the primary chip, with their label; "active" is not one. */
const LIFECYCLE: Readonly<Record<string, string>> = {
  suspended: "suspended",
  quarantined: "quarantined",
  stopped: "stopped",
  draining: "draining",
  asleep: "asleep",
  creating: "starting",
  closing: "closing",
  archived: "archived",
};

const ACTIVE = "active";

const URGENCY: Readonly<Record<StatusKind, number>> = {
  "needs-you": 0, blocked: 1, error: 2, working: 3, done: 4, idle: 5, unknown: 6, lifecycle: 7,
};

function status(kind: StatusKind, label: string, source: Status["source"], detail: string | null = null, unrecognized: string | null = null): Status {
  return { kind, label: cleanLine(label), source, detail: detail === null ? null : cleanLine(detail), unrecognized: unrecognized === null ? null : cleanLine(unrecognized) };
}

function drift(value: Drift<string>): string {
  return isUnrecognized(value) ? value.raw : value;
}

function fromProgram(p: NonNullable<SessionResponse["program_status"]>): Status {
  const details: string[] = [];
  if (p.progress !== undefined) details.push(`${p.progress}%`);
  if (p.app !== undefined && p.app !== "") details.push(p.app);
  const detail = details.length > 0 ? details.join(" · ") : null;
  if (isUnrecognized(p.state)) return status("unknown", `unknown (${p.state.raw})`, "program", detail, `program_status.state ${p.state.raw}`);
  const kind = p.kind === undefined ? null : drift(p.kind);
  const unrecognized = p.kind !== undefined && isUnrecognized(p.kind) ? `program_status.kind ${p.kind.raw}` : null;
  const label = kind === null ? p.state : `${p.state} (${kind})`;
  return status(p.state, label, "program", detail, unrecognized);
}

function fromActivity(activity: string | undefined, detail: string | null): Status {
  if (activity === "in-turn") return status("working", "working (transcript)", "transcript", detail);
  if (activity === "idle") return status("idle", "idle (transcript)", "transcript", detail);
  if (activity !== undefined && activity !== "") return status("unknown", `unknown (${activity})`, "transcript", detail, `activity ${activity}`);
  return status("unknown", "unknown", "none", detail);
}

/** What a live program says about itself: program_status, else the transcript, else unknown. */
function liveStatus(x: Pick<StatusInput, "program_status" | "activity">, detail: string | null = null): Status {
  if (x.program_status !== undefined) return fromProgram(x.program_status);
  return fromActivity(x.activity, detail);
}

/** A session's chip; `pending` from the city's /pending list. */
export function sessionStatus(s: StatusInput, pending: PendingMark | null): Status {
  if (pending !== null) return status("needs-you", `needs you (${pending.kind})`, "pending");
  if (s.state !== ACTIVE) {
    const known = LIFECYCLE[s.state];
    return status("lifecycle", known ?? s.state, "lifecycle", s.reason ?? null, known === undefined ? `state ${s.state}` : null);
  }
  return liveStatus(s);
}

/** The chip of an agent that has no sessions listed. */
export function agentStatus(a: AgentResponse): Status {
  if (a.suspended) return status("lifecycle", "suspended", "lifecycle", a.unavailable_reason ?? null);
  if (!a.running) return status("lifecycle", LIFECYCLE[a.state] ?? "not running", "lifecycle", a.unavailable_reason ?? null);
  const unavailable = !a.available ? `unavailable${a.unavailable_reason ? `: ${a.unavailable_reason}` : ""}` : null;
  const live = liveStatus(a, unavailable);
  return unavailable !== null && live.detail === null ? { ...live, detail: cleanLine(unavailable) } : live;
}

/** Lower is more urgent. */
export function urgency(s: Status): number {
  return URGENCY[s.kind];
}

/** The most urgent status (the first on a tie), or null for none. */
export function mostUrgent(list: readonly Status[]): Status | null {
  let best: Status | null = null;
  for (const s of list) if (best === null || urgency(s) < urgency(best)) best = s;
  return best;
}
