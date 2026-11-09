// The authority lint: gc is the only authority over its sessions, and the mod
// never compiles code at run time.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALLOWLIST, EXEC_PROGRAMS, RUN_COMMANDS, TERMINAL_DENY, defaultTargets, lintSource, lintTree, type AllowEntry, type RuleId,
} from "../../scripts/authority.ts";
import { GC_STATUS_ARGS } from "../../src/discovery/gcStatus.ts";

const ROOT = join(import.meta.dir, "../..");
const FIXTURES = join(ROOT, "test/fixtures/authority");
const fixture = (name: string) => readFile(join(FIXTURES, name), "utf8");
const rules = (file: string, text: string, allow: readonly AllowEntry[] = []) =>
  lintSource(file, text, allow).map((v) => v.rule).sort();
/** Lints `body` in a file that imports the herdr namespace, as src/host.ts does. */
const hostRules = (body: string) => rules("src/host.ts", `import * as herdr from "herdr";\n${body}`);

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
  const cases: [string, RuleId[], number][] = [
    ["hc-call.ts", ["hc"], 4],
    ["exec-tmux.ts", ["exec-program", "tmux"], 4],
    ["terminal-kill.ts", ["run-command", "terminal-command"], 4],
    ["eval.ts", ["eval"], 2],
    ["new-function.ts", ["function-constructor"], 2],
  ];
  for (const [name, expected, line] of cases) {
    test(`${name} is rejected (${expected.join(", ")})`, async () => {
      const violations = lintSource(`test/fixtures/authority/${name}`, await fixture(name));
      expect(violations.map((v) => v.rule).sort()).toEqual(expected);
      expect(new Set(violations.map((v) => v.line))).toEqual(new Set([line]));
    });
  }

  test("comments, look-alike names and Object.prototype names are not hits", async () => {
    expect(lintSource("test/fixtures/authority/clean.ts", await fixture("clean.ts"))).toEqual([]);
  });
});

describe("bypass fixtures", () => {
  const cases: Record<string, RuleId[]> = {
    "terminal-paste.ts": ["run-command", "terminal-command"],
    "terminal-park.ts": ["run-command", "terminal-command"],
    "terminal-concat.ts": ["run-command"],
    "terminal-join.ts": ["run-command"],
    "terminal-template.ts": ["run-command"],
    "exec-join.ts": ["exec-program"],
    "shell-and.ts": ["exec-program", "hc"],
    "shell-env.ts": ["exec-program", "tmux"],
    "exec-case.ts": ["exec-program", "tmux"],
    "string-raw.ts": ["exec-program"],
    "run-alias.ts": ["host-access", "terminal-command"],
    "element-access.ts": ["host-access", "terminal-command"],
    "namespace-escape.ts": ["host-access"],
    "named-import.ts": ["host-import"],
    "process-module.ts": ["hc", "module-import", "process", "process"],
    "process-global.ts": ["process"],
    "constructor.ts": ["function-constructor", "function-constructor", "function-constructor"],
  };

  test("every bypass fixture has an expectation", async () => {
    const files = (await readdir(join(FIXTURES, "bypass"))).filter((f) => f.endsWith(".ts")).sort();
    expect(files).toEqual(Object.keys(cases).sort());
  });

  for (const [name, expected] of Object.entries(cases)) {
    test(`${name} is rejected (${expected.join(", ")})`, async () => {
      expect(rules(`test/fixtures/authority/bypass/${name}`, await fixture(`bypass/${name}`))).toEqual(expected);
    });
  }
});

describe("rules", () => {
  test("rule tables are not fooled by Object.prototype names", () => {
    const text = 'x.toString(); x.valueOf(); x.hasOwnProperty("a"); x.constructor.name; o.__proto__;\n'
      + 'const s = ["__proto__", "toString", "constructor", "hasOwnProperty", "valueOf"]; const constructor = 1;';
    expect(rules("a.ts", text)).toEqual([]);
  });

  test("hc: any use of the hc export, or hc as a program", () => {
    expect(rules("a.ts", 'import { hc } from "herdr";')).toEqual(["hc", "host-import"]);
    expect(rules("a.ts", 'herdr["hc"](["ls"]);')).toEqual(["hc"]);
    expect(hostRules('herdr.hc(["ls"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'exec("/usr/local/bin/hc", ["ls"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'exec("sh", ["-c", "hc kill t1"]);')).toEqual(["hc"]);
    expect(rules("a.ts", 'const hcAddress = "t7"; exec("echo", ["hcx", "bd-12"]);')).toEqual([]);
  });

  test("tmux, bd and hc anywhere in a shell string, in any case", () => {
    expect(rules("a.ts", 'exec("tmux", ["ls"]);')).toEqual(["tmux"]);
    expect(rules("a.ts", 'exec("TMUX");')).toEqual(["tmux"]);
    expect(rules("a.ts", 'exec("tmux -L city kill-server");')).toEqual(["tmux"]);
    expect(rules("a.ts", "exec(`bd`, [`close`, id]);")).toEqual(["bd"]);
    expect(rules("a.ts", 'exec("/opt/bin/bd", ["close"]);')).toEqual(["bd"]);
    expect(rules("a.ts", 'sh("cd /tmp && hc kill t1");')).toEqual(["hc"]);
    expect(rules("a.ts", 'sh("true; FOO=1 BAR=2 tmux kill-server");')).toEqual(["tmux"]);
    expect(rules("a.ts", 'sh("x | /usr/bin/Bd close gc-1");')).toEqual(["bd"]);
    expect(rules("a.ts", 'sh("echo $(hc ls)");')).toEqual(["hc"]);
  });

  test("terminal commands from herdr's command table, and dynamically built ones", () => {
    for (const command of TERMINAL_DENY) {
      expect(rules("a.ts", `run("${command}", {});`)).toEqual(["terminal-command"]);
    }
    expect(TERMINAL_DENY).toEqual(expect.arrayContaining([
      "terminal.kill", "terminal.keep", "terminal.park", "terminal.pin", "terminal.paste", "terminal.paste_image",
      "terminal.send", "terminal.keys", "terminal.label",
    ]));
    expect(rules("a.ts", "run(`terminal.${verb}`, {});")).toEqual(["terminal-command"]);
    expect(rules("a.ts", 'run("terminal." + verb, {});')).toEqual(["terminal-command"]);
    expect(rules("a.ts", 'run("tab.select", { id });')).toEqual([]);
  });

  test("herdr is imported only by src/host.ts, and only as a namespace", () => {
    expect(rules("src/host.ts", 'import * as herdr from "herdr";')).toEqual([]);
    expect(rules("src/vm/a.ts", 'import * as herdr from "herdr";')).toEqual(["host-import"]);
    expect(rules("src/host.ts", 'import herdr from "herdr";')).toEqual(["host-import"]);
    expect(rules("src/host.ts", 'import { theme } from "herdr";')).toEqual(["host-import"]);
    expect(rules("src/host.ts", 'export * from "herdr";')).toEqual(["host-import"]);
    expect(rules("gascity/main.js", 'import * as herdr from "herdr";')).toEqual([]);
  });

  test("the herdr namespace is used only as herdr.<export>", () => {
    expect(hostRules("const t = herdr.theme(); const f = herdr.theme; typeof herdr.run;")).toEqual([]);
    expect(hostRules("const all = { ...herdr };")).toEqual(["host-access"]);
    expect(hostRules('const t = herdr["theme"];')).toEqual(["host-access"]);
    expect(hostRules("use(herdr);")).toEqual(["host-access"]);
    expect(hostRules("const { run } = herdr;")).toEqual(["host-access"]);
  });

  test("run takes a literal command from the allowlist; exec a literal program from its allowlist", () => {
    expect(RUN_COMMANDS).toEqual(["tab.new", "tab.select", "mod.open"]);
    expect(EXEC_PROGRAMS).toEqual(["xdg-open", "open"]);
    for (const command of RUN_COMMANDS) expect(hostRules(`herdr.run("${command}", {});`)).toEqual([]);
    for (const program of EXEC_PROGRAMS) expect(hostRules(`herdr.exec("${program}", [url]);`)).toEqual([]);
    expect(hostRules("herdr.run(`tab.new`, {});")).toEqual([]);
    expect(hostRules('herdr.run("space.close", {});')).toEqual(["run-command"]);
    expect(hostRules("herdr.run(command, {});")).toEqual(["run-command"]);
    expect(hostRules("herdr.run();")).toEqual(["run-command"]);
    expect(hostRules('herdr.exec("gc", ["status"]);')).toEqual(["exec-program"]);
    expect(hostRules("herdr.exec(bin, []);")).toEqual(["exec-program"]);
    expect(hostRules("const run = herdr.run;")).toEqual(["host-access"]);
    expect(hostRules('[herdr.run][0]("tab.new");')).toEqual(["host-access"]);
  });

  test("only allowed modules: gpui-kit, gpui-base, herdr, zod and relative paths", () => {
    expect(rules("src/a.ts", 'import { View } from "gpui-kit";\nimport { v_flex } from "gpui-base";\nimport { x } from "./x.ts";')).toEqual([]);
    for (const specifier of ["process", "net", "os", "fs/promises", "websocket", "gpui-shell", "node:child_process"]) {
      expect(rules("src/a.ts", `import m from "${specifier}";`)).toEqual(["module-import"]);
    }
    expect(rules("src/a.ts", 'import "gpui-shell";')).toEqual(["module-import"]);
    expect(rules("src/a.ts", 'export { run } from "process";')).toEqual(["module-import"]);
  });

  test("the process global (process.run spawns programs)", () => {
    expect(rules("a.ts", 'process.run("ls");')).toEqual(["process"]);
    expect(rules("a.ts", 'globalThis.process.run("ls");')).toEqual(["process"]);
    expect(rules("a.ts", 'globalThis["process"].run("ls");')).toEqual(["process"]);
  });

  test("eval and the Function constructor in every spelling", () => {
    expect(rules("a.ts", "(0, eval)(code);")).toEqual(["eval"]);
    expect(rules("a.ts", 'globalThis["eval"](code);')).toEqual(["eval"]);
    expect(rules("a.ts", 'Function("return 1")();')).toEqual(["function-constructor"]);
    expect(rules("a.ts", "const F = Function; new F(code);")).toEqual(["function-constructor"]);
    expect(rules("a.ts", 'globalThis["Function"];')).toEqual(["function-constructor"]);
    expect(rules("a.ts", "(() => 0).constructor(code);")).toEqual(["function-constructor"]);
    expect(rules("a.ts", "(async () => {}).constructor(code)();")).toEqual(["function-constructor"]);
    expect(rules("a.ts", "new (function* () {})[\"constructor\"](code);")).toEqual(["function-constructor"]);
    expect(rules("a.ts", "Reflect.construct(f.constructor, [code]);")).toEqual(["function-constructor"]);
    expect(rules("a.ts", "Reflect.construct(C, [code]);")).toEqual(["function-constructor"]);
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

describe("the one allowlisted exec: gcBin supervisor status --json", () => {
  const GC_STATUS_CALL = 'herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS })';

  test("the allowlist is exactly that call, in the source and in the bundle, each with a reason", () => {
    expect(ALLOWLIST.map(({ file, rule, text }) => ({ file, rule, text }))).toEqual([
      { file: "src/host.ts", rule: "exec-program", text: GC_STATUS_CALL },
      { file: "gascity/main.js", rule: "exec-program", text: GC_STATUS_CALL },
    ]);
    for (const e of ALLOWLIST) expect(e.reason.length).toBeGreaterThan(40);
    expect(GC_STATUS_CALL).toContain(JSON.stringify(GC_STATUS_ARGS).replaceAll(",", ", "));
  });

  test("any other argv, program or options is still a hit (fixture exec-gc-status.ts)", async () => {
    const violations = lintSource("src/host.ts", await fixture("exec-gc-status.ts"), ALLOWLIST);
    expect(violations.map((v) => [v.rule, v.line])).toEqual([
      ["exec-program", 6], ["exec-program", 7], ["exec-program", 8], ["exec-program", 9],
    ]);
  });

  test("the entry is for src/host.ts only: the same call elsewhere is a hit", () => {
    const text = `import * as herdr from "herdr";\n${GC_STATUS_CALL};`;
    expect(lintSource("src/vm/x.ts", text, ALLOWLIST).map((v) => v.rule)).toEqual(["host-import", "exec-program"]);
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
    expect(rules("gascity/main.js", edited, [entry])).toEqual(["function-constructor", "stale-allowlist"]);
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

  test("exits 1 on the bypass directory and reports every file in it", async () => {
    const r = cli("test/fixtures/authority/bypass");
    expect(r.exitCode).toBe(1);
    for (const name of (await readdir(join(FIXTURES, "bypass"))).filter((f) => f.endsWith(".ts"))) {
      expect(r.stderr.toString()).toContain(`test/fixtures/authority/bypass/${name}:`);
    }
  });
});
