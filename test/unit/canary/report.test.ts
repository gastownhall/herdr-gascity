// canary/report.sh: the canary workflow's report job. It reads exactly one
// result per planned run (never whatever a glob finds), checks every field
// against what result.sh writes before any of it reaches the summary or an
// issue, reports a result it cannot read instead of stopping, and files or
// updates one issue on a product failure: only on the default branch, and
// only an issue this workflow filed (its label and the Actions bot as author).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../canary/report.sh");
const STAGES = "preflight install-app discover session bead-closed authority";
const SHA = "439d8d512084551985c0d87f7a4f7f7240ac6fc5";
const TITLE = "Nightly canary: product-stage failure";
const BOT = "github-actions[bot]";

let root: string;
let results: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "canary-report-"));
  results = join(root, "results");
  mkdirSync(results);
  // A fake gh: logs each call, answers the issue search from GH_ISSUES.
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>"$GH_LOG"\nif [[ $1 == api && $2 == *issues\\?* ]]; then cat "$GH_ISSUES"; fi\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(root, "issues.json"), "[]");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function result(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: "herdr-app", ui_version: "0.1.16", core_version: "0.1.21", integration: "herdr-gascity",
    integration_version: `main@${SHA}`, gc_version: "dev (c7eb6d2f43)", lane: "main",
    passed: true, failed_stage: null, failure_class: null, failure_reason: null, product_failure: false,
    duration_s: 298.6, ...over,
  };
}

const failed = (over: Record<string, unknown> = {}) =>
  result({ passed: false, failed_stage: "session", failure_class: "integration", failure_reason: "stage-failed", product_failure: true, ...over });

/** Puts a result where download-artifact puts it: in results/ for a single artifact, else results/<name>/. */
function put(where: string, body: unknown): void {
  const dir = join(results, where);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "canary-result.json"), typeof body === "string" ? body : JSON.stringify(body));
}

function run(planned: number[], env: Record<string, string> = {}) {
  const summary = join(root, "summary.md");
  const log = join(root, "gh.log");
  const p = Bun.spawnSync(["bash", SCRIPT], {
    env: {
      PATH: `${join(root, "bin")}:${process.env["PATH"]}`,
      RESULTS: results, PLANNED: JSON.stringify(planned), ATTEMPT: "1", CANARY_STAGES: STAGES,
      SOAK: planned.length > 1 ? "true" : "false", EVENT: "schedule", REASON: "",
      RUN_URL: "https://github.com/o/r/actions/runs/1", REPO: "o/r", REF: "refs/heads/main", DEFAULT_BRANCH: "main",
      GITHUB_STEP_SUMMARY: summary, GH_LOG: log, GH_ISSUES: join(root, "issues.json"), ...env,
    },
  });
  return {
    code: p.exitCode,
    stderr: p.stderr.toString(),
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
    gh: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
  };
}

describe("reading the results", () => {
  test("a single run's result lands directly in results/; a pass files nothing", () => {
    put("", result());
    const r = run([1]);
    expect(r.code).toBe(0);
    expect(r.summary).toContain("| 1 | true |  |  |  | 0.1.16 | 0.1.21 | dev (c7eb6d2f43) | 298s |");
    expect(r.gh).toEqual([]);
  });

  test("several runs: exactly canary-<run>-<attempt> each, nothing else a glob would find", () => {
    put("canary-1-1", result());
    put("canary-2-1/nested", failed()); // not where run 2's result goes
    put("stray", failed());
    const r = run([1, 2]);
    expect(r.summary).toContain("| 1 | true |");
    expect(r.summary).toContain("| 2 | no result |");
    expect(r.summary).toContain("**1 run(s) wrote no result**");
    expect(r.gh).toEqual([]);
  });

  test("a result that is not JSON is reported and the step fails, without an issue", () => {
    put("", "{ not json");
    const r = run([1]);
    expect(r.code).toBe(1);
    expect(r.summary).toContain("| 1 | unreadable | result is not JSON |");
    expect(r.gh).toEqual([]);
  });

  test("a field outside what result.sh writes is reported by name only, and never reaches an issue", () => {
    put("", failed({ failed_stage: "session](https://evil.example) @someone" , gc_version: "x\n@octocat" }));
    const r = run([1]);
    expect(r.code).toBe(1);
    expect(r.summary).toContain("| 1 | unreadable | invalid: failed_stage, gc_version |");
    expect(r.summary).not.toContain("evil.example");
    expect(r.summary).not.toContain("@octocat");
    expect(r.gh).toEqual([]);
  });
});

describe("the issue", () => {
  test("a product failure on the default branch files one labelled issue, from checked fields only", () => {
    put("", failed());
    const r = run([1]);
    expect(r.code).toBe(0);
    expect(r.gh[0]).toStartWith("label create canary-failure");
    expect(r.gh[1]).toContain("issues?state=open&labels=canary-failure&creator=github-actions%5Bbot%5D");
    expect(r.gh[2]).toStartWith(`issue create --repo o/r --title ${TITLE} --label canary-failure --body The Herdr app canary failed at stage \`session\` (class integration).`);
    expect(r.gh.join("\n")).toContain(`- herdr-app 0.1.16, core 0.1.21, gc dev (c7eb6d2f43), main@${SHA}`);
    expect(r.summary).toContain("Filed an issue.");
  });

  test("it comments on the open issue this workflow filed, not on one anyone else opened with the same title", () => {
    writeFileSync(join(root, "issues.json"), JSON.stringify([
      { number: 7, title: TITLE, user: { login: "someone" } },
      { number: 9, title: TITLE, user: { login: BOT } },
      { number: 11, title: TITLE, user: { login: BOT }, pull_request: {} },
    ]));
    put("", failed());
    const r = run([1]);
    expect(r.gh[2]).toStartWith("issue comment 9 --repo o/r --body The Herdr app canary failed");
    expect(r.summary).toContain("Updated issue #9.");
  });

  test("an infra failure only shows in the summary", () => {
    put("", failed({ failure_class: "infra", failure_reason: "step-timeout", product_failure: false }));
    const r = run([1]);
    expect(r.code).toBe(0);
    expect(r.gh).toEqual([]);
  });

  test("off the default branch a product failure files nothing and fails the step", () => {
    put("", failed());
    const r = run([1], { REF: "refs/heads/ci/canary-validate" });
    expect(r.code).toBe(1);
    expect(r.gh).toEqual([]);
    expect(r.summary).toContain("Not the default branch (refs/heads/ci/canary-validate): no issue filed.");
  });

  test("a soak reports its product-stage flake rate over the planned runs", () => {
    put("canary-1-1", result());
    put("canary-2-1", failed({ failure_class: "infra", failure_reason: "not-reached", product_failure: false }));
    const r = run([1, 2]);
    expect(r.summary).toContain("Soak: 0 product-stage failure(s) in 2 run(s): flake rate 0% (target under 2%).");
  });
});
