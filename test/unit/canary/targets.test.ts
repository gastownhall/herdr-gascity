// canary/targets.ts: the agent-UI target list (a TOML file kept in a private
// repo) and the check that this repo's canary is the job the list designates
// for the Herdr app, with every step of the list mapped to canary stages.
// The fixture is synthetic: the other UIs here are made up.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCanaryEntry, parseTargetList, publicReport, verdict } from "../../../canary/targets.ts";

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

  test("a non-ASCII character outside the printable range (Bun would silently drop the rest) is a parse error, not a missing entry", () => {
    for (const bad of ["\u00a0", "\u200b", "\ufeff", "\u0001"]) {
      const r = parseTargetList(bad === "\ufeff" ? bad + LIST : mutate('id = "session"', bad + 'id = "session"'));
      expect(r.list).toBeNull();
      expect(r.errors).toEqual([{ ui: null, message: "the target list is not valid TOML" }]);
      expect(verdict(r, ME)).toBe("unchecked");
    }
    expect(parseTargetList(LIST.replaceAll("\n", "\r\n")).errors).toEqual([]);
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

describe("verdict", () => {
  test("ok when nothing anywhere is wrong", () => {
    expect(verdict(parseTargetList(LIST), ME)).toBe("ok");
  });

  test("ok-others when this canary's entry checks out but another entry or the list as a whole does not", () => {
    expect(verdict(parseTargetList(mutate('job = "no job yet"', 'job = "soon"')), ME)).toBe("ok-others");
    expect(verdict(parseTargetList(mutate('owner = "owner@example.com"', 'owner = "nobody"')), ME)).toBe("ok-others");
  });

  test("mismatch for a problem in this canary's own entry, or no entry at all", () => {
    expect(verdict(parseTargetList(mutate('session = ["session", "attach"]', 'session = ["session", "pane"]')), ME)).toBe("mismatch");
    expect(verdict(parseTargetList(mutate('lane = "latest-release"', 'lane = "nightly"')), ME)).toBe("mismatch");
    expect(verdict(parseTargetList(mutate('workflow = ".github/workflows/canary.yml"', 'workflow = ".github/workflows/other.yml"')), ME)).toBe("mismatch");
  });

  test("unchecked when the list does not parse: this canary cannot tell whose entry is at fault", () => {
    expect(verdict(parseTargetList('owner = "secret value\n'), ME)).toBe("unchecked");
    expect(verdict(parseTargetList("x = 1979-05-27\n"), ME)).toBe("unchecked");
  });
});

describe("the CLI (the canary workflow's targets job)", () => {
  const dir = mkdtempSync(join(tmpdir(), "canary-targets-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const SCRIPT = join(import.meta.dir, "../../../canary/targets.ts");
  // Run from the repo root as the workflow does: --workflow is both the file read and the job's name on the list.
  const ROOT = join(import.meta.dir, "../../..");

  // The fixture's entry maps onto stages the real canary.yml runs.
  function cli(list: string | null) {
    const file = join(dir, "list.toml");
    if (list !== null) writeFileSync(file, list);
    else rmSync(file, { force: true });
    const p = Bun.spawnSync(["bun", SCRIPT, "--file", file], {
      cwd: ROOT,
      env: { PATH: process.env["PATH"], GITHUB_REPOSITORY: "gastownhall/herdr-gascity" },
    });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  }

  test("the entry checks out: exit 0 and one line naming only this canary's entry", () => {
    const r = cli(LIST);
    expect(r).toEqual({ code: 0, out: "target list: herdr-app, lane latest-release, 3 steps mapped onto this canary's stages\n", err: "" });
  });

  test("a mismatch in this canary's entry: exit 1, and the line says what", () => {
    const r = cli(LIST.replace('session = ["session", "attach"]', 'session = ["session", "pane"]'));
    expect(r.code).toBe(1);
    expect(r.out).toBe('target list: step "session" maps to stage "pane", which this canary does not run\n');
  });

  test("a problem in this canary's own entry other than a stage: exit 1", () => {
    const r = cli(LIST.replace('lane = "latest-release"', 'lane = "nightly"'));
    expect(r).toEqual({ code: 1, out: "target list: herdr-app: lane must be latest-release or main\n", err: "" });
  });

  test("no entry designates this canary: exit 1", () => {
    const r = cli(LIST.replace('workflow = ".github/workflows/canary.yml"', 'workflow = ".github/workflows/other.yml"'));
    expect(r.code).toBe(1);
    expect(r.out).toBe("target list: no UI on the list designates gastownhall/herdr-gascity .github/workflows/canary.yml as its job\n");
  });

  test("a problem only in another entry: exit 3, this entry's line plus a count, never quoted", () => {
    const r = cli(LIST.replace('job = "no job yet"', 'job = "soon"'));
    expect(r).toEqual({
      code: 3,
      out: "target list: herdr-app, lane latest-release, 3 steps mapped onto this canary's stages\ntarget list: 1 problem in other entries (not shown: the list is private)\n",
      err: "",
    });
    expect(r.out).not.toContain("ui-b");
  });

  test("a problem in the list outside any entry: exit 3, counted and never quoted", () => {
    const r = cli(LIST.replace('owner = "owner@example.com"', 'owner = "nobody"'));
    expect(r.code).toBe(3);
    expect(r.out).toContain("target list: 1 problem in other entries (not shown: the list is private)");
    expect(r.out).not.toContain("nobody");
  });

  test("a list it cannot read: exit 2 with one line, no stack and nothing from the file", () => {
    const r = cli(null);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toBe("targets: could not read the target list (ENOENT)\n");
  });

  test("a list that is not TOML: exit 2 (whose fault is unknown), and nothing from it is printed", () => {
    const r = cli('owner = "secret value\n');
    expect(r).toEqual({ code: 2, out: "target list: the target list is not valid TOML\n", err: "" });
  });
});
