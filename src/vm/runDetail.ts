// The run view: one formula run's stages and steps, for the Needs you tab
// (the run-views design, run detail). Pure: built from the copy's state
// and the detail as last read; render draws it.

import type { StageCell } from "../sync/runs.ts";
import type { RunDetail, StepStatus } from "../sync/runDetail.ts";
import { runLink } from "./dashboardLinks.ts";
import { cleanLine } from "./sanitize.ts";

/** Step rows shown before "N more steps in factory". */
export const RUN_STEPS_SHOWN = 40;

export type StepTone = "ok" | "warn" | "bad" | "dim" | "plain";

export interface RunStepRow {
  /** One glyph: ✓ done, ◆ active, ✕ failed, ○ ready, · pending. */
  glyph: string;
  tone: StepTone;
  title: string;
  /** "2 rounds" for a loop, else null. */
  rounds: string | null;
  /** "2/3", once the step has started; else null. */
  attempts: string | null;
  exhausted: boolean;
  session: string | null;
  /** The session exists now: Open attaches to it. */
  live: boolean;
  depth: 0 | 1;
}

export interface RunViewModel {
  city: string;
  id: string;
  /** "PR #8486", or null. */
  ref: string | null;
  title: string;
  /** "mol-adopt-pr-v2 · beads · beads/gc.run-operator". */
  sub: string;
  stages: { label: string; cell: StageCell }[];
  steps: RunStepRow[];
  /** Steps past RUN_STEPS_SHOWN. */
  moreSteps: number;
  /** "16 steps · 10 done · 2 active · 4 pending", or null before the first read. */
  counts: string | null;
  path: string | null;
  /** The session an active step waits in, alive: what Answer attaches to. */
  answer: string | null;
  /** The run in factory; null without a runs dashboard set. */
  link: string | null;
  /** Reading, a failed read, a partial snapshot: said under the header. */
  note: string | null;
  /** The note is a warning (partial snapshot, failed read). */
  noteWarn: boolean;
}

const GLYPH: Record<StepStatus, { glyph: string; tone: StepTone }> = {
  completed: { glyph: "✓", tone: "ok" },
  active: { glyph: "◆", tone: "warn" },
  failed: { glyph: "✕", tone: "bad" },
  ready: { glyph: "○", tone: "plain" },
  pending: { glyph: "·", tone: "dim" },
  other: { glyph: "?", tone: "dim" },
};

const COUNT_ORDER = ["completed", "active", "failed", "ready", "pending"];
const COUNT_WORD: Record<string, string> = { completed: "done" };

function countsLine(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const keys = [...COUNT_ORDER.filter((k) => counts[k] !== undefined), ...Object.keys(counts).filter((k) => !COUNT_ORDER.includes(k)).sort()];
  const parts = keys.filter((k) => (counts[k] ?? 0) > 0).map((k) => `${counts[k]} ${cleanLine(COUNT_WORD[k] ?? k)}`);
  return [`${total} step${total === 1 ? "" : "s"}`, ...parts].join(" · ");
}

export interface RunViewInput {
  city: string;
  id: string;
  /** From the run summary (the focus target), until the detail says more. */
  ref: string | null;
  title: string | null;
  detail: RunDetail | null;
  error: string | null;
  reading: boolean;
  runsUrl: string | null;
  now: number;
}

export function runViewModel(i: RunViewInput): RunViewModel {
  const d = i.detail;
  const steps: RunStepRow[] = (d?.steps ?? []).map((s) => {
    const started = s.status !== "pending" && s.status !== "ready";
    return {
      ...GLYPH[s.status],
      title: cleanLine(s.title),
      rounds: s.rounds !== null && s.rounds > 1 ? `${s.rounds} rounds` : null,
      attempts: started && s.attempts !== null ? cleanLine(s.attempts) : null,
      exhausted: s.exhausted && s.status === "failed",
      session: s.session === null ? null : cleanLine(s.session),
      live: s.live,
      depth: s.depth,
    };
  });
  const answer = d?.steps.find((s) => s.status === "active" && s.live && s.session !== null)?.session ?? null;
  const title = i.title ?? d?.title ?? i.id;
  const sub = [d?.formula, d?.rig, d?.target].filter((x): x is string => x !== null && x !== undefined).map(cleanLine).join(" · ");
  let note: string | null = null;
  let noteWarn = false;
  if (i.error !== null) {
    note = cleanLine(i.error);
    noteWarn = true;
  } else if (d === null) note = "Reading the run's steps…";
  else if (d.partial) {
    note = "gc returned a partial snapshot: some steps may be missing.";
    noteWarn = true;
  } else if (d.terminal) note = "This run has finished.";
  return {
    city: cleanLine(i.city),
    id: cleanLine(i.id),
    ref: i.ref === null ? null : cleanLine(i.ref),
    title: cleanLine(title),
    sub,
    stages: (d?.stages ?? []).map((s) => ({ label: cleanLine(s.label), cell: s.cell })),
    steps: steps.slice(0, RUN_STEPS_SHOWN),
    moreSteps: Math.max(0, steps.length - RUN_STEPS_SHOWN),
    counts: d === null ? null : countsLine(d.counts),
    path: d?.path === null || d?.path === undefined ? null : cleanLine(d.path),
    answer: answer === null ? null : cleanLine(answer),
    link: runLink(i.runsUrl, i.city, i.id),
    note,
    noteWarn,
  };
}
