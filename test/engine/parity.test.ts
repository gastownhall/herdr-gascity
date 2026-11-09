// Engine parity for the gc client and its jitless zod decoders.
// herdr-app runs mods in QuickJS (a quickjs-jit fork), not in
// bun's JavaScriptCore. This test bundles test/engine/entry.ts with the mod's
// own esbuild options and:
//   1. lints that bundle with the authority lint and no allowlist entry but
//      the bundle's one constructor-read (zod's plain-object check):
//      zod/mini's object schema has no JIT path, and with only the used
//      builders re-exported esbuild drops zod's guarded `Function` sites
//      (util.allowsEval, Doc.compile, compileFn) altogether;
//   2. runs it in QuickJS (quickjs-ng, compiled to wasm) with the Function
//      constructor and eval replaced by throwing traps, over every recorded
//      fixture, and requires: no trap was ever hit, jitless was on, and the
//      results are identical to the same bundle's results in bun.
// QuickJS-ng is the same engine family as herdr's, not herdr's engine; the
// real-app smoke test covers the rest.

import { describe, expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSContext } from "quickjs-emscripten-core";
import { BUNDLE_OPTIONS, HOST_MODULES, ROOT } from "../../build.ts";
import { ALLOWLIST, lintSource } from "../../scripts/authority.ts";
import { FIXTURES } from "../contract/record.ts";
import type { ProbeFixture } from "./entry.ts";

async function bundleProbe(): Promise<string> {
  const result = await build({
    ...BUNDLE_OPTIONS,
    external: [...HOST_MODULES],
    mainFields: [...BUNDLE_OPTIONS.mainFields],
    absWorkingDir: ROOT,
    entryPoints: ["test/engine/entry.ts"],
    outfile: "probe.js",
  });
  const [file] = result.outputFiles;
  if (!file) throw new Error("esbuild produced no output");
  return file.text;
}

async function loadFixtures(): Promise<ProbeFixture[]> {
  const out: ProbeFixture[] = [];
  for (const op of (await readdir(FIXTURES)).sort()) {
    for (const file of (await readdir(join(FIXTURES, op))).sort()) {
      const f = JSON.parse(await readFile(join(FIXTURES, op, file), "utf8")) as { status: number; body: unknown };
      out.push({ op, name: file.replace(/\.json$/, ""), status: f.status, body: f.body });
    }
  }
  return out;
}

/** The sync scenario's report (test/engine/entry.ts syncScenario). */
interface SyncSummary {
  cursor: number;
  closed: [number, string][];
  batches: { seqs: number[]; resync: string | null }[];
  outage: { kind: string };
  connection: { kind: string };
  errors: number;
  budget: { maxInFlight: number };
  stores: number;
  agents: { groups: { key: string; agents: { name: string; sessions: { id: string; status: { kind: string } }[] }[] }[]; region: { kind: string } };
  detail: { kind: string; id?: string };
  board: {
    hidden: number;
    ready: { cards: { id: string }[] };
    closed: { recent: { id: string; seq: number; closeReason: string | null }[]; earlier: { id: string }[] };
  };
  beadDetail: { kind: string; id?: string; closeReason?: string | null; description?: string | null };
  sanitized: string[];
  actions: { kind: string; state: string; attempt: number }[];
  activity: [string, string, string][];
  keyShapes: boolean[];
  retryOk: boolean;
  sameKeyRetry: boolean;
  workPosts: { path: string; body: unknown; key: string }[];
}

/** The command scenario's report (test/engine/entry.ts commandScenario). */
interface CommandSummary {
  roundTrip: { raw: string; command?: unknown; written?: string; same?: boolean; error?: string }[];
  refused: { raw: string; error?: string; accepted?: unknown }[];
  toasts: string[][];
  focus: unknown[];
}

const probe = await bundleProbe();
const fixtures = JSON.stringify(await loadFixtures());

/**
 * Replaces every way to compile code at run time with traps that count and
 * throw: the Function and eval globals, and the `constructor` of the plain,
 * async, generator and async-generator function prototypes (so an aliased
 * `(() => {}).constructor(code)` is caught too).
 */
const POISON = `
globalThis.__dynamicCode = 0;
// The target keeps each prototype link real, so instanceof checks behave as before.
const trap = (what, target) => new Proxy(target, {
  construct() { globalThis.__dynamicCode++; throw new EvalError(what + " is forbidden"); },
  apply() { globalThis.__dynamicCode++; throw new EvalError(what + " is forbidden"); },
});
const prototypes = [
  ["Function", Function.prototype],
  ["AsyncFunction", Object.getPrototypeOf(async function () {})],
  ["GeneratorFunction", Object.getPrototypeOf(function* () {})],
  ["AsyncGeneratorFunction", Object.getPrototypeOf(async function* () {})],
];
for (const [name, proto] of prototypes) {
  Object.defineProperty(proto, "constructor", { value: trap(name, proto.constructor), writable: false, configurable: false });
}
globalThis.Function = trap("Function", Function);
globalThis.eval = trap("eval", eval);
`;

function check(vm: QuickJSContext, result: ReturnType<QuickJSContext["evalCode"]>): void {
  if (result.error) {
    const e = vm.dump(result.error);
    result.error.dispose();
    throw new Error(`QuickJS: ${JSON.stringify(e)}`);
  }
  result.value.dispose();
}

/** Evaluates `module` then awaits `expression` in a poisoned QuickJS context. */
async function runInQuickJS(module: string, expression: string): Promise<{ output: string; dynamicCode: number }> {
  const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
  const vm = QuickJS.newContext();
  try {
    check(vm, vm.evalCode(POISON, "poison.js"));
    check(vm, vm.evalCode(module, "probe.mjs", { type: "module" }));
    vm.runtime.executePendingJobs();
    const call = vm.evalCode(expression, "run.js");
    if (call.error) throw new Error(`QuickJS: ${JSON.stringify(vm.dump(call.error))}`);
    const promise = call.value;
    let state = vm.getPromiseState(promise);
    for (let i = 0; i < 1000 && state.type === "pending"; i++) {
      vm.runtime.executePendingJobs();
      state = vm.getPromiseState(promise);
    }
    promise.dispose();
    if (state.type === "pending") throw new Error("QuickJS: probe never settled");
    if (state.type === "rejected") throw new Error(`QuickJS: ${JSON.stringify(vm.dump(state.error))}`);
    const output = vm.getString(state.value);
    state.value.dispose();
    const counter = vm.getProp(vm.global, "__dynamicCode");
    const dynamicCode = vm.getNumber(counter);
    counter.dispose();
    return { output, dynamicCode };
  } finally {
    vm.dispose();
  }
}

async function runInBun(): Promise<string> {
  // The same bundle text, evaluated as a module by bun.
  const dir = await mkdtemp(join(tmpdir(), "gc-engine-probe-"));
  try {
    const file = join(dir, "probe.mjs");
    await writeFile(file, probe);
    await import(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const g = globalThis as { __gcEngineProbe?: { run: (f: string) => Promise<string> } };
  if (!g.__gcEngineProbe) throw new Error("probe did not register");
  return g.__gcEngineProbe.run(fixtures);
}

describe("the bundled gc client with zod, and the sync engine", () => {
  test("passes the authority lint with no allowlist: tree-shaken zod/mini keeps no Function site", () => {
    // No allowlist entry may cover a code-compiling site. The probe is linted
    // with only the bundle's constructor-read entry (zod's plain-object check,
    // matched by exact text, at most once): nothing else is allowed.
    expect(ALLOWLIST.filter((e) => e.rule === "function-constructor" || e.rule === "eval")).toEqual([]);
    const reads = ALLOWLIST.filter((e) => e.rule === "constructor-read" && e.file === "gascity/main.js");
    expect(reads).toHaveLength(1);
    expect(lintSource("gascity/main.js", probe, reads).filter((v) => v.rule !== "stale-allowlist")).toEqual([]);
    expect(probe).toContain("config({ jitless: true });");
  });

  test("runs in QuickJS with Function/eval trapped, jitless, and matches bun exactly", async () => {
    const quick = await runInQuickJS(probe, `globalThis.__gcEngineProbe.run(${JSON.stringify(fixtures)})`);
    expect(quick.dynamicCode).toBe(0);
    const parsed = JSON.parse(quick.output) as { jitless: boolean; results: { fixture: string; ok: boolean }[] };
    expect(parsed.jitless).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(40);
    expect(parsed.results.find((r) => r.fixture === "get-health/malformed")?.ok).toBe(false);
    const sync = (JSON.parse(quick.output) as { sync: SyncSummary }).sync;
    expect(sync.cursor).toBe(7);
    expect(sync.closed).toEqual([[2, "sc-74"]]);
    expect(sync.batches).toEqual([{ seqs: [2, 3], resync: null }, { seqs: [4, 5, 6, 7], resync: null }]);
    expect(sync.outage.kind).toBe("backing-off");
    expect(sync.connection).toEqual({ kind: "connected" });
    expect(sync.errors).toBeGreaterThan(0);
    expect(sync.budget.maxInFlight).toBeLessThanOrEqual(2);
    expect(sync.stores).toBe(0);
    // the agents panel's view-models and the sanitiser over the same snapshot
    expect(sync.agents.region.kind).toBe("ok");
    expect(sync.agents.groups.map((g) => g.key)).toEqual(["rig:frontend", "city"]);
    expect(sync.agents.groups.flatMap((g) => g.agents.flatMap((a) => a.sessions.map((x) => x.id))).sort()).toEqual(["sc-20", "sc-5", "sc-6"]);
    expect(sync.detail).toMatchObject({ kind: "session", id: "sc-20" });
    // the work board over the same snapshot: the closed bead left Ready and heads Recently closed
    expect(sync.board.ready.cards.map((c) => c.id)).toEqual(["sc-18", "fe-1", "sc-58"]);
    expect(sync.board.closed.recent).toMatchObject([{ id: "sc-74", seq: 2, closeReason: "closed in the scenario" }]);
    expect(sync.board.closed.earlier.map((c) => c.id)).not.toContain("sc-60");
    expect(sync.board.hidden).toBe(2); // the session bead in the seed, and the session close
    expect(sync.beadDetail).toMatchObject({ kind: "bead", id: "sc-74", closeReason: "closed in the scenario", description: "recorded for the herdr-gascity contract fixtures" });
    // actions: a 202 followed to "delivered", an answer, a 503 retried with the same key, and one whose copy went (unknown, not pending)
    expect(sync.actions).toEqual([
      { kind: "session.submit", state: "done", attempt: 1 },
      { kind: "session.respond", state: "done", attempt: 1 },
      { kind: "session.stop", state: "done", attempt: 2 },
      { kind: "bead.create", state: "done", attempt: 1 },
      { kind: "bead.sling", state: "done", attempt: 1 },
      { kind: "session.wake", state: "unknown", attempt: 1 },
    ]);
    expect(sync.activity[5]).toEqual(["Send · session sc-20", "done", "delivered"]);
    // a work action: a new bead (with its Idempotency-Key), then the sling of the created bead (none: gc declares none)
    expect(sync.workPosts).toEqual([
      { path: "/v0/city/scratch/beads", body: { title: "recorder bead mw8vmef1", priority: 2 }, key: "uuid" },
      { path: "/v0/city/scratch/sling", body: { target: "worker", bead: "sc-74" }, key: "none" },
    ]);
    expect(sync.activity[1]).toEqual(["Sling to worker · bead sc-74", "done", "gc: slung bead sc-74 to worker; convoy sc-75"]);
    expect(sync.activity[2]?.[2]).toMatch(/^gc: created bead sc-74; then Sling to worker: sent \(action \d+\)$/);
    expect(sync.retryOk).toBe(true);
    expect(sync.sameKeyRetry).toBe(true);
    expect(sync.keyShapes).toEqual([true, true, true, true, true]);
    expect(sync.sanitized).toEqual([
      "abcde f",
      "line\nnext",
      "request to http://127.0.0.1:8372/health was cancelled: the Gas City view that started it closed",
    ]);
    const commands = (JSON.parse(quick.output) as { commands: CommandSummary }).commands;
    expect(commands.roundTrip.every((r) => r.same === true)).toBe(true);
    expect(commands.roundTrip.find((r) => r.raw.startsWith("submit"))?.command).toEqual({ verb: "submit", session: "sc-20", text: "close fe-1: \u2713 done" });
    expect(commands.refused.map((r) => r.error)).toEqual([
      'unknown command "explode"', "wake: expected wake:<session>", "argument 1 has a bad percent escape",
      'close: the argument after <session> can only be "confirm"', 'probe: expected "on" or "off", got "maybe"',
      undefined,
    ]);
    expect(commands.toasts).toEqual([[], ["sc-6/b"], []]);
    expect(commands.focus).toEqual([{ city: "scratch", session: "sc-20", seq: 2, at: 2000 }, null]);
    expect(quick.output).toBe(await runInBun());
  }, 60_000);

  test("the traps catch every aliased way to compile code", async () => {
    const attempts = [
      "(function () {}).constructor('return 1')",
      "(() => {}).constructor('return 1')",
      "(async function () {}).constructor('return 1')",
      "(function* () {}).constructor('return 1')",
      "(async function* () {}).constructor('return 1')",
      "new Function('return 1')",
      "(0, eval)('1')",
    ];
    const module = `globalThis.__attempt = async () => { let caught = 0; for (const code of ${JSON.stringify(attempts)}) {
      try { (0, globalThis.__run)(code); } catch (_) { caught++; } } return String(caught); };`;
    // __run evaluates each attempt as an expression without itself compiling code.
    const runner = `globalThis.__run = (code) => ({
      ${attempts.map((a, i) => `${JSON.stringify(a)}: () => ${a}`).join(",\n")}
    })[code]();`;
    const r = await runInQuickJS(`${runner}\n${module}`, "globalThis.__attempt()");
    expect(r.output).toBe(String(attempts.length));
    expect(r.dynamicCode).toBe(attempts.length);
  });
});
