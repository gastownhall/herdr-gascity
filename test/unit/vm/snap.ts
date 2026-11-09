// Builders for the view-model tests: a CitySnapshot from plain data, and gc
// records with only the fields a test cares about.

import type { GcError } from "../../../src/gc/errors.ts";
import type * as T from "../../../src/gc/types.gen.ts";
import type {
  AgentList, CitySnapshot, DetailState, PendingList, RigList, SessionList, Slot, WorkList,
} from "../../../src/sync/store.ts";

export const NOW = 2_000_000;

/** A slot fetched `ageMs` ago, optionally with an error since. */
export function slot<V>(value: V | null, opts: { ageMs?: number; error?: GcError; dirty?: boolean; held?: boolean } = {}): Slot<V> {
  return {
    value,
    fetchedAt: value === null && opts.ageMs === undefined ? null : NOW - (opts.ageMs ?? 1000),
    error: opts.error ?? null,
    dirty: opts.dirty ?? false,
    held: opts.held ?? false,
  };
}

/** A slot whose first fetch failed: no data, an error. */
export function failed<V>(error: GcError): Slot<V> {
  return { value: null, fetchedAt: null, error, dirty: false, held: false };
}

export const EMPTY: Slot<never> = { value: null, fetchedAt: null, error: null, dirty: true, held: false };

export function rig(name: string, extra: Partial<T.RigResponse> = {}): T.RigResponse {
  return { name, path: `/rigs/${name}`, suspended: false, agent_count: 0, running_count: 0, ...extra };
}

export function agent(name: string, extra: Partial<T.AgentResponse> = {}): T.AgentResponse {
  return { name, state: "idle", suspended: false, running: true, available: true, ...extra };
}

export function session(id: string, template: string, extra: Partial<T.SessionResponse> = {}): T.SessionResponse {
  return {
    id, title: "", template, session_name: id, provider: "claude", state: "active", running: true, attached: false,
    created_at: "2026-11-09T00:00:00Z", ...extra,
  };
}

export function ready(id: string, title: string, extra: Partial<T.ReadyBead> = {}): T.ReadyBead {
  return { id, title, status: "open", issue_type: "task", labels: [], created_at: "2026-11-09T00:00:00Z", ...extra };
}

export function bead(id: string, title: string, extra: Partial<T.Bead> = {}): T.Bead {
  return { id, title, status: "open", issue_type: "task", labels: [], created_at: "2026-11-09T00:00:00Z", ...extra };
}

export function list<I>(items: I[], extra: { total?: number; partial?: boolean; partial_errors?: string[]; unreadable?: { index: number; id: string | null; error: Extract<GcError, { kind: "decode" }> }[] } = {}) {
  return { items, total: extra.total ?? items.length, partial: extra.partial, partial_errors: extra.partial_errors ?? [], unreadable: extra.unreadable ?? [] };
}

export function sessions(items: T.SessionResponse[], extra: Partial<SessionList> = {}): SessionList {
  return { items, unreadable: [], total: items.length, truncated: false, partial: false, partialErrors: [], ...extra };
}

/** A snapshot with every slot fresh and empty unless given. */
export function snapshot(parts: {
  rigs?: Slot<RigList>;
  agents?: Slot<AgentList>;
  sessions?: Slot<SessionList>;
  pending?: Slot<PendingList>;
  ready?: Slot<WorkList>;
  inProgress?: Slot<WorkList>;
  peeks?: Map<string, Slot<T.SessionResponse>>;
  details?: Map<string, DetailState>;
  beads?: Map<string, Slot<T.Bead>>;
  recent?: { seq: number; bead: T.Bead }[];
  seed?: Slot<WorkList>;
  incomplete?: boolean;
  hiddenClosed?: number;
  events?: Partial<CitySnapshot["events"]>;
  onScreen?: boolean;
  errors?: CitySnapshot["errors"];
  connection?: CitySnapshot["connection"];
  polledAt?: number | null;
  /** When each domain's last good fetch started; by default when it was fetched. */
  fetchStarts?: CitySnapshot["fetchStarts"];
} = {}): CitySnapshot {
  const s: Omit<CitySnapshot, "fetchStarts"> = {
    rev: 1,
    key: { apiUrl: "http://127.0.0.1:8372", city: "scratch" },
    onScreen: parts.onScreen ?? true,
    connection: parts.connection ?? { kind: "connected" },
    events: { cursor: 5, polledAt: parts.polledAt === undefined ? NOW - 500 : parts.polledAt, error: null, held: false, resyncs: 0, ...parts.events },
    rigs: parts.rigs ?? slot(list([])),
    agents: parts.agents ?? slot(list([])),
    sessions: parts.sessions ?? slot(sessions([])),
    pending: parts.pending ?? slot(list([])),
    ready: parts.ready ?? slot({ items: [], unreadable: [] }),
    inProgress: parts.inProgress ?? slot({ items: [], unreadable: [] }),
    closed: { seed: parts.seed ?? slot({ items: [], unreadable: [] }), recent: parts.recent ?? [], incomplete: parts.incomplete ?? false, hidden: parts.hiddenClosed ?? 0 },
    peeks: parts.peeks ?? new Map(),
    details: parts.details ?? new Map(),
    beads: parts.beads ?? new Map(),
    errors: parts.errors ?? [],
  };
  const starts: Record<string, number> = {};
  for (const d of ["rigs", "agents", "sessions", "pending", "ready", "inProgress"] as const) {
    const at = s[d].fetchedAt;
    if (at !== null) starts[d] = at;
  }
  return { ...s, fetchStarts: parts.fetchStarts ?? starts };
}
