// canary/targets.ts: the agent-UI target list (a TOML file kept in a private
// repo) and the check that this repo's canary is the job the list designates
// for the Herdr app, with every step of the list mapped to canary stages.
// The fixture is synthetic: the other UIs here are made up.

import { describe, expect, test } from "bun:test";
import { checkCanaryEntry, parseTargetList, publicReport } from "../../../canary/targets.ts";

const STAGES = ["preflight", "install-app", "install-mod", "discover", "session", "output", "attach", "keyboard", "bead-input", "bead-closed", "authority"];
const ME = { repo: "gastownhall/herdr-gascity", workflow: ".github/workflows/canary.yml", stages: STAGES };

const LIST = `
owner = "owner@example.com"
metric = "M-TEST"

[[step]]
id = "install"
text = "install the UI and our integration"

[[step]]
id = "session"
text = "start or open a session from the UI"

[[step]]
id = "outcome"
text = "the work's outcome in the UI's own model"

[[ui]]
id = "herdr-app"
name = "Herdr app"
outcome = "a closed bead"
[ui.job]
repo = "gastownhall/herdr-gascity"
workflow = ".github/workflows/canary.yml"
lane = "latest-release"
[ui.job.stages]
install = ["install-app", "install-mod", "discover"]
session = ["session", "attach"]
outcome = ["bead-closed"]

[[ui]]
id = "ui-b"
name = "UI B"
outcome = "its run status"
job = "no job yet"
`;

const mutate = (from: string, to: string) => LIST.replace(from, to);

describe("parseTargetList", () => {
  test("reads the owner, the steps in order, and each UI with its job or none", () => {
    const r = parseTargetList(LIST);
    expect(r.errors).toEqual([]);
    expect(r.list!.owner).toBe("owner@example.com");
    expect(r.list!.steps.map((s) => s.id)).toEqual(["install", "session", "outcome"]);
    expect(r.list!.uis.map((u) => [u.id, u.job === null ? null : u.job.lane])).toEqual([["herdr-app", "latest-release"], ["ui-b", null]]);
  });

  test("a file that is not TOML is an error that quotes nothing from it", () => {
    const r = parseTargetList('owner = "secret value\n');
    expect(r.list).toBeNull();
    expect(r.errors).toEqual([{ ui: null, message: "the target list is not valid TOML" }]);
  });

  test("an owner that is not an email, no steps, or a duplicate step is an error", () => {
    expect(parseTargetList(mutate('owner = "owner@example.com"', 'owner = "nobody"')).errors).toEqual([{ ui: null, message: "owner is not an email address" }]);
    expect(parseTargetList(mutate('id = "session"', 'id = "install"')).errors).toContainEqual({ ui: null, message: 'step "install" is listed twice' });
  });

  test("a job must map every step, and only the list's steps, to at least one stage", () => {
    const r = parseTargetList(mutate('outcome = ["bead-closed"]', 'outcomes = ["bead-closed"]'));
    expect(r.errors).toEqual([
      { ui: "herdr-app", message: 'step "outcome" maps to no stage' },
      { ui: "herdr-app", message: 'stage map names "outcomes", which is not a step' },
    ]);
  });

  test("a UI without a job must say so in words, and a lane must be known", () => {
    expect(parseTargetList(mutate('job = "no job yet"', 'job = "soon"')).errors).toEqual([{ ui: "ui-b", message: 'job is neither a table nor "no job yet"' }]);
    expect(parseTargetList(mutate('lane = "latest-release"', 'lane = "nightly"')).errors).toEqual([{ ui: "herdr-app", message: "lane must be latest-release or main" }]);
  });
});

describe("checkCanaryEntry", () => {
  test("the designated entry maps its steps onto stages this canary runs", () => {
    const { list } = parseTargetList(LIST);
    expect(checkCanaryEntry(list!, ME)).toEqual({ ui: "herdr-app", lane: "latest-release", steps: 3, findings: [] });
  });

  test("a mapped stage the canary does not run is a finding", () => {
    const { list } = parseTargetList(mutate('session = ["session", "attach"]', 'session = ["session", "pane"]'));
    expect(checkCanaryEntry(list!, ME).findings).toEqual(['step "session" maps to stage "pane", which this canary does not run']);
  });

  test("no entry designating this workflow is a finding", () => {
    const { list } = parseTargetList(LIST);
    expect(checkCanaryEntry(list!, { ...ME, workflow: ".github/workflows/other.yml" })).toEqual({
      ui: null, lane: null, steps: 0, findings: ["no UI on the list designates gastownhall/herdr-gascity .github/workflows/other.yml as its job"],
    });
  });
});

describe("publicReport", () => {
  test("names only this canary's entry: other UIs' problems are counted, never quoted", () => {
    const r = parseTargetList(mutate('job = "no job yet"', 'job = "soon"'));
    const lines = publicReport(r, ME);
    expect(lines).toEqual(["target list: herdr-app, lane latest-release, 3 steps mapped onto this canary's stages", "target list: 1 problem in other entries (not shown: the list is private)"]);
    expect(lines.join("\n")).not.toContain("ui-b");
    expect(lines.join("\n")).not.toContain("owner@example.com");
  });

  test("a file that does not parse is reported without its contents", () => {
    expect(publicReport(parseTargetList('owner = "secret value\n'), ME)).toEqual(["target list: the target list is not valid TOML"]);
  });
});
