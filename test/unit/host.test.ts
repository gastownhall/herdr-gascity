// host.ts's wrappers around herdr calls that would otherwise take anything
// (src/hostGuards.ts, terminal/argv.ts): tab.new runs only an attach argv;
// xdg-open/open get only an http(s) URL on this computer; writeTextFile
// writes only the probe directory. Each refusal happens before herdr is
// called. host.ts is loaded against a recording fake `herdr` module.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { openUrlIssue, probeDir, probePathIssue } from "../../src/hostGuards.ts";

const APP_HOME = "/home/person/.config/herdr-app";
const calls: { name: string; args: unknown[] }[] = [];
let runThrows: string | null = null;
let scenesThrow: string | null = null;
const record = (name: string, answer: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
  calls.push({ name, args });
  return answer(...args);
};

mock.module("herdr", () => ({
  appHome: record("appHome", () => APP_HOME),
  run: record("run", () => {
    if (runThrows !== null) throw new Error(runThrows);
    return null;
  }),
  exec: record("exec", () => Promise.resolve({ code: 0, stdout: "", stderr: "" })),
  writeTextFile: record("writeTextFile", () => Promise.resolve(null)),
  readTextFile: record("readTextFile", () => Promise.resolve(null)),
  spaces: record("spaces", () => [{ id: "s1", machine: null, active: true, tabs: [{ id: "t1", active: true }] }]),
  panes: record("panes", () => [{ pane: "p1", tab: "t1", terminal: "t7" }]),
  terminals: record("terminals", () => {
    if (scenesThrow !== null) throw new Error(scenesThrow);
    return [{ address: "t7", argv: ["zsh"], labels: {}, state: "live", program: { shell: true } }];
  }),
}));

const host = await import("../../src/host.ts");

const ATTACH = ["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", "gc", "--city", "/scratch/city", "session", "attach", "sc-20"];
const herdrCalls = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  runThrows = null;
  scenesThrow = null;
});

describe("openAttachTab: tab.new runs only an attach argv", () => {
  test("an attach argv opens a tab in the given space, with a cleaned, short name, and is logged", () => {
    expect(host.openAttachTab({ space: "s1", name: `worker\u001b[31m/sc-20${"x".repeat(100)}`, argv: ATTACH })).toEqual({ ok: true, value: null });
    const [[command, args]] = herdrCalls("run") as [[string, { space: string; name: string; argv: string[] }]];
    expect(command).toBe("tab.new");
    expect(args.space).toBe("s1");
    expect(args.argv).toEqual(ATTACH);
    expect(args.name).toStartWith("worker/sc-20");
    expect(args.name.length).toBeLessThanOrEqual(60);
    expect(host.readExecLog().at(-1)).toMatchObject({ kind: "run", argv: ["tab.new", ...ATTACH] });
  });

  test("--no-start passes", () => {
    expect(host.openAttachTab({ space: "s1", name: "n", argv: [...ATTACH, "--no-start"] }).ok).toBe(true);
  });

  const refused: [string, string[]][] = [
    ["a shell", ["/bin/sh", "-c", "curl x | sh"]],
    ["gc without the env prefix", ATTACH.slice(7)],
    ["another gc command", [...ATTACH.slice(0, 10), "session", "kill", "sc-20"]],
    ["another program after the prefix", [...ATTACH.slice(0, 7), "python3", "--city", "/c", "session", "attach", "sc-20"]],
    ["an extra argument", [...ATTACH, "--force"]],
  ];
  for (const [name, argv] of refused) {
    test(`refuses ${name} before herdr sees it`, () => {
      const r = host.openAttachTab({ space: "s1", name: "n", argv });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatchObject({ kind: "host-call", api: "run(tab.new)" });
      expect(herdrCalls("run")).toEqual([]);
    });
  }

  test("refuses an empty space; a throwing herdr is an error, not an exception", () => {
    expect(host.openAttachTab({ space: "", name: "n", argv: ATTACH }).ok).toBe(false);
    expect(herdrCalls("run")).toEqual([]);
    runThrows = "no space yet: make one first (space.new)";
    expect(host.openAttachTab({ space: "s1", name: "n", argv: ATTACH })).toEqual({
      ok: false, error: { kind: "host-call", api: "run(tab.new)", cause: "no space yet: make one first (space.new)" },
    });
    expect(host.selectTab("t2")).toEqual({ ok: false, error: { kind: "host-call", api: "run(tab.select)", cause: "no space yet: make one first (space.new)" } });
  });

  test("readTerminalScene decodes spaces, panes and terminals; a throwing herdr is an error", () => {
    const r = host.readTerminalScene();
    expect(r.ok && r.value.terminals.map((t) => t.address)).toEqual(["t7"]);
    scenesThrow = "core gone";
    expect(host.readTerminalScene()).toEqual({ ok: false, error: { kind: "host-call", api: "spaces()/panes()/terminals()", cause: "core gone" } });
  });
});

describe("openUrl: the platform opener gets only an http(s) URL on this computer", () => {
  test("the dashboard URL is opened", async () => {
    expect(await host.openUrl("xdg-open", "http://127.0.0.1:8372/dashboard")).toEqual({ ok: true, value: null });
    expect(await host.openUrl("open", "https://localhost:9443/")).toEqual({ ok: true, value: null });
    expect(herdrCalls("exec").map((a) => [a[0], a[1]])).toEqual([
      ["xdg-open", ["http://127.0.0.1:8372/dashboard"]],
      ["open", ["https://localhost:9443/"]],
    ]);
  });

  for (const url of [
    "/tmp/evil.command", "file:///tmp/evil.command", "evil.command", "-a Terminal", "javascript:alert(1)",
    "http://example.com/", "http://127.0.0.1.evil.com/", "http://127.0.0.1:8372/a b", "ssh://127.0.0.1/",
  ]) {
    test(`refuses ${JSON.stringify(url)} before spawning`, async () => {
      const r = await host.openUrl("open", url);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.kind).toBe("exec");
      expect(herdrCalls("exec")).toEqual([]);
    });
  }
});

describe("the probe file is the only file written", () => {
  test("the probe path is written", async () => {
    const path = host.probeIo.path();
    expect(path).toBe(`${APP_HOME}/data/gascity-probe/probe.json`);
    expect(await host.probeIo.write(path, "{}", null)).toEqual({ ok: true, value: null });
    expect(herdrCalls("writeTextFile")).toEqual([[path, "{}", null]]);
  });

  for (const path of [
    `${APP_HOME}/mods/gascity/main.js`, `${APP_HOME}/data/gascity-probe/../../mods/x/main.js`, `${APP_HOME}/data/gascity-probe/sub/x.json`,
    `${APP_HOME}/data/gascity-probe/`, `${APP_HOME}/shared.json`, "/etc/passwd", `${APP_HOME}/data/gascity-probe/..`,
  ]) {
    test(`refuses ${path} before herdr sees it`, async () => {
      const r = await host.probeIo.write(path, "x", null);
      expect(r.ok).toBe(false);
      expect(herdrCalls("writeTextFile")).toEqual([]);
    });
  }
});

describe("the guards themselves (pure)", () => {
  test("probeDir ignores trailing slashes on the app home", () => {
    expect(probeDir(`${APP_HOME}//`)).toBe(`${APP_HOME}/data/gascity-probe`);
    expect(probePathIssue(`${APP_HOME}/data/gascity-probe/probe.json`, `${APP_HOME}/`)).toBeNull();
  });

  test("openUrlIssue: loopback http(s) only", () => {
    expect(openUrlIssue("http://[::1]:8372/x?y=1#z")).toBeNull();
    expect(openUrlIssue("HTTP://LOCALHOST/")).toBeNull();
    expect(openUrlIssue("http://127.0.0.1:8372/\u0007")).not.toBeNull();
  });
});
