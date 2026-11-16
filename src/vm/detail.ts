// The detail pane of the selected session, pure over one snapshot: what gc
// says about the session, its conversation (gc's transcript, polled while the
// pane is open and on screen: sync/transcript.ts) as plain text, one block
// per turn under its role (a session without a log is one terminal capture), its wake reasons (fetched when the pane opens
// and on refresh: they cost gc a runtime probe), and its pending prompt with
// the options gc lists, in gc's order: they are the answer buttons, nothing is
// hard-coded. The raw ids and options the actions send are kept beside the
// cleaned text the pane shows.

import type * as T from "../gc/types.gen.ts";
import { CADENCE } from "../sync/scheduler.ts";
import { freshness } from "../sync/staleness.ts";
import type { KeepAwakeState } from "../sync/keepAwake.ts";
import type { CitySnapshot, Slot } from "../sync/store.ts";
import { PEEK_LINES, type Transcript } from "../sync/transcript.ts";
import { errorText } from "./errorText.ts";
import { regionModel, type RegionModel } from "./region.ts";
import { cleanLine, cleanText } from "./sanitize.ts";
import { sessionStatus, type Status } from "./status.ts";
import { attachRefusal } from "../terminal/binding.ts";

/** The pending prompt part of the pane. */
export type PendingView =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  /** gc's provider for this session has no pending interactions. */
  | { kind: "unsupported" }
  | { kind: "none" }
  | {
    kind: "prompt";
    requestId: string;
    promptKind: string;
    prompt: string | null;
    /** gc's options, cleaned for display, in gc's order. */
    options: string[];
    /** The request id and options exactly as gc sent them: what an answer sends back. */
    answer: { requestId: string; options: string[] };
  };

/** One turn of the conversation, cleaned; `role` is null for a terminal capture. */
export interface TurnView {
  /** gc's turn id, or its position when gc gives none. */
  key: string;
  role: string | null;
  time: string | null;
  lines: string[];
}

/** The conversation part of the pane. */
export interface OutputView {
  /** null until the first read. */
  turns: TurnView[] | null;
  /** Every turn's text, joined ("(no output)" when there are none): what the probe reports. */
  text: string | null;
  /** Older turns exist that the pane does not show. */
  olderHidden: boolean;
  /** Why the pane shows the terminal instead of the conversation, or null when it shows the conversation. */
  bounded: string | null;
  region: RegionModel;
}

export type DetailModel =
  | { kind: "none" }
  | { kind: "gone"; id: string; text: string }
  | {
    kind: "session";
    id: string;
    /** gc's session id as sent: what actions address. */
    ref: string;
    title: string;
    status: Status;
    /** [label, value] pairs. */
    facts: [string, string][];
    output: OutputView;
    wakeReasons: string;
    /** What keep-awake did while this pane is open (keepAwakeText). */
    keepAwake: string;
    pending: PendingView;
    /** gc says the session's provider can interrupt the running turn with new input. */
    canInterrupt: boolean;
    /** Why Open terminal is not offered (the session's transport has no terminal), or null. */
    noTerminal: string | null;
  };

export interface DetailInput {
  snapshot: CitySnapshot;
  now: number;
  selected: string | null;
  /** What keep-awake did for the selected session; null when it is not watched. */
  keepAwake?: KeepAwakeState | null;
}

/** The pane's keep-awake line. */
export function keepAwakeText(k: KeepAwakeState | null): string {
  if (k === null) return "Keep awake: not watched";
  switch (k.kind) {
    case "checking":
      return "Keep awake: reading gc's wake reasons";
    case "pinning":
      return "Keep awake: pinning";
    case "pinned":
      return "Keep awake: pinned by this pane until it closes";
    case "not-pinned":
      return `Keep awake: ${cleanLine(k.why)}`;
    case "failed":
      return `Keep awake: failed: ${errorText(k.error)}`;
  }
}

function capabilities(c: T.SubmissionCapabilities): string {
  const names: string[] = [];
  if (c.supports_follow_up) names.push("follow-up");
  if (c.supports_interrupt_now) names.push("interrupt");
  if (c.supports_steer) names.push("steer");
  return names.length > 0 ? names.join(", ") : "none";
}

function facts(x: T.SessionResponse): [string, string][] {
  const out: [string, string][] = [
    ["id", x.id],
    ["state", `${x.state}, ${x.running ? "running" : "not running"}`],
    ["provider", x.provider],
  ];
  if (x.transport !== undefined) out.push(["transport", x.transport]);
  out.push(["attached", x.attached ? "yes" : "no"]);
  if (x.active_bead !== undefined && x.active_bead !== "") out.push(["active bead", x.active_bead]);
  if (x.last_active !== undefined) out.push(["last active", x.last_active]);
  if (x.submission_capabilities !== undefined) out.push(["input", capabilities(x.submission_capabilities)]);
  return out.map(([k, v]) => [k, cleanLine(v)]);
}

function wakeText(s: Slot<{ listed: boolean; reasons: readonly string[] }> | undefined): string {
  if (!s || s.value === null) return s?.error ? `unavailable: ${errorText(s.error)}` : "loading";
  if (!s.value.listed) return "gc did not list this session under its template";
  return s.value.reasons.length > 0 ? s.value.reasons.map(cleanLine).join(", ") : "none";
}

function pendingView(s: Slot<T.SessionPendingResponse> | undefined): PendingView {
  if (!s || s.value === null) return s?.error ? { kind: "failed", error: errorText(s.error) } : { kind: "loading" };
  if (!s.value.supported) return { kind: "unsupported" };
  const p = s.value.pending;
  if (!p) return { kind: "none" };
  return {
    kind: "prompt",
    requestId: cleanLine(p.request_id),
    promptKind: cleanLine(p.kind),
    prompt: p.prompt === undefined ? null : cleanText(p.prompt),
    options: p.options.map(cleanLine),
    answer: { requestId: p.request_id, options: [...p.options] },
  };
}

function turnViews(t: Transcript): TurnView[] {
  return t.turns.map((x, i) => ({
    key: x.id !== undefined && x.id !== "" ? cleanLine(x.id) : String(i),
    role: t.format === "text" ? null : cleanLine(x.role),
    time: x.timestamp === undefined ? null : cleanLine(x.timestamp),
    lines: cleanText(x.text).split("\n"),
  }));
}

function outputView(t: Slot<Transcript> | undefined, now: number): OutputView {
  const f = t ? freshness(t, now, { intervalMs: CADENCE.peek.onScreenMs, confirmedAt: null }) : ({ kind: "never", error: null } as const);
  const region = regionModel([["output", f]]);
  if (!t?.value) return { turns: null, text: null, olderHidden: false, bounded: null, region };
  const turns = turnViews(t.value);
  const text = turns.map((x) => x.lines.join("\n")).join("\n");
  const bounded = t.value.bounded ? `the conversation is too large to read here; showing the terminal's last ${PEEK_LINES} lines` : null;
  return { turns, text: text === "" ? "(no output)" : text, olderHidden: t.value.olderHidden, bounded, region };
}

/** The detail pane for the selected session. */
export function detailModel(input: DetailInput): DetailModel {
  const { snapshot: s, now, selected } = input;
  if (selected === null) return { kind: "none" };
  const x = s.sessions.value?.items.find((i) => i.id === selected);
  if (!x) return { kind: "gone", id: cleanLine(selected), text: `session ${cleanLine(selected)} is no longer listed by gc` };
  const p = s.pending.value?.items.find((i) => i.session_id === x.id);
  const label = x.alias ?? x.display_name ?? (x.title !== "" ? x.title : x.session_name);
  const detail = s.details.get(x.id);
  return {
    kind: "session",
    id: cleanLine(x.id),
    ref: x.id,
    title: cleanLine(`${x.agent_name ?? x.template} / ${label}`),
    status: sessionStatus(x, p ? { kind: p.kind, requestId: p.request_id } : null),
    facts: facts(x),
    output: outputView(s.transcripts.get(x.id), now),
    wakeReasons: wakeText(detail?.wakeReasons),
    keepAwake: keepAwakeText(input.keepAwake ?? null),
    pending: pendingView(detail?.pending),
    canInterrupt: x.submission_capabilities?.supports_interrupt_now === true,
    noTerminal: attachRefusal(x.transport),
  };
}
