// canary/result.sh: how a run's stage records become its result, and above
// all how a failure is classed. A stage that failed is classed by its own
// class; a stage that began and never recorded an end (an Actions step
// timeout killed it) is infra; a required stage never reached with nothing
// failed before it is infra too (a setup step of the workflow failed). Only
// a non-infra class is a product failure.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../canary/result.sh");

let root: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "canary-result-"));
  out = join(root, "out");
  mkdirSync(out);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

type Rec = { stage: string; class: string; rc?: number; begun?: boolean; at?: string };

/** Writes the begin and end records the way lib.sh's run_stage does. */
function stages(recs: Rec[]): void {
  const begun: string[] = [];
  const ended: string[] = [];
  for (const r of recs) {
    begun.push(JSON.stringify({ stage: r.stage, class: r.class, started_at: r.at ?? "2026-11-16T05:17:00Z" }));
    if (r.rc !== undefined) ended.push(JSON.stringify({ stage: r.stage, class: r.class, rc: r.rc, duration_s: 1.5 }));
  }
  writeFileSync(join(out, "stages-begun.jsonl"), begun.map((l) => `${l}\n`).join(""));
  writeFileSync(join(out, "stages.jsonl"), ended.map((l) => `${l}\n`).join(""));
}

function run(required: string[], env: Record<string, string> = {}) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(CANARY_.*|GITHUB_.*|RUNNER_.*)$/.test(k)) base[k] = v;
  const r = Bun.spawnSync(["bash", SCRIPT, ...required], { env: { ...base, CANARY_ROOT: root, ...env }, stdout: "pipe", stderr: "pipe" });
  const name = env.CANARY_RESULT ?? "spike-result.json";
  return { code: r.exitCode, stderr: r.stderr.toString(), result: JSON.parse(readFileSync(join(out, name), "utf8")) };
}

const REQUIRED = ["preflight", "gc", "session", "authority"];

describe("result.sh classes a run", () => {
  test("pass: every required stage ran and none failed", () => {
    stages(REQUIRED.map((s) => ({ stage: s, class: s === "preflight" ? "infra" : "integration", rc: 0 })));
    const { code, result } = run(REQUIRED);
    expect(code).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.failed_stage).toBeNull();
    expect(result.failure_class).toBeNull();
    expect(result.failure_reason).toBeNull();
    expect(result.product_failure).toBe(false);
    expect(result.duration_s).toBe(6);
    expect(result.started_at).toBe("2026-11-16T05:17:00Z");
  });

  test("product failure: a product stage failed; later stages never ran", () => {
    stages([
      { stage: "preflight", class: "infra", rc: 0 },
      { stage: "gc", class: "infra", rc: 0 },
      { stage: "session", class: "integration", rc: 1 },
    ]);
    const { code, result } = run(REQUIRED);
    expect(code).not.toBe(0);
    expect(result.passed).toBe(false);
    expect(result.failed_stage).toBe("session");
    expect(result.failure_class).toBe("integration");
    expect(result.failure_reason).toBe("stage-failed");
    expect(result.product_failure).toBe(true);
    expect(result.missing_stages).toEqual(["authority"]);
  });

  test("infra failure: an infra stage failed by itself", () => {
    stages([{ stage: "preflight", class: "infra", rc: 1 }]);
    const { result } = run(REQUIRED);
    expect(result.failed_stage).toBe("preflight");
    expect(result.failure_class).toBe("infra");
    expect(result.failure_reason).toBe("stage-failed");
    expect(result.product_failure).toBe(false);
  });

  test("infra timeout: a stage that began and never ended (Actions killed the step) is infra, whatever its own class", () => {
    stages([
      { stage: "preflight", class: "infra", rc: 0 },
      { stage: "gc", class: "product" },
    ]);
    const { code, result } = run(REQUIRED);
    expect(code).not.toBe(0);
    expect(result.passed).toBe(false);
    expect(result.failed_stage).toBe("gc");
    expect(result.failure_class).toBe("infra");
    expect(result.failure_reason).toBe("step-timeout");
    expect(result.product_failure).toBe(false);
  });

  test("infra timeout in the first stage: nothing recorded but its begin (the smoke's hung apt)", () => {
    stages([{ stage: "preflight", class: "infra" }]);
    const { result } = run(REQUIRED);
    expect(result.failed_stage).toBe("preflight");
    expect(result.failure_class).toBe("infra");
    expect(result.failure_reason).toBe("step-timeout");
  });

  test("not reached: no stage failed, yet a required one never began (a workflow setup step failed) is infra", () => {
    stages([{ stage: "preflight", class: "infra", rc: 0 }]);
    const { result } = run(REQUIRED);
    expect(result.passed).toBe(false);
    expect(result.failed_stage).toBe("gc");
    expect(result.failure_class).toBe("infra");
    expect(result.failure_reason).toBe("not-reached");
    expect(result.product_failure).toBe(false);
  });

  test("no records at all (no begin file either) is an infra not-reached failure, never a pass", () => {
    const { code, result } = run(REQUIRED);
    expect(code).not.toBe(0);
    expect(result.passed).toBe(false);
    expect(result.failed_stage).toBe("preflight");
    expect(result.failure_class).toBe("infra");
    expect(result.failure_reason).toBe("not-reached");
  });

  test("the first failure in the required order wins over a later one", () => {
    stages([
      { stage: "preflight", class: "infra", rc: 0 },
      { stage: "gc", class: "infra", rc: 0 },
      { stage: "session", class: "integration", rc: 2 },
      { stage: "authority", class: "integration" },
    ]);
    const { result } = run(REQUIRED);
    expect(result.failed_stage).toBe("session");
    expect(result.failure_class).toBe("integration");
  });

  test("a stage outside the required list that failed is listed as optional and does not fail the run", () => {
    stages([...REQUIRED.map((s) => ({ stage: s, class: "integration", rc: 0 })), { stage: "extra", class: "ui", rc: 1 }]);
    const { code, result } = run(REQUIRED);
    expect(code).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.optional_failed).toEqual(["extra"]);
  });

  test("CANARY_RESULT names the file; the versions and the lane go into the record", () => {
    stages(REQUIRED.map((s) => ({ stage: s, class: "integration", rc: 0 })));
    writeFileSync(join(out, "versions-herdr.txt"), "app: herdr-app 0.1.14\ncore: herdr-core 0.4.2\n");
    writeFileSync(join(out, "versions-gc.txt"), "gc: 1.5.1-dev (9ba215cb59)\n");
    const { result } = run(REQUIRED, {
      CANARY_RESULT: "canary-result.json",
      CANARY_LANE: "main",
      CANARY_INTEGRATION_VERSION: "main@f139448",
    });
    expect(result).toMatchObject({
      ui: "herdr-app",
      ui_version: "0.1.14",
      core_version: "0.4.2",
      integration: "herdr-gascity",
      integration_version: "main@f139448",
      gc_version: "1.5.1-dev (9ba215cb59)",
      lane: "main",
      passed: true,
    });
  });
});
