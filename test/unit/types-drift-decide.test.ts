// canary/types-drift.sh decide and record: when the types-drift job checks a
// release, and how the last result keeps a failure visible.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../scripts/gc-spec.ts";

const workflow = Bun.YAML.parse(await readFile(join(ROOT, ".github/workflows/types-drift.yml"), "utf8")) as {
  on: { schedule: { cron: string }[] };
  env: { DAILY_SCHEDULE: string };
};
const crons = workflow.on.schedule.map((s) => s.cron);
const DAILY = workflow.env.DAILY_SCHEDULE;
const HOURLY = crons.find((c) => c !== DAILY)!;

interface Run {
  code: number;
  outputs: Record<string, string>;
  stderr: string;
  root: string;
}

/** Runs a types-drift.sh command with a workflow-like environment; `last` is the restored result. */
async function run(args: string[], env: Record<string, string>, last?: { version: string; result: string }): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), "types-drift-decide-"));
  const output = join(root, "output");
  if (last) {
    await mkdir(join(root, "host-result"));
    await writeFile(join(root, "host-result/VERSION"), `${last.version}\n`);
    await writeFile(join(root, "host-result/RESULT"), `${last.result}\n`);
  }
  const proc = Bun.spawn(["bash", join(ROOT, "canary/types-drift.sh"), ...args], {
    env: { PATH: process.env["PATH"] ?? "", HOME: root, CANARY_ROOT: root, GITHUB_OUTPUT: output, DAILY_SCHEDULE: DAILY, ...env },
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
  return { code, outputs, stderr, root };
}

const decide = (env: Record<string, string>, last?: { version: string; result: string }) => run(["decide"], env, last);
const hourly = { EVENT_NAME: "schedule", SCHEDULE: HOURLY };

test("env.DAILY_SCHEDULE is exactly one of the workflow's two schedules", () => {
  expect(crons).toHaveLength(2);
  expect(crons.filter((c) => c === DAILY)).toHaveLength(1);
  expect(HOURLY).toBeDefined();
});

describe("the hourly schedule", () => {
  test("checks a release with no recorded result", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.15" });
    expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "new herdr-app release 0.1.15" } });
  });

  test("skips a release that passed its last check", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.14" }, { version: "0.1.14", result: "pass" });
    expect(r).toMatchObject({ code: 0, outputs: { check: "false", reason: "herdr-app 0.1.14 passed its last check; nothing new" } });
  });

  test("fails at once while the release's last check failed", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.14" }, { version: "0.1.14", result: "fail" });
    expect(r).toMatchObject({
      code: 1,
      outputs: { check: "false", reason: "herdr-app 0.1.14 failed its last check; failing until a daily or dispatched check passes" },
    });
  });
});

describe("the daily schedule and a dispatch check regardless of the last result", () => {
  for (const result of ["pass", "fail"]) {
    test(`daily, last ${result}`, async () => {
      const r = await decide({ EVENT_NAME: "schedule", SCHEDULE: DAILY, HERDR_APP_VERSION: "0.1.14" }, { version: "0.1.14", result });
      expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "daily check of herdr-app 0.1.14" } });
    });

    test(`dispatched, last ${result}`, async () => {
      const r = await decide({ EVENT_NAME: "workflow_dispatch", HERDR_APP_VERSION: "0.1.14" }, { version: "0.1.14", result });
      expect(r).toMatchObject({ code: 0, outputs: { check: "true", reason: "dispatched: checking herdr-app 0.1.14" } });
    });
  }
});

describe("refuses what it cannot trust", () => {
  test("a version that is not a release version", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.15\ncheck=false" });
    expect(r.code).not.toBe(0);
    expect(r.outputs).toEqual({});
    expect(r.stderr).toContain("HERDR_APP_VERSION is not a release version");
  });

  test("an event the workflow does not declare", async () => {
    const r = await decide({ EVENT_NAME: "push", HERDR_APP_VERSION: "0.1.14" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unexpected event: push");
  });

  test("a restored result for another release", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.15" }, { version: "0.1.14", result: "pass" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("the restored result is for herdr-app 0.1.14, not 0.1.15");
  });

  test("a restored result that is neither pass nor fail", async () => {
    const r = await decide({ ...hourly, HERDR_APP_VERSION: "0.1.14" }, { version: "0.1.14", result: "maybe" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("neither pass nor fail");
  });
});

describe("record", () => {
  test("writes the version and the result where decide reads them", async () => {
    const r = await run(["record", "fail"], { HERDR_APP_VERSION: "0.1.15" });
    expect(r.code).toBe(0);
    expect(await readFile(join(r.root, "host-result/VERSION"), "utf8")).toBe("0.1.15\n");
    expect(await readFile(join(r.root, "host-result/RESULT"), "utf8")).toBe("fail\n");
  });

  test("refuses anything but pass or fail", async () => {
    const r = await run(["record", "skipped"], { HERDR_APP_VERSION: "0.1.15" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("record takes pass or fail");
  });
});
