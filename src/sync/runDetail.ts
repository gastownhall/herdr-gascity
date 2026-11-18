// One formula run's detail, slimmed from gc's dashboard run detail
// (GET /api/city/<city>/runs/<id>/detail: 11–35 KB). Read by hand,
// tolerantly; the body is dropped. Pure.
//
// What the detail says (sampled on a live city, see the run-views design):
//   - `stages` is the run's stage list, each {key, label, status}.
//   - `nodes` are the formula's steps in gc's order. Shown: visibleInGraph and
//     not historicalOnly, minus the run root and scope nodes. A loop
//     (constructKind "check-loop") and the steps of its iterations share
//     iterationSummary.control.id: those steps are listed under their loop
//     (gc lists them before it), and the loop's visibleIteration is its round.
//   - a step's session is the last attached execution instance's sessionName;
//     `streamable` says the session exists now (it can be attached).
//   - there is no step → stage mapping: steps are not nested under stages.

import type { StageCell } from "./runs.ts";

export type StepStatus = "completed" | "active" | "failed" | "ready" | "pending" | "other";

export interface RunStep {
  title: string;
  status: StepStatus;
  /** "2/3" (attempts used / allowed), or null. */
  attempts: string | null;
  /** All allowed attempts are used ("2/2"). */
  exhausted: boolean;
  /** A loop's rounds (its visible iteration), for loops only; else null. */
  rounds: number | null;
  /** The session that ran it last, or null. */
  session: string | null;
  /** That session exists now (it can be attached). */
  live: boolean;
  /** 0 for a top-level step, 1 for a step inside a loop's iteration. */
  depth: 0 | 1;
}

export interface RunDetail {
  id: string;
  title: string;
  formula: string | null;
  /** The agent the formula targets ("beads/gc.run-operator"), or null. */
  target: string | null;
  rig: string | null;
  /** The worktree it runs in, or null. */
  path: string | null;
  stages: { label: string; cell: StageCell }[];
  steps: RunStep[];
  /** gc's step counts by status ("completed" → 10). */
  counts: Record<string, number>;
  /** gc's snapshot is partial or incomplete. */
  partial: boolean;
  /** gc reports the run finished. */
  terminal: boolean;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function known(v: unknown, field: string): string | null {
  const r = rec(v);
  if (r === null || (r["kind"] !== "known" && r["kind"] !== "available")) return null;
  return str(r[field]);
}

const STATUSES: readonly StepStatus[] = ["completed", "active", "failed", "ready", "pending"];

function status(v: unknown): StepStatus {
  return STATUSES.find((s) => s === v) ?? "other";
}

function controlOf(n: Record<string, unknown>): string | null {
  const it = rec(n["iterationSummary"]);
  return known(it?.["control"], "id");
}

function sessionOf(n: Record<string, unknown>): { session: string | null; live: boolean } {
  const instances = Array.isArray(n["executionInstances"]) ? n["executionInstances"] : [];
  for (let i = instances.length - 1; i >= 0; i--) {
    const s = rec(rec(instances[i])?.["session"]);
    if (s?.["kind"] !== "attached") continue;
    const name = str(rec(s["link"])?.["sessionName"]);
    if (name !== null) return { session: name, live: s["streamable"] === true };
  }
  return { session: null, live: false };
}

function step(n: Record<string, unknown>, depth: 0 | 1, loop: boolean): RunStep {
  const badge = rec(rec(n["attemptSummary"])?.["badge"]);
  const attempts = str(badge?.["label"]);
  const m = attempts === null ? null : /^(\d+)\/(\d+)$/.exec(attempts);
  const it = rec(n["iterationSummary"]);
  const round = it?.["visibleIteration"];
  return {
    title: str(n["title"]) ?? str(n["id"]) ?? "step",
    status: status(n["status"]),
    attempts,
    exhausted: m !== null && m[1] === m[2],
    rounds: loop && typeof round === "number" ? round : null,
    ...sessionOf(n),
    depth,
  };
}

function stageCell(status: unknown, key: string | null): StageCell {
  if (status === "complete") return "done";
  if (status === "active") return key === "approval" ? "gate" : "active";
  return "pending";
}

/** The detail, slimmed; null when the body is not a run detail. */
export function projectRunDetail(raw: unknown): RunDetail | null {
  const d = rec(raw);
  const id = str(d?.["runId"]);
  if (d === null || id === null || !Array.isArray(d["nodes"])) return null;
  const nodes = d["nodes"].map(rec).filter((n): n is Record<string, unknown> => n !== null)
    .filter((n) => n["visibleInGraph"] === true && n["historicalOnly"] !== true)
    .filter((n) => n["constructKind"] !== "run-root" && n["kind"] !== "scope");
  const loops = new Set(nodes.filter((n) => n["constructKind"] === "check-loop").map(controlOf).filter((c): c is string => c !== null));
  const inside = new Map<string, Record<string, unknown>[]>();
  for (const n of nodes) {
    const c = controlOf(n);
    if (c !== null && loops.has(c) && n["constructKind"] !== "check-loop") inside.set(c, [...(inside.get(c) ?? []), n]);
  }
  const steps: RunStep[] = [];
  for (const n of nodes) {
    const c = controlOf(n);
    if (n["constructKind"] === "check-loop") {
      steps.push(step(n, 0, true));
      for (const child of c === null ? [] : inside.get(c) ?? []) steps.push(step(child, 1, false));
    } else if (c === null || !loops.has(c)) steps.push(step(n, 0, false));
  }
  const stages = (Array.isArray(d["stages"]) ? d["stages"] : []).map(rec).filter((s): s is Record<string, unknown> => s !== null)
    .map((s) => ({ label: str(s["label"]) ?? str(s["key"]) ?? "?", cell: stageCell(s["status"], str(s["key"])) }));
  const progress = rec(d["progress"]);
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(progress?.["statusCounts"]) ?? {})) if (typeof v === "number") counts[k] = v;
  const root = d["nodes"].map(rec).find((n) => n?.["constructKind"] === "run-root");
  return {
    id,
    title: str(root?.["title"]) ?? str(d["title"]) ?? id,
    formula: known(d["formula"], "name"),
    target: known(d["formulaDetail"], "target"),
    rig: str(d["scopeRef"]),
    path: known(d["executionPath"], "path"),
    stages,
    steps,
    counts,
    partial: rec(d["completeness"])?.["kind"] !== "complete" || progress?.["snapshotPartial"] === true,
    terminal: progress?.["terminal"] === true,
  };
}
