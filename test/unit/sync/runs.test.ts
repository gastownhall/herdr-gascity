import { describe, expect, test } from "bun:test";
import { projectRuns } from "../../../src/sync/runs.ts";

const summary = await Bun.file(new URL("../../fixtures/runs/summary.json", import.meta.url)).json();

describe("the run summary, slimmed", () => {
  const s = projectRuns(summary)!;
  const byId = (id: string) => s.lanes.find((l) => l.id === id)!;

  test("counts, and a lane without an id is unreadable", () => {
    expect([s.live, s.finished, s.partial, s.unreadable, s.lanes.length]).toEqual([4, 120, false, 1, 5]);
  });

  test("a run that reports the approval stage is at the gate, with its strip, PR, rig and session", () => {
    expect(byId("run-101")).toEqual({
      id: "run-101", ref: "PR #101", title: "PR #101: fix(api): retry the flaky upload", formula: "mol-adopt-pr-v2", rig: "frontend",
      cells: ["done", "done", "done", "done", "done", "gate", "pending", "pending"], stageLabel: "Human approval",
      gate: true, dormant: false, updatedAt: "2026-11-09T08:00:00Z", session: "sc-20",
    });
  });

  test("a run whose step is not resolved but has every stage before approval done is at the gate too", () => {
    expect(byId("run-102")).toMatchObject({ gate: true, stageLabel: "Human approval", cells: ["done", "done", "done", "done", "done", "gate", "pending", "pending"] });
  });

  test("an unresolved run short of the gate shows its next stage, unconfirmed", () => {
    expect(byId("run-103")).toMatchObject({ gate: false, stageLabel: "Pre-approval CI?", cells: ["done", "done", "done", "done", "frontier", "pending", "pending", "pending"] });
  });

  test("an agent at work, and a dormant run at the gate", () => {
    expect(byId("run-104")).toMatchObject({ gate: false, ref: null, stageLabel: "Implementation", cells: ["done", "active", "pending", "pending", "pending"], session: null });
    expect(byId("run-090")).toMatchObject({ gate: true, dormant: true });
  });

  test("anything that is not a run summary", () => {
    expect(projectRuns(null)).toBeNull();
    expect(projectRuns({ lanes: "x" })).toBeNull();
    expect(projectRuns({ title: "Not Found", status: 404 })).toBeNull();
  });
});
