import { describe, expect, test } from "bun:test";
import { projectRunDetail } from "../../../src/sync/runDetail.ts";
import { runViewModel } from "../../../src/vm/runDetail.ts";

const detail = await Bun.file(new URL("../../fixtures/runs/detail.json", import.meta.url)).json();

describe("a run's detail, slimmed", () => {
  const d = projectRunDetail(detail)!;

  test("the header: the run root's title, formula, target, rig and worktree", () => {
    expect([d.id, d.title, d.formula, d.target, d.rig, d.path, d.partial, d.terminal])
      .toEqual(["run-101", "Adopt PR 101", "wf-adopt", "demo/operator", "demo", "/srv/demo/.gc/worktrees/w1", false, false]);
  });

  test("stages: done, the approval gate, pending", () => {
    expect(d.stages.map((s) => s.cell)).toEqual(["done", "done", "gate", "pending"]);
  });

  test("steps in gc's order, a loop's iteration steps under it, without the root, the scope or a past iteration", () => {
    expect(d.steps.map((s) => `${"  ".repeat(s.depth)}${s.title}`)).toEqual([
      "Prepare worktree", "Review loop", "  Review A", "  Apply fixes", "Human review", "Merge", "Finalize",
    ]);
  });

  test("a loop's round, used-up attempts, and the session that ran a step (live when it can be attached)", () => {
    const by = (t: string) => d.steps.find((s) => s.title === t)!;
    expect(by("Review loop")).toMatchObject({ rounds: 2, attempts: "2/5", session: null });
    expect(by("Apply fixes")).toMatchObject({ status: "failed", attempts: "2/2", exhausted: true, session: "demo/fixer-1", live: false });
    expect(by("Human review")).toMatchObject({ status: "active", session: "demo/approver-1", live: true });
  });

  test("anything that is not a run detail is null", () => {
    expect(projectRunDetail(null)).toBeNull();
    expect(projectRunDetail({ runId: "r" })).toBeNull();
    expect(projectRunDetail([])).toBeNull();
  });

  test("an incomplete snapshot is partial", () => {
    expect(projectRunDetail({ ...detail, completeness: { kind: "partial" } })!.partial).toBe(true);
  });
});

describe("the run view", () => {
  const base = { city: "demo", id: "run-101", ref: "PR #101", title: "fix the upload", error: null, reading: false, runsUrl: "https://factory.example", now: 0 };

  test("before the first read: the summary's PR and title, and a note", () => {
    const m = runViewModel({ ...base, detail: null, reading: true });
    expect([m.ref, m.title, m.note, m.steps.length, m.counts, m.answer]).toEqual(["PR #101", "fix the upload", "Reading the run's steps…", 0, null, null]);
    expect(m.link).toBe("https://factory.example/city/demo/runs/run-101");
  });

  test("glyphs, attempts only once started, rounds, Answer on the live active step, counts", () => {
    const m = runViewModel({ ...base, detail: projectRunDetail(detail) });
    expect(m.steps.map((s) => [s.glyph, s.title, s.attempts, s.rounds])).toEqual([
      ["✓", "Prepare worktree", "1/3", null],
      ["✓", "Review loop", "2/5", "2 rounds"],
      ["✓", "Review A", "2/3", null],
      ["✕", "Apply fixes", "2/2", null],
      ["◆", "Human review", "1/3", null],
      ["·", "Merge", null, null],
      ["○", "Finalize", null, null],
    ]);
    expect(m.steps[3]!.exhausted).toBe(true);
    expect(m.answer).toBe("demo/approver-1");
    expect(m.counts).toBe("10 steps · 5 done · 2 active · 1 failed · 2 pending");
    expect([m.sub, m.note]).toEqual(["wf-adopt · demo · demo/operator", null]);
  });

  test("a failed read is said, as a warning; no runs dashboard, no link", () => {
    const m = runViewModel({ ...base, detail: null, error: "gc did not return this run's detail", runsUrl: null });
    expect([m.note, m.noteWarn, m.link]).toEqual(["gc did not return this run's detail", true, null]);
  });

  test("past 40 steps: the rest are counted", () => {
    const d = projectRunDetail(detail)!;
    const many = { ...d, steps: Array.from({ length: 45 }, (_, i) => ({ ...d.steps[0]!, title: `s${i}` })) };
    const m = runViewModel({ ...base, detail: many });
    expect([m.steps.length, m.moreSteps]).toEqual([40, 5]);
  });
});
