// The view-models of the cross-city views, pure over the shared city list
// and the "needs a human" poll (sync/needs.ts):
//
//   - the sidebar block: one row per city (health, running agents), and
//     under it what waits on a person there — questions always, decisions
//     up to SIDEBAR_DECISIONS while the city is folded — so nothing that
//     needs you is one click away. Cities with something waiting come
//     first. Unfolding a city lists all its decisions and its counts;
//   - the Needs a human pane: every city's questions, then decisions, with
//     a filter by kind and by city.
//
// Every string from gc is cleaned before it reaches the model.

import type { CitiesSnapshot } from "../sync/cities.ts";
import type { CityNeeds, NeedsSnapshot } from "../sync/needs.ts";
import { DEFAULT_DECISION_LABEL, HUMAN_LABEL } from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";
import { beadLink, cityLink } from "./dashboardLinks.ts";
import { errorText } from "./errorText.ts";
import { decisionOrder, since } from "./human.ts";
import { cleanLine } from "./sanitize.ts";

/** Decisions listed under a folded city in the sidebar. */
export const SIDEBAR_DECISIONS = 3;

export type Tone = "ok" | "warn" | "bad" | "off";

/** Something waiting on a person, in one city. */
export type NeedRow =
  | { kind: "question"; city: string; session: string; who: string; text: string; age: string | null }
  | {
    kind: "decision"; city: string; bead: string; title: string; priority: string | null; labels: string[]; age: string | null;
    /** Why it is listed: "human", the decision label (e.g. "needs/operator"), "decision" (its type). */
    why: string[];
    /** The bead in the web dashboard; null without one set. */
    link: string | null;
  };

export interface SidebarCity {
  name: string;
  tone: Tone;
  /** "6 running", "stopped", "not read yet". */
  meta: string;
  questions: number;
  decisions: number;
  expanded: boolean;
  /** Questions, then decisions (all of them while expanded, else the first SIDEBAR_DECISIONS). */
  rows: NeedRow[];
  /** Decisions not listed while folded. */
  more: number;
  /** While expanded: the city's counts and health, one line each. */
  details: string[];
  /** The city in the web dashboard; null without one set. */
  link: string | null;
}

export interface SidebarModel {
  /** Questions and decisions across every city. */
  total: number;
  questions: number;
  cities: SidebarCity[];
  /** "loading…" before the city list; why the list or the poll failed. */
  note: string | null;
}

export interface SidebarInput {
  /** The web dashboard to link to (settings dashboardUrl); null: no links. */
  dashboardUrl?: string | null;
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

/** One city's needs, questions first, as rows. */
export function needRows(
  needs: CityNeeds | undefined, city: string, now: number, decisionLabel: string = DEFAULT_DECISION_LABEL, dashboardUrl: string | null = null,
): { questions: NeedRow[]; decisions: NeedRow[] } {
  if (!needs) return { questions: [], decisions: [] };
  const questions: NeedRow[] = needs.waiting.map((w) => ({
    kind: "question",
    city,
    session: cleanLine(w.sessionId),
    who: cleanLine(w.who ?? w.sessionId),
    text: w.prompt !== null && w.prompt.trim() !== "" ? firstLine(w.prompt) : `${cleanLine(w.kind || "question")} (open it to read)`,
    age: since(w.lastActive ?? undefined, now),
  }));
  const decisions: NeedRow[] = [...needs.human]
    .filter((b) => b.status !== "closed" && (needs.reasons.get(b.id)?.length ?? 0) > 0)
    .sort(decisionOrder)
    .map((b) => ({
      kind: "decision",
      city,
      bead: cleanLine(b.id),
      title: cleanLine(b.title),
      priority: typeof b.priority === "number" ? `P${b.priority}` : null,
      labels: (b.labels ?? []).filter((l) => l !== HUMAN_LABEL && l !== decisionLabel).map(cleanLine),
      age: since(b.created_at, now),
      why: (needs.reasons.get(b.id) ?? []).map((r) => cleanLine(r === "operator" ? decisionLabel : r)),
      link: beadLink(dashboardUrl, city, b.id),
    }));
  return { questions, decisions };
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
    const { questions, decisions } = needRows(needs, name, now, input.needs?.decisionLabel, input.dashboardUrl ?? null);
    const expanded = input.expanded.has(info.name);
    const shown = expanded ? decisions : decisions.slice(0, SIDEBAR_DECISIONS);
    const total = needs ? Math.max(needs.humanTotal, decisions.length) : 0;
    return {
      name,
      tone: toneOf(info, needs),
      meta: metaOf(info, needs),
      questions: questions.length,
      decisions: total,
      expanded,
      rows: [...questions, ...shown],
      more: total - shown.length,
      details: expanded ? detailsOf(info, needs) : [],
      link: cityLink(input.dashboardUrl ?? null, name),
    };
  });
  // What waits on a person first (questions weigh most), then by name.
  cities.sort((a, b) => (b.questions - a.questions) || (Math.min(b.decisions, 1) - Math.min(a.decisions, 1)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const pollError = input.needs?.error;
  return {
    total: cities.reduce((n, c) => n + c.questions + c.decisions, 0),
    questions: cities.reduce((n, c) => n + c.questions, 0),
    cities,
    note: pollError ? `gc not reachable: ${errorText(pollError)}` : null,
  };
}

// ---- the Needs a human pane ---------------------------------------------------------

export type InboxFilter = "all" | "questions" | "decisions";

export interface InboxModel {
  filter: InboxFilter;
  /** The city the list is narrowed to; null for every city. */
  city: string | null;
  counts: { all: number; questions: number; decisions: number };
  /** Every city with something waiting, with its count, for the city filter. */
  byCity: { name: string; count: number }[];
  /** "Blocking a live session" (questions), "Waiting on a decision" (beads), each with rows. */
  groups: { title: string; rows: NeedRow[] }[];
  /** Decisions gc has beyond the pages read. */
  notListed: number;
  note: string | null;
  /** The web dashboard (narrowed to the city when one is chosen); null without one set. */
  link: string | null;
}

export interface InboxInput {
  dashboardUrl?: string | null;
  cities: CitiesSnapshot | null;
  needs: NeedsSnapshot | null;
  filter: InboxFilter;
  city: string | null;
  now: number;
}

export function inboxModel(input: InboxInput): InboxModel {
  const running = (input.cities?.value?.items ?? []).filter((c) => c.running).map((c) => c.name).sort();
  const questions: NeedRow[] = [];
  const decisions: NeedRow[] = [];
  const byCity: { name: string; count: number }[] = [];
  let notListed = 0;
  for (const name of running) {
    const needs = input.needs?.cities.get(name);
    const rows = needRows(needs, cleanLine(name), input.now, input.needs?.decisionLabel, input.dashboardUrl ?? null);
    const total = needs ? Math.max(needs.humanTotal, rows.decisions.length) : 0;
    const n = rows.questions.length + total;
    if (n > 0) byCity.push({ name: cleanLine(name), count: n });
    if (input.city !== null && input.city !== name) continue;
    questions.push(...rows.questions);
    decisions.push(...rows.decisions);
    notListed += total - rows.decisions.length;
  }
  const groups: InboxModel["groups"] = [];
  if (input.filter !== "decisions" && questions.length > 0) groups.push({ title: "Blocking a live session", rows: questions });
  if (input.filter !== "questions" && decisions.length > 0) groups.push({ title: "Waiting on a decision", rows: decisions });
  const decisionCount = decisions.length + notListed;
  const pollError = input.needs?.error ?? input.cities?.error ?? null;
  return {
    filter: input.filter,
    city: input.city === null ? null : cleanLine(input.city),
    counts: { all: questions.length + decisionCount, questions: questions.length, decisions: decisionCount },
    byCity,
    groups,
    notListed: input.filter === "questions" ? 0 : notListed,
    note: pollError ? `gc not reachable: ${errorText(pollError)}` : input.needs === null || input.needs.rev === 0 ? "loading…" : null,
    link: input.dashboardUrl == null ? null : input.city !== null ? cityLink(input.dashboardUrl, input.city) : `${input.dashboardUrl}/`,
  };
}
