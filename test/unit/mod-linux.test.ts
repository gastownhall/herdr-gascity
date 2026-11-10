// canary/mod-linux.sh never touches a person's gc: the city stage refuses to
// run outside CI without the throwaway-home opt-in, or into a GC_HOME that
// exists, and teardown stops only the supervisor the city stage recorded.
// gc is a fake that logs its arguments and reports a supervisor pid.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../canary/mod-linux.sh");
const FAKE_GC = `#!/bin/sh
printf '%s\\n' "$*" >>"$FAKE_GC_LOG"
case "$*" in
  "supervisor status --json") printf '{"running":true,"pid":%s}\\n' "$FAKE_GC_PID" ;;
esac
`;

let dir: string;
let home: string;
let root: string;
let gcLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mod-linux-"));
  home = join(dir, "home");
  root = join(dir, "canary");
  gcLog = join(dir, "gc.log");
  mkdirSync(home);
  mkdirSync(join(root, "gc"), { recursive: true });
  writeFileSync(join(root, "gc", "gc"), FAKE_GC);
  chmodSync(join(root, "gc", "gc"), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], extra: Record<string, string> = {}, pid = 4242) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(GITHUB_ACTIONS|GC_HOME|HERDR_.*|CANARY_.*|RUNNER_TEMP|XDG_.*)$/.test(k)) env[k] = v;
  }
  Object.assign(env, { HOME: home, CANARY_ROOT: root, FAKE_GC_LOG: gcLog, FAKE_GC_PID: String(pid) }, extra);
  const r = Bun.spawnSync(["bash", SCRIPT, ...args], { env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stderr: r.stderr.toString(), gcCalls: existsSync(gcLog) ? readFileSync(gcLog, "utf8").trim().split("\n") : [] };
}

const marker = (o: { gc_home: string; pid: number }) => writeFileSync(join(root, "supervisor.json"), JSON.stringify({ ...o, api: "http://127.0.0.1:8372" }));

describe("mod-linux.sh city refuses a home that may be a person's", () => {
  test("outside CI without the opt-in", () => {
    const r = run(["city"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("HERDR_CANARY_THROWAWAY_HOME");
    expect(r.gcCalls).toEqual([]);
    expect(existsSync(join(home, ".gc"))).toBe(false);
  });

  test("with an opt-in that names another directory than HOME", () => {
    const r = run(["city"], { HERDR_CANARY_THROWAWAY_HOME: join(dir, "elsewhere") });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("outside CI");
    expect(r.gcCalls).toEqual([]);
  });

  test("in CI, when GC_HOME already exists", () => {
    mkdirSync(join(home, ".gc"));
    writeFileSync(join(home, ".gc", "supervisor.toml"), "[supervisor]\nport = 8372\n");
    const r = run(["city"], { GITHUB_ACTIONS: "true" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("already exists");
    expect(r.gcCalls).toEqual([]);
  });

  test("with the opt-in, when GC_HOME already exists", () => {
    mkdirSync(join(home, ".gc"));
    const r = run(["city"], { HERDR_CANARY_THROWAWAY_HOME: home });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("already exists");
    expect(r.gcCalls).toEqual([]);
  });
});

describe("mod-linux.sh teardown stops only the recorded supervisor", () => {
  const stops = (calls: string[]) => calls.filter((c) => c.startsWith("supervisor stop"));

  test("no record: nothing stopped, gc never run", () => {
    const r = run(["teardown"], { GITHUB_ACTIONS: "true" });
    expect(r.code).toBe(0);
    expect(r.gcCalls).toEqual([]);
    expect(r.stderr).toContain("nothing to stop");
  });

  test("the recorded supervisor, still running: stopped and the record removed", () => {
    marker({ gc_home: join(home, ".gc"), pid: 4242 });
    const r = run(["teardown"], {}, 4242);
    expect(r.code).toBe(0);
    expect(stops(r.gcCalls)).toEqual(["supervisor stop --wait"]);
    expect(existsSync(join(root, "supervisor.json"))).toBe(false);
  });

  test("another supervisor running now: left alone", () => {
    marker({ gc_home: join(home, ".gc"), pid: 4242 });
    const r = run(["teardown"], {}, 777);
    expect(r.code).toBe(0);
    expect(stops(r.gcCalls)).toEqual([]);
    expect(r.stderr).toContain("left alone");
  });

  test("a record for another GC_HOME: left alone, gc never run", () => {
    marker({ gc_home: join(dir, "other", ".gc"), pid: 4242 });
    const r = run(["teardown"], {}, 4242);
    expect(r.code).toBe(0);
    expect(r.gcCalls).toEqual([]);
    expect(r.stderr).toContain("left alone");
  });
});
