// The agents panel's view-model, pure over one city snapshot:
//   - grouping: rig (gc's rig list, in its order; then rigs only an agent
//     names) → agent → sessions; the city's own agents under "city";
//   - a session joins the agent named by its agent_name, else by its
//     template; one that matches no agent is listed under "Other sessions",
//     never dropped;
//   - status chips (status.ts) with the city's pending list; an agent row
//     rolls up its most urgent session, or shows its own state without one;
//   - the active bead's title from the board (ready, in progress, recently
//     closed), else from a bead the store fetched by id; never guessed;
//   - a truncated session list says "showing N of M"; gc's partial_errors
//     are shown; an entry that cannot be read is an "unreadable" row;
//   - the region says how old the data is, and keeps stale data with the
//     error above it.
// Every string from gc is cleaned before it reaches the model.

import type { Unreadable } from "../gc/decode.ts";
import type * as T from "../gc/types.gen.ts";
import { domainFreshness, type CitySnapshot, type Slot } from "../sync/store.ts";
import { errorText } from "./errorText.ts";
import { regionModel, type RegionModel } from "./region.ts";
import { cleanLine } from "./sanitize.ts";
import { agentStatus, mostUrgent, sessionStatus, type PendingMark, type Status } from "./status.ts";

/** The group of the city's own (rig-less) agents. */
export const CITY_GROUP = "city";

/** A session's active bead: its title, or why there is none yet. */
export interface ActiveBead {
  id: string;
  title: string | null;
  note: string | null;
}

export interface SessionRow {
  id: string;
  label: string;
  status: Status;
  activeBead: ActiveBead | null;
  /** A terminal is attached (gc's `attached`), shown as an eye. */
  attached: boolean;
  transport: string | null;
  selected: boolean;
}

export interface AgentRow {
  name: string;
  /** gc's qualified agent name as sent: what actions address. */
  ref: string;
  suspended: boolean;
  label: string;
  /** "pool 0–4" for a pool agent. */
  pool: string | null;
  /** The most urgent session's status, or the agent's own without sessions. */
  status: Status;
  sessions: SessionRow[];
}

export interface GroupModel {
  /** "rig:<name>" or "city"; the collapse key. */
  key: string;
  /** gc's rig name as sent, for a rig gc lists (its actions); null for the city group and unlisted rigs. */
  rig: string | null;
  title: string;
  /** "N agents · M running" from gc's rig record; null when gc did not list the rig. */
  counts: string | null;
  suspended: boolean;
  /** The rig is in gc's rig list (an agent may name a rig gc does not list). */
  listed: boolean;
  collapsed: boolean;
  agents: AgentRow[];
}

export interface UnreadableRow {
  kind: "rig" | "agent" | "session" | "pending";
  text: string;
}

export interface AgentsModel {
  region: RegionModel;
  groups: GroupModel[];
  /** Sessions that match no agent. */
  other: SessionRow[];
  unreadable: UnreadableRow[];
  /** Truncation and partial-list notices. */
  banners: string[];
  /** Sessions with a pending interaction ("N need you"). */
  needsYou: number;
  /** Distinct values this pin does not know, for the diagnostics. */
  drift: string[];
}

export interface AgentsInput {
  snapshot: CitySnapshot;
  now: number;
  /** The session whose detail is open. */
  selected: string | null;
  /** Collapsed group keys. */
  collapsed: ReadonlySet<string>;
}

function rigKey(rig: string): string {
  return `rig:${rig}`;
}

function nonEmpty(...values: (string | undefined)[]): string | null {
  for (const v of values) if (v !== undefined && v.trim() !== "") return v;
  return null;
}

function poolText(a: T.AgentResponse): string | null {
  if (a.pool === undefined || a.pool_limits === undefined) return null;
  const { min, max } = a.pool_limits;
  return `pool ${min}–${max < 0 ? "unlimited" : max}`;
}

/** Every board title the snapshot carries, by bead id. */
function boardTitles(s: CitySnapshot): Map<string, string> {
  const titles = new Map<string, string>();
  for (const list of [s.ready.value, s.inProgress.value, s.closed.seed.value]) for (const b of list?.items ?? []) titles.set(b.id, b.title);
  for (const c of s.closed.recent) titles.set(c.bead.id, c.bead.title);
  return titles;
}

function activeBead(id: string | undefined, titles: Map<string, string>, beads: ReadonlyMap<string, Slot<T.Bead>>): ActiveBead | null {
  if (id === undefined || id === "") return null;
  const clean = cleanLine(id);
  const onBoard = titles.get(id);
  if (onBoard !== undefined) return { id: clean, title: cleanLine(onBoard), note: null };
  const fetched = beads.get(id);
  if (fetched?.value) return { id: clean, title: cleanLine(fetched.value.title), note: null };
  if (fetched?.error) return { id: clean, title: null, note: `title unavailable: ${errorText(fetched.error)}` };
  return { id: clean, title: null, note: "loading title" };
}

function unreadableRows(kind: UnreadableRow["kind"], list: readonly Unreadable[]): UnreadableRow[] {
  return list.map((u) => ({
    kind,
    text: `unreadable ${kind} ${u.id === null ? `(entry ${u.index})` : cleanLine(u.id)}: ${errorText(u.error)}`,
  }));
}

function partialBanner(what: string, partial: boolean | undefined, errors: readonly string[]): string[] {
  if (!partial && errors.length === 0) return [];
  const detail = errors.length > 0 ? errors.map(cleanLine).join("; ") : "gc did not say why";
  return [`gc's ${what} list is partial: ${detail}`];
}

/** The agents panel for one snapshot. */
export function agentsModel(input: AgentsInput): AgentsModel {
  const { snapshot: s, now, selected, collapsed } = input;
  const rigs = s.rigs.value?.items ?? [];
  const agents = s.agents.value?.items ?? [];
  const sessionList = s.sessions.value;
  const titles = boardTitles(s);
  const drift = new Set<string>();

  const pending = new Map<string, PendingMark>();
  for (const p of s.pending.value?.items ?? []) pending.set(p.session_id, { kind: p.kind, requestId: p.request_id });

  const row = (x: T.SessionResponse): SessionRow => {
    const status = sessionStatus(x, pending.get(x.id) ?? null);
    if (status.unrecognized !== null) drift.add(status.unrecognized);
    return {
      id: cleanLine(x.id),
      label: cleanLine(nonEmpty(x.alias, x.display_name, x.title, x.session_name) ?? x.id),
      status,
      activeBead: activeBead(x.active_bead, titles, s.beads),
      attached: x.attached,
      transport: x.transport === undefined ? null : cleanLine(x.transport),
      selected: x.id === selected,
    };
  };

  // Join sessions to agents: agent_name first, then template.
  const byName = new Map(agents.map((a) => [a.name, a]));
  const joined = new Map<string, SessionRow[]>();
  const other: SessionRow[] = [];
  for (const x of sessionList?.items ?? []) {
    const owner = (x.agent_name !== undefined ? byName.get(x.agent_name) : undefined) ?? byName.get(x.template);
    if (!owner) {
      other.push(row(x));
      continue;
    }
    const rows = joined.get(owner.name) ?? [];
    rows.push(row(x));
    joined.set(owner.name, rows);
  }

  const agentRow = (a: T.AgentResponse): AgentRow => {
    const rows = joined.get(a.name) ?? [];
    const own = agentStatus(a);
    if (rows.length === 0 && own.unrecognized !== null) drift.add(own.unrecognized);
    return {
      name: cleanLine(a.name),
      ref: a.name,
      suspended: a.suspended,
      label: cleanLine(nonEmpty(a.display_name) ?? a.name),
      pool: poolText(a),
      status: mostUrgent(rows.map((r) => r.status)) ?? own,
      sessions: rows,
    };
  };

  // Groups: listed rigs in gc's order, then rigs only agents name, then the city.
  const groups = new Map<string, GroupModel>();
  const group = (key: string, make: () => Omit<GroupModel, "key" | "collapsed" | "agents">): GroupModel => {
    let g = groups.get(key);
    if (!g) {
      g = { key, ...make(), collapsed: collapsed.has(key), agents: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const r of rigs) {
    group(rigKey(r.name), () => ({
      rig: r.name,
      title: `rig: ${cleanLine(r.name)}`,
      counts: `${r.agent_count} agents · ${r.running_count} running`,
      suspended: r.suspended,
      listed: true,
    }));
  }
  const unlisted = [...new Set(agents.map((a) => a.rig).filter((r): r is string => r !== undefined && r !== "" && !groups.has(rigKey(r))))].sort();
  for (const r of unlisted) group(rigKey(r), () => ({ rig: null, title: `rig: ${cleanLine(r)}`, counts: null, suspended: false, listed: false }));
  for (const a of agents) {
    const key = a.rig !== undefined && a.rig !== "" ? rigKey(a.rig) : CITY_GROUP;
    const g = group(key, () => ({ rig: null, title: "city", counts: null, suspended: false, listed: true }));
    if (!g.collapsed) g.agents.push(agentRow(a));
  }

  const banners: string[] = [];
  if (sessionList?.truncated) {
    banners.push(`showing ${sessionList.items.length + sessionList.unreadable.length} of ${sessionList.total} sessions`);
  }
  banners.push(...partialBanner("rig", s.rigs.value?.partial, s.rigs.value?.partial_errors ?? []));
  banners.push(...partialBanner("agent", s.agents.value?.partial, s.agents.value?.partial_errors ?? []));
  banners.push(...partialBanner("session", sessionList?.partial, sessionList?.partialErrors ?? []));
  banners.push(...partialBanner("pending", s.pending.value?.partial, s.pending.value?.partial_errors ?? []));

  const unreadable = [
    ...unreadableRows("rig", s.rigs.value?.unreadable ?? []),
    ...unreadableRows("agent", s.agents.value?.unreadable ?? []),
    ...unreadableRows("session", sessionList?.unreadable ?? []),
    ...unreadableRows("pending", s.pending.value?.unreadable ?? []),
  ];

  const region = regionModel([
    ["sessions", domainFreshness(s, "sessions", now)],
    ["agents", domainFreshness(s, "agents", now)],
    ["rigs", domainFreshness(s, "rigs", now)],
    ["pending", domainFreshness(s, "pending", now)],
  ]);

  return {
    region,
    groups: [...groups.values()],
    other,
    unreadable,
    banners,
    needsYou: pending.size,
    drift: [...drift],
  };
}
