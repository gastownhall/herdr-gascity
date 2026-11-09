// The single-authority and no-dynamic-code lint (design §8, §9).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultTargets, lintSource, lintTree, type AllowEntry, type RuleId } from "../../scripts/authority.ts";

const ROOT = join(import.meta.dir, "../..");
const FIXTURES = join(ROOT, "test/fixtures/authority");
const fixture = (name: string) => readFile(join(FIXTURES, name), "utf8");
const rules = (file: string, text: string, allow: readonly AllowEntry[] = []) =>
  lintSource(file, text, allow).map((v) => v.rule);

describe("the real tree", () => {
  test("src/ and the built bundle are clean", async () => {
    expect(await lintTree(ROOT)).toEqual([]);
  });

  test("the lint covers every source file and the committed bundle", async () => {
    const targets = await defaultTargets(ROOT);
    expect(targets).toContain("src/main.ts");
    expect(targets).toContain("src/host.ts");
    expect(targets).toContain("gascity/main.js");
    expect(targets.every((t) => t.startsWith("src/") || t.startsWith("gascity/"))).toBe(true);
  });
});

describe("negative fixtures", () => {
  const cases: [string, RuleId, number][] = [
    ["hc-call.ts", "hc", 4],
    ["exec-tmux.ts", "tmux", 4],
    ["terminal-kill.ts", "terminal-command", 4],
    ["eval.ts", "eval", 2],
    ["new-function.ts", "function-constructor", 2],
  ];
  for (const [name, rule, line] of cases) {
    test(`${name} is rejected (${rule})`, async () => {
      const violations = lintSource(`test/fixtures/authority/${name}`, await fixture(name));
      expect(violations.map((v) => [v.rule, v.line])).toEqual([[rule, line]]);
    });
  }

  test("comments and look-alike names are not hits", async () => {
    expect(lintSource("test/fixtures/authority/clean.ts", await fixture("clean.ts"))).toEqual([]);
  });
});

describe("rules", () => {
  test("hc: any use of the hc export, or hc as a program", () => {
    expect(rules("a.ts", 'import { hc } from "herdr";')).toEqual(["hc"]);
    expect(rules("a.ts", 'herdr["hc"](["ls"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'exec("/usr/local/bin/hc", ["ls"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'exec("sh", ["-c", "hc kill t1"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'const hcAddress = "t7"; exec("echo", ["hcx"]);')).toEqual([]);
  });

  test("tmux and bd as programs", () => {
    expect(rules("a.ts", 'exec("tmux", ["ls"]);')).toEqual(["tmux"]);
    expect(rules("a.ts", 'exec("tmux -L city kill-server");')).toEqual(["tmux"]);
    expect(rules("a.ts", "exec(`bd`, [`close`, id]);")).toEqual(["bd"]);
    expect(rules("a.ts", 'exec("/opt/bin/bd", ["close"]);')).toEqual(["bd"]);
  });

  test("terminal.kill/send/keys/label/keep, and dynamically built terminal commands", () => {
    for (const verb of ["kill", "send", "keys", "label", "keep"]) {
      expect(rules("a.ts", `run("terminal.${verb}", {});`)).toEqual(["terminal-command"]);
    }
    expect(rules("a.ts", "run(`terminal.${verb}`, {});")).toEqual(["terminal-command"]);
    expect(rules("a.ts", 'run("terminal." + verb, {});')).toEqual(["terminal-command"]);
    expect(rules("a.ts", 'run("tab.select", { id });')).toEqual([]);
  });

  test("eval and the Function constructor in every spelling", () => {
    expect(rules("a.ts", "(0, eval)(code);")).toEqual(["eval"]);
    expect(rules("a.ts", 'globalThis["eval"](code);')).toEqual(["eval"]);
    expect(rules("a.ts", 'Function("return 1")();')).toEqual(["function-constructor"]);
    expect(rules("a.ts", "const F = Function; new F(code);")).toEqual(["function-constructor"]);
    expect(rules("a.ts", 'globalThis["Function"];')).toEqual(["function-constructor"]);
  });

  test("dynamic import", () => {
    expect(rules("a.ts", 'const m = await import("./x.js");')).toEqual(["dynamic-import"]);
    expect(rules("a.ts", 'import { x } from "./x.ts";')).toEqual([]);
  });

  test("zod is imported only through src/gc/zod.ts, which turns on jitless first", () => {
    expect(rules("src/vm/a.ts", 'import { z } from "zod/mini";')).toEqual(["zod-import"]);
    expect(rules("src/vm/a.ts", 'export * from "zod";')).toEqual(["zod-import"]);
    expect(rules("src/vm/a.ts", 'import { z } from "../gc/zod.ts";')).toEqual([]);
    const ok = 'import { z } from "zod/mini";\nz.config({ jitless: true });\nexport { z };';
    expect(rules("src/gc/zod.ts", ok)).toEqual([]);
    expect(rules("src/gc/zod.ts", 'import { z } from "zod/mini";\nexport { z };')).toEqual(["zod-jitless"]);
    expect(rules("src/gc/zod.ts", 'import { z } from "zod/mini";\nz.config({ jitless: false });\nexport { z };'))
      .toEqual(["zod-jitless"]);
  });
});

describe("allowlist", () => {
  // The shape of zod v4's guarded probe, which jitless never reaches.
  const probe = "try {\n  const F = Function;\n  new F(\"\");\n  return true;\n} catch (_) {\n  return false;\n}";
  const entry: AllowEntry = { file: "gascity/main.js", rule: "function-constructor", text: probe, reason: "test" };

  test("allows a hit only inside the exact allowlisted text", () => {
    expect(rules("gascity/main.js", `function allowsEval() {\n${probe}\n}`, [entry])).toEqual([]);
    expect(rules("gascity/main.js", `function allowsEval() {\n${probe}\n}\nnew Function("x");`, [entry]))
      .toEqual(["function-constructor"]);
  });

  test("an edited snippet is no longer allowed and the entry is reported stale", () => {
    const edited = probe.replace('new F("")', 'new F("return 1")');
    expect(rules("gascity/main.js", edited, [entry]).sort()).toEqual(["function-constructor", "stale-allowlist"]);
  });

  test("an entry only covers its own rule and file", () => {
    expect(rules("src/other.ts", probe, [entry])).toEqual(["function-constructor"]);
    expect(rules("gascity/main.js", `${probe}\neval(x);`, [entry])).toEqual(["eval"]);
  });
});

describe("command line", () => {
  const cli = (...args: string[]) =>
    Bun.spawnSync(["bun", "scripts/authority.ts", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });

  test("exits 0 on the real tree", () => {
    const r = cli();
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });

  test("exits 1 on each negative fixture and names the rule and position", () => {
    for (const [name, where] of [
      ["hc-call.ts", ":4:"], ["new-function.ts", ":2:"], ["eval.ts", ":2:"],
      ["exec-tmux.ts", ":4:"], ["terminal-kill.ts", ":4:"],
    ] as const) {
      const r = cli(`test/fixtures/authority/${name}`);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain(`test/fixtures/authority/${name}${where}`);
    }
  });
});
