// Formula runs, slimmed from gc's dashboard run summary
// (GET /api/city/<city>/runs/summary: ~350 KB for a busy city). Each lane is
// read by hand, tolerantly, into a ~200-byte record, and the body is dropped:
// nothing downstream holds the raw payload. Pure.
//
// What the summary says (sampled on a live city, see the run-views design):
//   - `lanes` is every non-terminal run; `stale: true` marks one with no bead
//     write for 72 h (gc decides; never recomputed here). totalActive counts
//     the others.
//   - a run at the human gate reports progress.stage.key "approval", or (its
//     current step not resolved below the formula) has every stage before
//     approval complete and approval not: sampled run details all showed
//     "Human review before merge" active, so both count as waiting on a person.
//   - activeAssignees[0] is the session running the run (one each, when known).

/** One stage cell of a run's strip. */
export type StageCell = "done" | "active" | "gate" | "frontier" | "pending";

/** A formula run, slimmed. */
export interface RunLane {
  id: string;
  /** "PR #8486", or null. */
  ref: string | null;
  title: string;
  formula: string | null;
  /** The rig it runs in, or null. */
  rig: string | null;
  cells: StageCell[];
  /** The current (or frontier) stage's label, or null. */
  stageLabel: string | null;
  /** Waiting on a person at the approval gate. */
  gate: boolean;
  /** No bead write for 72 h (gc's `stale`). */
  dormant: boolean;
  /** When gc last wrote one of its beads (ISO), or null. */
  updatedAt: string | null;
  /** The session running it, or null. */
  session: string | null;
}

export interface RunSummary {
  lanes: RunLane[];
  /** gc's count of live (non-dormant) runs. */
  live: number;
  /** Finished runs gc knows of. */
  finished: number;
  /** gc could not read every rig: counts are a lower bound. */
  partial: boolean;
  /** Lanes that could not be read. */
  unreadable: number;
}

const GATE = "approval";

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** An `{status: "available", …}` wrapper's field, or a plain value. */
function available(v: unknown, field: string): unknown {
  const r = rec(v);
  if (r === null) return undefined;
  if (r["status"] !== undefined && r["status"] !== "available" && r["status"] !== "known") return undefined;
  return r[field];
}

function lane(raw: unknown): RunLane | null {
  const l = rec(raw);
  const id = str(l?.["id"]);
  if (l === null || id === null) return null;
  const stages = (Array.isArray(l["stages"]) ? l["stages"] : []).map(rec).filter((s): s is Record<string, unknown> => s !== null);
  const progress = rec(l["progress"]);
  const stage = rec(progress?.["stage"]);
  const resolved = stage !== null && stage["status"] === "available";
  const activeKey = resolved ? str(stage?.["key"]) : null;
  const frontierIndex = stages.findIndex((s) => s["status"] !== "complete");
  const frontier = frontierIndex >= 0 ? stages[frontierIndex] ?? null : null;
  const health = rec(available(l["health"], "data") ?? null);
  const gate = activeKey === GATE || (!resolved && str(frontier?.["key"]) === GATE) || health?.["needsOperator"] === true;
  const cells: StageCell[] = stages.map((s, i) => {
    if (s["status"] === "complete") return "done";
    const key = str(s["key"]);
    if (s["status"] === "active" || (resolved && key === activeKey)) return key === GATE ? "gate" : "active";
    if (!resolved && i === frontierIndex) return key === GATE ? "gate" : "frontier";
    return "pending";
  });
  const current = resolved ? stage : frontier;
  const label = str(current?.["label"]);
  const assignees = Array.isArray(l["activeAssignees"]) ? l["activeAssignees"] : [];
  return {
    id,
    ref: str(available(l["external"], "label")),
    title: str(l["title"]) ?? id,
    formula: str(available(l["formula"], "name")),
    rig: str(available(l["scope"], "ref")),
    cells,
    stageLabel: label === null ? null : resolved ? label : `${label}${gate ? "" : "?"}`,
    gate,
    dormant: l["stale"] === true,
    updatedAt: str(available(l["updatedAt"], "at")),
    session: str(assignees[0]),
  };
}

/** The summary's runs, slimmed; null when the body is not a run summary. */
export function projectRuns(raw: unknown): RunSummary | null {
  const d = rec(raw);
  if (d === null || !Array.isArray(d["lanes"])) return null;
  const lanes: RunLane[] = [];
  let unreadable = 0;
  for (const l of d["lanes"]) {
    const r = lane(l);
    if (r === null) unreadable++;
    else lanes.push(r);
  }
  const live = typeof d["totalActive"] === "number" ? d["totalActive"] : lanes.filter((l) => !l.dormant).length;
  return {
    lanes,
    live,
    finished: typeof d["totalHistorical"] === "number" ? d["totalHistorical"] : 0,
    partial: d["lanesPartial"] === true,
    unreadable,
  };
}
