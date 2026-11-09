// The probe document the canary reads: a JSON serialization of the same
// view-models `render` draws, never a separate code path. Pure; the writer
// (src/probe.ts) adds `seq` and `ts` and writes it.

import type { CityMachine } from "../discovery/city.ts";
import type { ActivityModel } from "./activity.ts";
import type { AgentsModel, SessionRow } from "./agents.ts";
import type { BeadCard, BeadDetailModel, BoardModel, ClosedCard } from "./board.ts";
import { cleanLine } from "./sanitize.ts";
import type { DetailModel } from "./detail.ts";
import type { DiagnosticLine } from "./diagnostics.ts";
import type { HeaderModel } from "./header.ts";

/** The probe's schema name; bumped on an incompatible change. */
export const PROBE_SCHEMA = "gascity-herdr-probe/3";

/** A program the mod ran or an app command it ran, as the exec/run log keeps it. */
export interface ExecRecord {
  at: number;
  kind: "exec" | "run";
  argv: string[];
}

export interface ProbeInput {
  modVersion: string;
  herdrVersion: string | null;
  machine: CityMachine;
  header: HeaderModel;
  onScreen: boolean;
  /** This copy holds the keyboard (set by the focus command in a later change). */
  keyboard: boolean;
  agents: AgentsModel | null;
  /** Null until a running city is subscribed. */
  board: BoardModel | null;
  beadDetail: BeadDetailModel;
  detail: DetailModel;
  /** The city's activity log (null without a running city). */
  activity: ActivityModel | null;
  diagnostics: readonly DiagnosticLine[];
  execLog: readonly ExecRecord[];
  refreshCount: number;
  fetchInFlightMax: number;
}

export interface ProbeSession {
  id: string;
  label: string;
  /** The agent row it is listed under; null under "Other sessions". */
  agent: string | null;
  group: string | null;
  status: string;
  status_kind: string;
  status_source: string;
  attached: boolean;
  active_bead: string | null;
}

/** One action as the probe shows it. */
export interface ProbeAction {
  id: number;
  action: string;
  title: string;
  state: string;
  detail: string;
  request_id: string | null;
  attempt: number;
}

export interface ProbeColumn {
  count: string;
  cards: { id: string; title: string; state: string; priority: string | null; assignee: string | null }[];
}

/** The probe document without the writer's `seq` and `ts`. */
export interface ProbeBody {
  schema: typeof PROBE_SCHEMA;
  mod_version: string;
  herdr_version: string | null;
  connection: { text: string; tone: string };
  discovery: { source: string; url: string; version: string } | null;
  city: string | null;
  city_phase: string;
  visibility: { on_screen: boolean };
  keyboard: boolean;
  needs_you: number;
  data_age: string | null;
  sessions: ProbeSession[];
  board: null | {
    filter: string;
    hidden: number;
    ready: ProbeColumn;
    in_progress: ProbeColumn;
    closed: {
      incomplete: boolean;
      /** Closes seen in events, newest close first. */
      recent: { id: string; title: string; seq: number; close_reason: string | null; assignee: string | null }[];
      /** The seed, by creation time. */
      earlier: { id: string; title: string; close_reason: string | null; assignee: string | null }[];
    };
    /** Each column's error line. */
    errors: string[];
  };
  bead_detail: null | { id: string; title: string; state: string; close_reason: string | null; description: string | null };
  detail: null | {
    session: string;
    status: string;
    output: string | null;
    wake_reasons: string;
    pending: unknown;
  };
  /** The city's actions, newest first, with their state and gc's request id. */
  actions: ProbeAction[];
  exec_log: { at: number; kind: string; argv: string[] }[];
  errors: DiagnosticLine[];
  refresh_count: number;
  fetch_in_flight_max: number;
}

function probeSession(r: SessionRow, agent: string | null, group: string | null): ProbeSession {
  return {
    id: r.id,
    label: r.label,
    agent,
    group,
    status: r.status.label,
    status_kind: r.status.kind,
    status_source: r.status.source,
    attached: r.attached,
    active_bead: r.activeBead?.id ?? null,
  };
}

function sessionsOf(agents: AgentsModel | null): ProbeSession[] {
  if (agents === null) return [];
  const out: ProbeSession[] = [];
  for (const g of agents.groups) for (const a of g.agents) for (const r of a.sessions) out.push(probeSession(r, a.name, g.key));
  for (const r of agents.other) out.push(probeSession(r, null, null));
  return out;
}

const card = (c: BeadCard) => ({ id: c.id, title: c.title, state: c.state, priority: c.priority, assignee: c.assignee });
const closed = (c: ClosedCard) => ({ id: c.id, title: c.title, close_reason: c.closeReason, assignee: c.assignee });

function probeBoard(b: BoardModel | null): ProbeBody["board"] {
  if (b === null) return null;
  return {
    filter: b.filter,
    hidden: b.hidden,
    ready: { count: b.ready.count, cards: b.ready.cards.map(card) },
    in_progress: { count: b.inProgress.count, cards: b.inProgress.cards.map(card) },
    closed: {
      incomplete: b.closed.incomplete,
      recent: b.closed.recent.map((c) => ({ id: c.id, title: c.title, seq: c.seq, close_reason: c.closeReason, assignee: c.assignee })),
      earlier: b.closed.earlier.map(closed),
    },
    errors: [b.ready.region.error, b.inProgress.region.error, b.closed.region.error].filter((e): e is string => e !== null),
  };
}

function probeBeadDetail(d: BeadDetailModel): ProbeBody["bead_detail"] {
  if (d.kind !== "bead") return null;
  return { id: d.id, title: d.title, state: d.state, close_reason: d.closeReason, description: d.description };
}

/** The probe document for one copy. */
export function probeDocument(input: ProbeInput): ProbeBody {
  const { machine, header, detail } = input;
  const state = machine.state;
  const endpoint = "endpoint" in state ? state.endpoint : null;
  return {
    schema: PROBE_SCHEMA,
    mod_version: input.modVersion,
    herdr_version: input.herdrVersion,
    connection: { text: header.chip.text, tone: header.chip.tone },
    discovery: endpoint ? { source: endpoint.source, url: endpoint.url, version: cleanLine(endpoint.version) } : null,
    city: state.phase === "city-running" || state.phase === "city-stopped" ? cleanLine(state.city.name) : null,
    city_phase: state.phase,
    visibility: { on_screen: input.onScreen },
    keyboard: input.keyboard,
    needs_you: input.agents?.needsYou ?? 0,
    data_age: input.agents?.region.age ?? null,
    sessions: sessionsOf(input.agents),
    board: probeBoard(input.board),
    bead_detail: probeBeadDetail(input.beadDetail),
    detail: detail.kind !== "session" ? null : {
      session: detail.id,
      status: detail.status.label,
      output: detail.output.text,
      wake_reasons: detail.wakeReasons,
      // The cleaned prompt the pane shows; the raw answer values stay out of the file.
      pending: detail.pending.kind === "prompt"
        ? { kind: "prompt", requestId: detail.pending.requestId, promptKind: detail.pending.promptKind, prompt: detail.pending.prompt, options: detail.pending.options }
        : detail.pending,
    },
    actions: (input.activity?.rows ?? []).map((r) => ({
      id: r.id, action: r.kind, title: r.title, state: r.tone, detail: r.detail, request_id: r.requestId, attempt: r.attempt,
    })),
    exec_log: input.execLog.map((e) => ({ at: e.at, kind: e.kind, argv: [...e.argv] })),
    errors: [...input.diagnostics],
    refresh_count: input.refreshCount,
    fetch_in_flight_max: input.fetchInFlightMax,
  };
}
