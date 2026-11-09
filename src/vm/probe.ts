// The probe document the canary reads: a JSON serialization of the same
// view-models `render` draws, never a separate code path. Pure; the writer
// (src/probe.ts) adds `seq` and `ts` and writes it.

import type { CityMachine } from "../discovery/city.ts";
import type { CitySnapshot } from "../sync/store.ts";
import type { AgentsModel, SessionRow } from "./agents.ts";
import type { DetailModel } from "./detail.ts";
import type { DiagnosticLine } from "./diagnostics.ts";
import type { HeaderModel } from "./header.ts";
import { cleanLine } from "./sanitize.ts";

/** The probe's schema name; bumped on an incompatible change. */
export const PROBE_SCHEMA = "gascity-herdr-probe/2";

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
  snapshot: CitySnapshot | null;
  detail: DetailModel;
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
  board: {
    ready: { id: string; title: string }[];
    in_progress: { id: string; title: string }[];
    closed_ring: { id: string; seq: number; title: string; close_reason: string | null }[];
  };
  detail: null | {
    session: string;
    status: string;
    output: string | null;
    wake_reasons: string;
    pending: unknown;
  };
  actions: never[];
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

const card = (b: { id: string; title: string }) => ({ id: cleanLine(b.id), title: cleanLine(b.title) });

/** The probe document for one copy. */
export function probeDocument(input: ProbeInput): ProbeBody {
  const { machine, header, snapshot: s, detail } = input;
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
    board: {
      ready: (s?.ready.value?.items ?? []).map(card),
      in_progress: (s?.inProgress.value?.items ?? []).map(card),
      closed_ring: (s?.closed.recent ?? []).map((c) => ({
        ...card(c.bead), seq: c.seq, close_reason: c.bead.close_reason === undefined ? null : cleanLine(c.bead.close_reason),
      })),
    },
    detail: detail.kind !== "session" ? null : {
      session: detail.id,
      status: detail.status.label,
      output: detail.output.text,
      wake_reasons: detail.wakeReasons,
      pending: detail.pending,
    },
    actions: [],
    exec_log: input.execLog.map((e) => ({ at: e.at, kind: e.kind, argv: [...e.argv] })),
    errors: [...input.diagnostics],
    refresh_count: input.refreshCount,
    fetch_in_flight_max: input.fetchInFlightMax,
  };
}
