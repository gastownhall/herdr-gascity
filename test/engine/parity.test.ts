// Engine parity for the gc client and its jitless zod decoders (design §4,
// §13.1, risk 3). herdr-app runs mods in QuickJS (a quickjs-jit fork), not in
// bun's JavaScriptCore. This test bundles test/engine/entry.ts with the mod's
// own esbuild options and:
//   1. lints that bundle with the authority lint and an empty allowlist:
//      zod/mini's object schema has no JIT path, and with only the used
//      builders re-exported esbuild drops zod's guarded `Function` sites
//      (util.allowsEval, Doc.compile, compileFn) altogether;
//   2. runs it in QuickJS (quickjs-ng, compiled to wasm) with the Function
//      constructor and eval replaced by throwing traps, over every recorded
//      fixture, and requires: no trap was ever hit, jitless was on, and the
//      results are identical to the same bundle's results in bun.
// QuickJS-ng is the same engine family as herdr's, not herdr's engine; the
// real-app smoke (slice M8) covers the rest.

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

const probe = await bundleProbe();
const fixtures = JSON.stringify(await loadFixtures());

/** Replaces Function and eval with traps that count and throw. */
const POISON = `
globalThis.__dynamicCode = 0;
const RealFunction = Function;
globalThis.Function = new Proxy(RealFunction, {
  construct() { globalThis.__dynamicCode++; throw new EvalError("Function constructor is forbidden"); },
  apply() { globalThis.__dynamicCode++; throw new EvalError("Function constructor is forbidden"); },
});
globalThis.eval = function () { globalThis.__dynamicCode++; throw new EvalError("eval is forbidden"); };
`;

function check(vm: QuickJSContext, result: ReturnType<QuickJSContext["evalCode"]>): void {
  if (result.error) {
    const e = vm.dump(result.error);
    result.error.dispose();
    throw new Error(`QuickJS: ${JSON.stringify(e)}`);
  }
  result.value.dispose();
}

async function runInQuickJS(): Promise<{ output: string; dynamicCode: number }> {
  const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
  const vm = QuickJS.newContext();
  try {
    check(vm, vm.evalCode(POISON, "poison.js"));
    check(vm, vm.evalCode(probe, "probe.mjs", { type: "module" }));
    vm.runtime.executePendingJobs();
    const call = vm.evalCode(`globalThis.__gcEngineProbe.run(${JSON.stringify(fixtures)})`, "run.js");
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

describe("the bundled gc client with zod", () => {
  test("passes the authority lint with no allowlist: tree-shaken zod/mini keeps no Function site", () => {
    expect(ALLOWLIST).toEqual([]);
    expect(lintSource("gascity/main.js", probe)).toEqual([]);
    expect(probe).toContain("config({ jitless: true });");
  });

  test("runs in QuickJS with Function/eval trapped, jitless, and matches bun exactly", async () => {
    const quick = await runInQuickJS();
    expect(quick.dynamicCode).toBe(0);
    const parsed = JSON.parse(quick.output) as { jitless: boolean; results: { fixture: string; ok: boolean }[] };
    expect(parsed.jitless).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(40);
    expect(parsed.results.find((r) => r.fixture === "get-health/malformed")?.ok).toBe(false);
    expect(quick.output).toBe(await runInBun());
  }, 60_000);
});
