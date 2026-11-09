// canary/types-drift.sh decide: when the types-drift job checks a release.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../scripts/gc-spec.ts";

const HOURLY = "23 * * * *";
const DAILY = "41 6 * * *";

/** Runs `decide` with a workflow-like environment; returns its step outputs. */
async function decide(env: Record<string, string>): Promise<{ code: number; outputs: Record<string, string>; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "types-drift-decide-"));
  const output = join(dir, "output");
  const proc = Bun.spawn(["bash", join(ROOT, "canary/types-drift.sh"), "decide"], {
    env: { PATH: process.env["PATH"] ?? "", HOME: dir, CANARY_ROOT: dir, GITHUB_OUTPUT: output, DAILY_SCHEDULE: DAILY, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const text = await readFile(output, "utf8").catch(() => "");
  // name<<delimiter / value / delimiter, as lib.sh writes it.
  const outputs: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, delimiter] = lines[i]!.split("<<");
    expect(lines[i + 2]).toBe(delimiter!);
    outputs[name!] = lines[i + 1]!;
  }
  return { code, outputs, stderr };
}

describe("the hourly schedule checks only a release not checked yet", () => {
  test("a new release is checked", async () => {
    const r = await decide({ EVENT_NAME: "schedule", SCHEDULE: HOURLY, HERDR_APP_VERSION: "0.1.15", CHECKED: "" });
    expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "new herdr-app release 0.1.15" } });
  });

  test("a release already checked is skipped", async () => {
    const r = await decide({ EVENT_NAME: "schedule", SCHEDULE: HOURLY, HERDR_APP_VERSION: "0.1.14", CHECKED: "true" });
    expect(r).toMatchObject({ code: 0, outputs: { check: "false", reason: "herdr-app 0.1.14 was already checked; nothing new" } });
  });
});

test("the daily schedule always checks", async () => {
  const r = await decide({ EVENT_NAME: "schedule", SCHEDULE: DAILY, HERDR_APP_VERSION: "0.1.14", CHECKED: "true" });
  expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "daily check of herdr-app 0.1.14" } });
});

test("a dispatched run always checks", async () => {
  const r = await decide({ EVENT_NAME: "workflow_dispatch", HERDR_APP_VERSION: "0.1.14", CHECKED: "true" });
  expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "dispatched: checking herdr-app 0.1.14" } });
});

describe("refuses what it cannot trust", () => {
  test("a version that is not a release version", async () => {
    const r = await decide({ EVENT_NAME: "schedule", SCHEDULE: HOURLY, HERDR_APP_VERSION: "0.1.15\ncheck=false", CHECKED: "" });
    expect(r.code).not.toBe(0);
    expect(r.outputs).toEqual({});
    expect(r.stderr).toContain("HERDR_APP_VERSION is not a release version");
  });

  test("an event the workflow does not declare", async () => {
    const r = await decide({ EVENT_NAME: "push", HERDR_APP_VERSION: "0.1.14" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unexpected event: push");
  });
});
