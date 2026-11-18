// The view-models of the cross-city views, pure over the shared city list
// and the "needs a human" poll (sync/needs.ts):
//
//   - the sidebar block: one row per city (health, running agents), and
//     under it what waits on a person there — questions always, decisions
//     up to SIDEBAR_DECISIONS while the city is folded — so nothing that
//     needs you is one click away. Cities with something waiting come
//     first. Unfolding a city lists all its decisions and its counts;
//   - the Needs a human pane: every city's questions, then approvals, then
//     decisions, with a filter by kind and by city.
//
// Approvals are formula runs waiting at the human-approval gate (a PR waits
// for review before merge; sync/runs.ts says how a gate is read). Only live
// runs are rows; dormant ones (no write for 72 h) are a count. One row per
// thing a person must do: a question on the run's own session absorbs the
// approval (answering is the real action), and the approval absorbs a
// decision bead naming the same PR ("PR #8486" as a whole token).
//
// Every string from gc is cleaned before it reaches the model.

import type { CitiesSnapshot } from "../sync/cities.ts";
import type { CityNeeds, NeedsSnapshot } from "../sync/needs.ts";
import type { RunLane, StageCell } from "../sync/runs.ts";
import { DEFAULT_DECISION_LABEL, HUMAN_LABEL } from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import { beadLink, cityLink, runLink } from "./dashboardLinks.ts";
import { errorText } from "./errorText.ts";
import { decisionOrder, since } from "./human.ts";
import { cleanLine } from "./sanitize.ts";

/** Decisions listed under a folded city in the sidebar. */
export const SIDEBAR_DECISIONS = 3;
/** Approvals listed under a folded city in the sidebar… */
export const SIDEBAR_APPROVALS = 2;
/** …and under an unfolded one. */
export const SIDEBAR_APPROVALS_OPEN = 20;
/** Approvals listed in the Needs a human pane (the rest: a count). */
export const INBOX_APPROVALS = 30;

/** A run's strip, for a row. */
export interface RunMark {
  ref: string | null;
  cells: StageCell[];
  /** The run in the runs dashboard (factory); null without one set. */
  link: string | null;
}

export type Tone = "ok" | "warn" | "bad" | "off";

/** Something waiting on a person, in one city. */
export type NeedRow =
  | {
    kind: "question"; city: string; session: string; who: string; text: string; age: string | null;
    /** The run this session runs, when it is waiting at the approval gate (its approval row is folded in here). */
    run: RunMark | null;
  }
  | {
    kind: "approval"; city: string; run: string; ref: string | null; title: string; rig: string | null;
    cells: StageCell[]; stage: string | null; age: string | null;
    /** The run in the runs dashboard (factory); null without one set. */
    link: string | null;
    /** The session running it: what Answer attaches to; null when gc names none. */
    session: string | null;
    /** Decision beads for the same PR, folded in ("ga-4k2 needs/operator"). */
    also: string[];
  }
  | {
    kind: "decision"; city: string; bead: string; title: string; priority: string | null; labels: string[]; age: string | null;
    /** Why it is listed: "human", the decision label (e.g. "needs/operator"), "decision" (its type). */
    why: string[];
    /**
     * The bead in the web dashboard: only for beads with the decision label
     * (mdash's queue); the others are answered here (a session, a bead's
     * Close…). Null without a dashboard set.
     */
    link: string | null;
  };

/** A city's runs in one line: "23 runs · 19 await approval", with the strip most of them share. */
export interface RunsLine {
  live: number;
  approvals: number;
  /** The most common stage strip among the live runs. */
  cells: StageCell[];
  partial: boolean;
}

export interface SidebarCity {
  name: string;
  /** Its runs, when gc reports any; null otherwise. */
  runs: RunsLine | null;
  /** Approvals (live runs at the gate), after folding in questions. */
  approvals: number;
  tone: Tone;
  /** "6 running", "stopped", "not read yet". */
  meta: string;
  questions: number;
  decisions: number;
  expanded: boolean;
  /** Questions, approvals, then decisions (all while expanded, else the first SIDEBAR_APPROVALS and SIDEBAR_DECISIONS). */
  rows: NeedRow[];
  /** Decisions not listed while folded. */
  more: number;
  /** Approvals not listed. */
  moreApprovals: number;
  /** While expanded: the city's counts and health, one line each. */
  details: string[];
  /** The city in the web dashboard; null without one set. */
  link: string | null;
}

export interface SidebarModel {
  /** Questions, approvals and decisions across every city. */
  total: number;
  questions: number;
  cities: SidebarCity[];
  /** "loading…" before the city list; why the list or the poll failed. */
  note: string | null;
}

export interface SidebarInput {
  /** The web dashboard to link to (settings dashboardUrl); null: no links. */
  dashboardUrl?: string | null;
  /** The runs dashboard to link runs to (settings runsUrl, factory); null: no run links. */
  runsUrl?: string | null;
  cities: CitiesSnapshot | null;
  needs: NeedsSnapshot | null;
  expanded: ReadonlySet<string>;
  now: number;
}

/** The first line of a prompt, cut to `max` characters. */
export function firstLine(text: string, max = 120): string {
  const line = cleanLine(text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** "PR #8486: fix(dolt): …" → "fix(dolt): …" when the ref already says it. */
function runTitle(lane: RunLane): string {
  const title = cleanLine(lane.title);
  const ref = lane.ref === null ? null : cleanLine(lane.ref);
  return ref !== null && title.startsWith(`${ref}: `) ? title.slice(ref.length + 2) : title;
}

function updatedMs(lane: RunLane): number {
  const t = lane.updatedAt === null ? Number.NaN : Date.parse(lane.updatedAt);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** "PR #8486" as a whole token in a title. */
function namesRef(title: string, ref: string): boolean {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w#])${escaped}(?![\\d])`).test(title);
}

/** One city's rows, after folding: questions, approvals (longest wait first), decisions; and its dormant approvals. */
export interface CityRows {
  questions: NeedRow[];
  approvals: NeedRow[];
  decisions: NeedRow[];
  /** Runs at the gate with no write for 72 h. */
  dormantApprovals: number;
}

/** One city's needs as rows. */
export function needRows(
  needs: CityNeeds | undefined, city: string, now: number, decisionLabel: string = DEFAULT_DECISION_LABEL, dashboardUrl: string | null = null,
  runsUrl: string | null = null,
): CityRows {
  if (!needs) return { questions: [], approvals: [], decisions: [], dormantApprovals: 0 };
  const lanes = needs.runs?.lanes ?? [];
  const gated = lanes.filter((l) => l.gate && !l.dormant).sort((a, b) => updatedMs(a) - updatedMs(b));
  const bySession = new Map(gated.filter((l) => l.session !== null).map((l) => [l.session as string, l]));
  const folded = new Set<string>();
  const questions: NeedRow[] = needs.waiting.map((w) => {
    const lane = bySession.get(w.sessionId);
    if (lane) folded.add(lane.id);
    return {
      kind: "question",
      city,
      session: cleanLine(w.sessionId),
      who: cleanLine(w.who ?? w.sessionId),
      text: w.prompt !== null && w.prompt.trim() !== "" ? firstLine(w.prompt) : `${cleanLine(w.kind || "question")} (open it to read)`,
      age: since(w.lastActive ?? undefined, now),
      run: lane ? { ref: lane.ref === null ? null : cleanLine(lane.ref), cells: lane.cells, link: runLink(runsUrl, city, lane.id) } : null,
    };
  });
  const approvals = gated.filter((l) => !folded.has(l.id)).map((l): Extract<NeedRow, { kind: "approval" }> => ({
    kind: "approval",
    city,
    run: cleanLine(l.id),
    ref: l.ref === null ? null : cleanLine(l.ref),
    title: runTitle(l),
    rig: l.rig === null ? null : cleanLine(l.rig),
    cells: l.cells,
    stage: l.stageLabel === null ? null : cleanLine(l.stageLabel),
    age: since(l.updatedAt ?? undefined, now),
    link: runLink(runsUrl, city, l.id),
    session: l.session === null ? null : cleanLine(l.session),
    also: [],
  }));
  const decisions: NeedRow[] = [];
  for (const b of [...needs.human].filter((x) => x.status !== "closed" && (needs.reasons.get(x.id)?.length ?? 0) > 0).sort(decisionOrder)) {
    const why = (needs.reasons.get(b.id) ?? []).map((r) => cleanLine(r === "operator" ? decisionLabel : r));
    const title = cleanLine(b.title);
    const same = approvals.find((a) => a.kind === "approval" && a.ref !== null && namesRef(title, a.ref));
    if (same && same.kind === "approval") {
      same.also.push(`${cleanLine(b.id)} ${why.join(" + ")}`.trim());
      continue;
    }
    decisions.push({
      kind: "decision",
      city,
      bead: cleanLine(b.id),
      title,
      priority: typeof b.priority === "number" ? `P${b.priority}` : null,
      labels: (b.labels ?? []).filter((l) => l !== HUMAN_LABEL && l !== decisionLabel).map(cleanLine),
      age: since(b.created_at, now),
      why,
      link: needs.reasons.get(b.id)?.includes("operator") ? beadLink(dashboardUrl, city, b.id) : null,
    });
  }
  return { questions, approvals, decisions, dormantApprovals: lanes.filter((l) => l.gate && l.dormant).length };
}

/** The strip most of a city's live runs share (ties: the one first seen). */
function modalStrip(lanes: readonly RunLane[]): StageCell[] {
  const counts = new Map<string, { n: number; cells: StageCell[] }>();
  for (const l of lanes) {
    const key = l.cells.join(",");
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { n: 1, cells: l.cells });
  }
  let best: { n: number; cells: StageCell[] } | null = null;
  for (const c of counts.values()) if (best === null || c.n > best.n) best = c;
  return best?.cells ?? [];
}

function runsLineOf(needs: CityNeeds | undefined, approvals: number): RunsLine | null {
  const runs = needs?.runs;
  if (!runs) return null;
  const live = runs.lanes.filter((l) => !l.dormant);
  if (live.length === 0 && runs.live === 0) return null;
  return { live: runs.live, approvals, cells: modalStrip(live), partial: runs.partial };
}

function toneOf(info: T.CityInfo, needs: CityNeeds | undefined): Tone {
  if (!info.running) return "off";
  if (info.error) return "bad";
  const s = needs?.status;
  if (needs?.error || s?.partial || s?.suspended || (s?.agents.quarantined ?? 0) > 0) return "warn";
  return "ok";
}

function metaOf(info: T.CityInfo, needs: CityNeeds | undefined): string {
  if (!info.running) return cleanLine(info.status || "stopped");
  const s = needs?.status;
  return s ? `${count(s.agents.running)} running` : "not read yet";
}

function detailsOf(info: T.CityInfo, needs: CityNeeds | undefined): string[] {
  const out: string[] = [];
  if (info.error) out.push(`gc: ${cleanLine(info.error)}`);
  const s = needs?.status;
  if (s) {
    out.push(`Agents: ${count(s.agents.running)} of ${count(s.agents.total)} running${s.agents.suspended ? ` · ${count(s.agents.suspended)} suspended` : ""}${s.agents.quarantined ? ` · ${count(s.agents.quarantined)} quarantined` : ""}`);
    out.push(`Rigs: ${count(s.rigs.total)}${s.rigs.suspended ? ` · ${count(s.rigs.suspended)} suspended` : ""}`);
    out.push(`Work: ${count(s.work.in_progress)} in progress · ${count(s.work.ready)} ready`);
    if (s.suspended) out.push("City suspended");
    if (s.partial) out.push(`Partial: ${s.partial_errors.map((e) => firstLine(e, 90)).join("; ") || "gc did not say why"}`);
  }
  if (needs?.error) out.push(`Last read failed: ${errorText(needs.error)}`);
  return out;
}

export function sidebarModel(input: SidebarInput): SidebarModel {
  const { now } = input;
  const list = input.cities?.value?.items ?? null;
  if (list === null) {
    const e = input.cities?.error;
    return { total: 0, questions: 0, cities: [], note: e ? `gc not reachable: ${errorText(e)}` : "loading…" };
  }
  const cities = list.map((info): SidebarCity => {
    const name = cleanLine(info.name);
    const needs = input.needs?.cities.get(info.name);
    const { questions, approvals, decisions } = needRows(needs, name, now, input.needs?.decisionLabel, input.dashboardUrl ?? null, input.runsUrl ?? null);
    const expanded = input.expanded.has(info.name);
    const shownApprovals = approvals.slice(0, expanded ? SIDEBAR_APPROVALS_OPEN : SIDEBAR_APPROVALS);
    const shown = expanded ? decisions : decisions.slice(0, SIDEBAR_DECISIONS);
    // gc's count of decision beads, less the ones folded into approvals.
    const folded = approvals.reduce((n, a) => n + (a.kind === "approval" ? a.also.length : 0), 0);
    const total = needs ? Math.max(needs.humanTotal - folded, decisions.length) : 0;
    return {
      name,
      runs: runsLineOf(needs, approvals.length),
      approvals: approvals.length,
      tone: toneOf(info, needs),
      meta: metaOf(info, needs),
      questions: questions.length,
      decisions: total,
      expanded,
      rows: [...questions, ...shownApprovals, ...shown],
      more: total - shown.length,
      moreApprovals: approvals.length - shownApprovals.length,
      details: expanded ? detailsOf(info, needs) : [],
      link: cityLink(input.dashboardUrl ?? null, name),
    };
  });
  // What waits on a person first (questions weigh most, then approvals), then by name.
  const rank = (c: SidebarCity) => [c.questions, c.approvals, Math.min(c.decisions, 1)];
  cities.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const pollError = input.needs?.error;
  return {
    total: cities.reduce((n, c) => n + c.questions + c.approvals + c.decisions, 0),
    questions: cities.reduce((n, c) => n + c.questions, 0),
    cities,
    note: pollError ? `gc not reachable: ${errorText(pollError)}` : null,
  };
}

// ---- the Needs a human pane ---------------------------------------------------------

export type InboxFilter = "all" | "questions" | "approvals" | "decisions";

export interface InboxModel {
  filter: InboxFilter;
  /** The city the list is narrowed to; null for every city. */
  city: string | null;
  counts: { all: number; questions: number; approvals: number; decisions: number };
  /** Every city with something waiting, with its count, for the city filter. */
  byCity: { name: string; count: number }[];
  /** "Blocking a live session" (questions), "Waiting for your approval" (runs), "Waiting on a decision" (beads). */
  groups: { title: string; rows: NeedRow[] }[];
  /** Approvals beyond INBOX_APPROVALS. */
  moreApprovals: number;
  /** Runs at the gate with no write for 72 h, not listed. */
  dormantApprovals: number;
  /** Decisions gc has beyond the pages read. */
  notListed: number;
  note: string | null;
  /** The web dashboard (narrowed to the city when one is chosen); null without one set. */
  link: string | null;
}

export interface InboxInput {
  dashboardUrl?: string | null;
  runsUrl?: string | null;
  cities: CitiesSnapshot | null;
  needs: NeedsSnapshot | null;
  filter: InboxFilter;
  city: string | null;
  now: number;
}

export function inboxModel(input: InboxInput): InboxModel {
  const running = (input.cities?.value?.items ?? []).filter((c) => c.running).map((c) => c.name).sort();
  const questions: NeedRow[] = [];
  const approvals: NeedRow[] = [];
  const decisions: NeedRow[] = [];
  const byCity: { name: string; count: number }[] = [];
  let notListed = 0;
  let dormantApprovals = 0;
  for (const name of running) {
    const needs = input.needs?.cities.get(name);
    const rows = needRows(needs, cleanLine(name), input.now, input.needs?.decisionLabel, input.dashboardUrl ?? null, input.runsUrl ?? null);
    const folded = rows.approvals.reduce((n, a) => n + (a.kind === "approval" ? a.also.length : 0), 0);
    const total = needs ? Math.max(needs.humanTotal - folded, rows.decisions.length) : 0;
    const n = rows.questions.length + rows.approvals.length + total;
    if (n > 0) byCity.push({ name: cleanLine(name), count: n });
    if (input.city !== null && input.city !== name) continue;
    questions.push(...rows.questions);
    approvals.push(...rows.approvals);
    decisions.push(...rows.decisions);
    notListed += total - rows.decisions.length;
    dormantApprovals += rows.dormantApprovals;
  }
  // Longest wait first across cities.
  approvals.sort((a, b) => ageRank(b) - ageRank(a));
  const shownApprovals = approvals.slice(0, INBOX_APPROVALS);
  const groups: InboxModel["groups"] = [];
  const want = (f: InboxFilter) => input.filter === "all" || input.filter === f;
  if (want("questions") && questions.length > 0) groups.push({ title: "Blocking a live session", rows: questions });
  if (want("approvals") && shownApprovals.length > 0) groups.push({ title: "Waiting for your approval — a PR waits for review before merge", rows: shownApprovals });
  if (want("decisions") && decisions.length > 0) groups.push({ title: "Waiting on a decision", rows: decisions });
  const decisionCount = decisions.length + notListed;
  const pollError = input.needs?.error ?? input.cities?.error ?? null;
  return {
    filter: input.filter,
    city: input.city === null ? null : cleanLine(input.city),
    counts: { all: questions.length + approvals.length + decisionCount, questions: questions.length, approvals: approvals.length, decisions: decisionCount },
    byCity,
    groups,
    moreApprovals: want("approvals") ? approvals.length - shownApprovals.length : 0,
    dormantApprovals: want("approvals") ? dormantApprovals : 0,
    notListed: want("decisions") ? notListed : 0,
    note: pollError ? `gc not reachable: ${errorText(pollError)}` : input.needs === null || input.needs.rev === 0 ? "loading…" : null,
    link: input.dashboardUrl == null ? null : input.city !== null ? cityLink(input.dashboardUrl, input.city) : `${input.dashboardUrl}/`,
  };
}

/** How long an approval has waited, for ordering ("3 d" > "5 h"); rows without an age last. */
function ageRank(r: NeedRow): number {
  const m = r.age === null ? null : /^(\d+) (s|min|h|d)$/.exec(r.age);
  if (m === null) return -1;
  const unit = { s: 1, min: 60, h: 3600, d: 86400 }[m[2] as "s" | "min" | "h" | "d"];
  return Number(m[1]) * unit;
}
