// The Needs-a-human view-model, pure over one city snapshot: everything in
// the city that waits on a person, in one list at the top of the panel.
//
//   - Questions: gc's pending interactions (a session paused on a question or
//     a tool approval). They come first: each one holds a live session.
//     gc's city-wide list carries no prompt and no time, so a row names the
//     session and the kind; selecting it opens the session's detail, which
//     fetches the prompt and offers one answer button per option.
//   - Decisions: open beads labeled `human` (gc's beadmeta.HumanLabel, "a
//     bead waiting on a person's decision"), by priority, then oldest first.
//     Selecting one opens the bead's detail, with Close… and Sling….
//
// The list is gc's bounded page (store.ts HUMAN_LIMIT); gc's total says how
// many there are. Every string from gc is cleaned before it reaches the model.

import type * as T from "../gc/types.gen.ts";
import { HUMAN_LABEL } from "../gc/ops.ts";
import type { Unreadable } from "../gc/decode.ts";
import { domainFreshness, type CitySnapshot } from "../sync/store.ts";
import { errorText } from "./errorText.ts";
import { ageText, regionModel, type RegionModel } from "./region.ts";
import { cleanLine } from "./sanitize.ts";

/** A session paused on a question or approval. */
export interface QuestionRow {
  kind: "question";
  /** The session id (cleaned): what selecting the row opens. */
  session: string;
  /** The session's alias or template, else its id. */
  who: string;
  /** gc's interaction kind ("question", "tool-approval"). */
  what: string;
  selected: boolean;
}

/** A bead waiting on a person's decision. */
export interface DecisionRow {
  kind: "decision";
  /** The bead id (cleaned): what selecting the row opens. */
  bead: string;
  title: string;
  /** "P1"; null when gc gives none. */
  priority: string | null;
  /** The bead's other labels. */
  labels: string[];
  assignee: string | null;
  /** "3 d" since gc created it; null without a readable time. */
  age: string | null;
  selected: boolean;
}

export type HumanRow = QuestionRow | DecisionRow;

export interface HumanModel {
  /** Questions first, then decisions. */
  rows: HumanRow[];
  questions: number;
  /** gc's count of open human beads (may exceed the rows listed). */
  decisions: number;
  /** Decisions gc has that the page does not list. */
  more: number;
  /** "Questions: …" and "Decisions: …", whichever failed first. */
  region: RegionModel;
  /** Entries gc sent that cannot be read, worded. */
  unreadable: string[];
}

export interface HumanInput {
  snapshot: CitySnapshot;
  now: number;
  /** The session whose detail is open. */
  selectedSession: string | null;
  /** The bead whose detail is open. */
  selectedBead: string | null;
}

const DAY_MS = 86_400_000;

function unreadableText(what: string, u: Unreadable): string {
  return `unreadable ${what} ${u.id === null ? `(entry ${u.index})` : cleanLine(u.id)}: ${errorText(u.error)}`;
}

/** "5 min", "3 h", "4 d". */
export function since(createdAt: string | undefined, now: number): string | null {
  if (createdAt === undefined) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now - t);
  return ms >= DAY_MS ? `${Math.floor(ms / DAY_MS)} d` : ageText(ms);
}

function priorityRank(p: number | null | undefined): number {
  return typeof p === "number" && Number.isFinite(p) ? p : Number.POSITIVE_INFINITY;
}

function createdRank(b: T.Bead): number {
  const t = b.created_at === undefined ? Number.NaN : Date.parse(b.created_at);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Highest priority first (P0 before P3, none last), then oldest first, then by id. */
export function decisionOrder(a: T.Bead, b: T.Bead): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || createdRank(a) - createdRank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function humanModel(input: HumanInput): HumanModel {
  const { snapshot: s, now } = input;
  const sessions = new Map((s.sessions.value?.items ?? []).map((x) => [x.id, x]));
  const questions: QuestionRow[] = (s.pending.value?.items ?? []).map((p) => {
    const x = sessions.get(p.session_id);
    return {
      kind: "question",
      session: cleanLine(p.session_id),
      who: cleanLine(x?.alias || x?.template || p.session_id),
      what: cleanLine(p.kind || "question"),
      selected: input.selectedSession === p.session_id,
    };
  });
  const beads = [...(s.human.value?.items ?? [])]
    .filter((b) => b.status !== "closed" && (b.labels ?? []).includes(HUMAN_LABEL))
    .sort(decisionOrder);
  const decisions: DecisionRow[] = beads.map((b) => ({
    kind: "decision",
    bead: cleanLine(b.id),
    title: cleanLine(b.title),
    priority: typeof b.priority === "number" ? `P${b.priority}` : null,
    labels: (b.labels ?? []).filter((l) => l !== HUMAN_LABEL).map(cleanLine),
    assignee: b.assignee ? cleanLine(b.assignee) : null,
    age: since(b.created_at, now),
    selected: input.selectedBead === b.id,
  }));
  const total = s.human.value === null ? 0 : Math.max(s.human.value.total ?? 0, decisions.length);
  const unreadable = [
    ...(s.pending.value?.unreadable ?? []).map((u) => unreadableText("question", u)),
    ...(s.human.value?.unreadable ?? []).map((u) => unreadableText("decision", u)),
  ];
  return {
    rows: [...questions, ...decisions],
    questions: questions.length,
    decisions: total,
    more: Math.max(0, total - decisions.length),
    region: regionModel([["Questions", domainFreshness(s, "pending", now)], ["Decisions", domainFreshness(s, "human", now)]]),
    unreadable,
  };
}
