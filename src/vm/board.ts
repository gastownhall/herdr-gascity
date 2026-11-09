// The work board's view-model, pure over one city snapshot:
//   - Ready and In progress are gc's bounded /work/ready columns in gc's own
//     order; gc's work list has no total, so a full page says "N+";
//   - Recently closed lists the closes the store saw in events, newest close
//     (event seq) first, then, under an "earlier (by creation time)"
//     divider, the one-time seed: gc has no close time, so the seed is in
//     creation order. A bead is listed once, at its latest close; one that
//     is back in Ready or In progress (reopened) is not listed as closed. At
//     most MAX_CLOSED_RECENT in all;
//   - infrastructure beads (ops.ts INFRASTRUCTURE_BEAD_TYPES) are hidden in
//     every column and counted (the store already keeps them out of the
//     closes it learns from events, and counts them);
//   - each column says how old its data is, keeps stale data with the error
//     above it, and lists entries gc sent that cannot be read;
//   - the selected bead's detail: the card's facts at once, the description
//     once the bead fetched by id arrives.
// Every string from gc is cleaned before it reaches the model.

import type { Unreadable } from "../gc/decode.ts";
import { INFRASTRUCTURE_BEAD_TYPES } from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import { intervalOf } from "../sync/scheduler.ts";
import { freshness, type Freshness } from "../sync/staleness.ts";
import { BOARD_LIMIT, MAX_CLOSED_RECENT, domainFreshness, type CitySnapshot, type Slot, type WorkList } from "../sync/store.ts";
import { errorText } from "./errorText.ts";
import { regionModel, type RegionModel } from "./region.ts";
import { cleanLine, cleanText } from "./sanitize.ts";

/** The bead fields a card reads: common to gc's ReadyBead and Bead. */
type BeadLike = Pick<T.ReadyBead, "id" | "title" | "status" | "issue_type" | "priority" | "assignee" | "labels" | "created_at" | "updated_at" | "close_reason"> & {
  is_blocked?: boolean | undefined;
};

/** One bead on the board. */
export interface BeadCard {
  id: string;
  title: string;
  /** gc's status in words ("in progress"); "blocked" when gc says the bead is blocked. */
  state: string;
  /** "P2"; null when gc gives none. */
  priority: string | null;
  type: string;
  assignee: string | null;
  labels: string[];
  selected: boolean;
}

/** A recently closed bead. */
export interface ClosedCard extends BeadCard {
  closeReason: string | null;
}

/** A close seen in events. */
export interface RecentCard extends ClosedCard {
  /** The bead.closed event's seq: the close order. */
  seq: number;
}

/** What every column shows besides its cards. */
export interface ColumnBase {
  title: string;
  /** "4", or "50+" for a full page. */
  count: string;
  region: RegionModel;
  /** "nothing ready" once the data is in and the column is empty; null otherwise. */
  empty: string | null;
  /** Entries gc sent that cannot be read, worded. */
  unreadable: string[];
  banners: string[];
}

export interface WorkColumn extends ColumnBase {
  cards: BeadCard[];
}

export interface ClosedColumn extends ColumnBase {
  /** Closes seen in events, newest first. */
  recent: RecentCard[];
  /** The seed, by creation time, below `divider`. */
  earlier: ClosedCard[];
  divider: string;
  /** Some closes were not fetched: the list may be missing some. */
  incomplete: boolean;
}

export interface BoardModel {
  /** The type-filter chip: which bead types are hidden. */
  filter: string;
  /** Infrastructure beads hidden: in what gc's lists sent, and among the closes the store saw. */
  hidden: number;
  ready: WorkColumn;
  inProgress: WorkColumn;
  closed: ClosedColumn;
  /** Every column's unreadable rows, for the diagnostics. */
  unreadable: string[];
  /** Distinct values this version does not know, for the diagnostics. */
  drift: string[];
}

export interface BoardInput {
  snapshot: CitySnapshot;
  now: number;
  /** The bead whose detail is open. */
  selected: string | null;
}

export const EARLIER_DIVIDER = "earlier (by creation time)";

const INFRASTRUCTURE: ReadonlySet<string> = new Set(INFRASTRUCTURE_BEAD_TYPES);

const STATES: Readonly<Record<string, string>> = { open: "open", in_progress: "in progress", blocked: "blocked", closed: "closed" };

/** A bead's status in words; one this version does not know is shown as gc sent it and reported. */
export function beadState(status: string, isBlocked: boolean | undefined): { text: string; unrecognized: string | null } {
  if (isBlocked === true) return { text: "blocked", unrecognized: null };
  const known = STATES[status];
  if (known !== undefined) return { text: known, unrecognized: null };
  const raw = cleanLine(status);
  return { text: raw, unrecognized: `bead status ${raw}` };
}

function optional(v: string | undefined): string | null {
  return v === undefined || v.trim() === "" ? null : cleanLine(v);
}

function priorityText(p: number | undefined): string | null {
  return p === undefined ? null : `P${p}`;
}

function isInfrastructure(b: { issue_type: string }): boolean {
  return INFRASTRUCTURE.has(b.issue_type);
}

function unreadableRows(list: readonly Unreadable[]): string[] {
  return list.map((u) => `unreadable bead ${u.id === null ? `(entry ${u.index})` : cleanLine(u.id)}: ${errorText(u.error)}`);
}

/** How current the closed list is: closes arrive by event, so each good event poll confirms it. */
function closedFreshness(s: CitySnapshot, now: number): Freshness {
  return freshness(s.closed.seed, now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt });
}

/** The work board for one snapshot. */
export function boardModel(input: BoardInput): BoardModel {
  const { snapshot: s, now, selected } = input;
  const drift = new Set<string>();
  let hidden = s.closed.hidden;

  const card = (b: BeadLike): BeadCard => {
    const state = beadState(b.status, b.is_blocked);
    if (state.unrecognized !== null) drift.add(state.unrecognized);
    return {
      id: cleanLine(b.id),
      title: cleanLine(b.title),
      state: state.text,
      priority: priorityText(b.priority),
      type: cleanLine(b.issue_type),
      assignee: optional(b.assignee),
      labels: b.labels.map(cleanLine),
      selected: b.id === selected,
    };
  };
  const closedCard = (b: BeadLike): ClosedCard => ({ ...card(b), closeReason: optional(b.close_reason) });
  const shown = <B extends { issue_type: string }>(items: readonly B[]): B[] => {
    const kept = items.filter((b) => !isInfrastructure(b));
    hidden += items.length - kept.length;
    return kept;
  };

  const column = (slot: Slot<WorkList>, title: string, name: string, empty: string, f: Freshness): WorkColumn => {
    const region = regionModel([[name, f]]);
    const cards = shown(slot.value?.items ?? []).map(card);
    const unreadable = unreadableRows(slot.value?.unreadable ?? []);
    const read = slot.value?.items.length ?? 0;
    const rows = read + unreadable.length;
    return {
      title,
      count: rows >= BOARD_LIMIT ? `${rows}+` : `${cards.length}`,
      region,
      empty: region.kind === "ok" && cards.length === 0 && unreadable.length === 0 ? empty : null,
      unreadable,
      banners: [],
      cards,
    };
  };

  const ready = column(s.ready, "Ready", "ready", "nothing ready", domainFreshness(s, "ready", now));
  const inProgress = column(s.inProgress, "In progress", "in progress", "nothing in progress", domainFreshness(s, "inProgress", now));

  // Recently closed: a bead back in a work column was reopened since.
  const open = new Set<string>();
  for (const b of [...(s.ready.value?.items ?? []), ...(s.inProgress.value?.items ?? [])]) open.add(b.id);
  const latest = new Map<string, { seq: number; bead: T.Bead }>();
  for (const c of s.closed.recent) {
    const cur = latest.get(c.bead.id);
    if (!cur || c.seq > cur.seq) latest.set(c.bead.id, c);
  }
  const recent = shown([...latest.values()].map((c) => ({ ...c.bead, seq: c.seq })))
    .filter((b) => !open.has(b.id))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MAX_CLOSED_RECENT)
    .map((b): RecentCard => ({ ...closedCard(b), seq: b.seq }));
  const listed = new Set([...latest.keys()]);
  const earlier = shown(s.closed.seed.value?.items ?? [])
    .filter((b) => !listed.has(b.id) && !open.has(b.id))
    .slice(0, MAX_CLOSED_RECENT - recent.length)
    .map(closedCard);
  const closedRegion = regionModel([["closed", closedFreshness(s, now)]]);
  const closedUnreadable = unreadableRows(s.closed.seed.value?.unreadable ?? []);
  const closed: ClosedColumn = {
    title: "Recently closed",
    count: `${recent.length + earlier.length}`,
    region: closedRegion,
    empty: closedRegion.kind === "ok" && recent.length + earlier.length === 0 && closedUnreadable.length === 0 ? "nothing closed yet" : null,
    unreadable: closedUnreadable,
    banners: s.closed.incomplete ? ["may be incomplete: some closes were not fetched"] : [],
    recent,
    earlier,
    divider: EARLIER_DIVIDER,
    incomplete: s.closed.incomplete,
  };

  return {
    filter: `hiding infrastructure beads (${INFRASTRUCTURE_BEAD_TYPES.join(", ")})`,
    hidden,
    ready,
    inProgress,
    closed,
    unreadable: [...ready.unreadable, ...inProgress.unreadable, ...closed.unreadable],
    drift: [...drift],
  };
}

/** The selected bead's detail. */
export type BeadDetailModel =
  | { kind: "none" }
  /** Neither on the board nor fetched yet (or the fetch failed): `text` says which. */
  | { kind: "missing"; id: string; text: string }
  | {
    kind: "bead";
    id: string;
    title: string;
    state: string;
    /** [label, value] pairs. */
    facts: [string, string][];
    closeReason: string | null;
    /** Plain text, line breaks kept; null until known or when there is none. */
    description: string | null;
    /** Why there is no description: loading, none, or the fetch's error. */
    descriptionNote: string | null;
    region: RegionModel;
  };

/** The board's own copy of a bead, if it shows it. */
function onBoard(s: CitySnapshot, id: string): BeadLike | undefined {
  for (const list of [s.ready.value, s.inProgress.value]) {
    const hit = list?.items.find((b) => b.id === id);
    if (hit) return hit;
  }
  let newest: { seq: number; bead: T.Bead } | undefined;
  for (const c of s.closed.recent) if (c.bead.id === id && (!newest || c.seq > newest.seq)) newest = c;
  return newest?.bead ?? s.closed.seed.value?.items.find((b) => b.id === id);
}

function detailFacts(b: BeadLike, state: string): [string, string][] {
  const out: [string, string][] = [["status", state]];
  const p = priorityText(b.priority);
  if (p !== null) out.push(["priority", p]);
  out.push(["type", b.issue_type]);
  if (b.assignee !== undefined && b.assignee !== "") out.push(["assignee", b.assignee]);
  if (b.labels.length > 0) out.push(["labels", b.labels.join(", ")]);
  out.push(["created", b.created_at]);
  if (b.updated_at !== undefined) out.push(["updated", b.updated_at]);
  return out.map(([k, v]) => [k, cleanLine(v)]);
}

/** The detail of the selected bead: the board's facts, the description from the bead fetched by id. */
export function beadDetailModel(input: BoardInput): BeadDetailModel {
  const { snapshot: s, now, selected } = input;
  if (selected === null) return { kind: "none" };
  const id = cleanLine(selected);
  const fetched = s.beads.get(selected);
  const card = onBoard(s, selected);
  const full = fetched?.value ?? null;
  const source: BeadLike | null = full ? { ...full, is_blocked: card?.is_blocked } : card ?? null;
  if (source === null) {
    return { kind: "missing", id, text: `bead ${id}: ${fetched?.error ? errorText(fetched.error) : "loading"}` };
  }
  let description: string | null = null;
  let descriptionNote: string | null;
  if (full) {
    const text = full.description === undefined ? "" : cleanText(full.description);
    if (text.trim() === "") descriptionNote = "no description";
    else {
      description = text;
      descriptionNote = null;
    }
  } else {
    descriptionNote = fetched?.error ? `description unavailable: ${errorText(fetched.error)}` : "loading description";
  }
  const state = beadState(source.status, source.is_blocked).text;
  const f: Freshness = fetched
    ? freshness(fetched, now, { intervalMs: intervalOf("events", s.onScreen) ?? 0, confirmedAt: s.events.error ? null : s.events.polledAt })
    : { kind: "never", error: null };
  return {
    kind: "bead",
    id,
    title: cleanLine(source.title),
    state,
    facts: detailFacts(source, state),
    closeReason: optional(source.close_reason),
    description,
    descriptionNote,
    region: regionModel([["bead", f]]),
  };
}
