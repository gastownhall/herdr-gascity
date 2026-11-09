// The HC_SCOPE audit and the /proc parsing under it, on synthetic process tables.

import { describe, expect, test } from "bun:test";
import { carrying, nulFields, parentOf, parseEnviron, treeOf, type ProcessEntry } from "../../../canary/proc.ts";
import { auditReport, auditScope } from "../../../canary/scope-audit.ts";

const TOKEN = "m7-run-0123456789abcdef";

function proc(pid: number, ppid: number, argv: string[], env: Record<string, string> | null): ProcessEntry {
  return { pid, ppid, argv, environ: env === null ? null : new Map(Object.entries(env)) };
}

/** herdr's terminal: the wrapper shell, env → gc session attach → tmux client; the city's tmux server and agent pane elsewhere. */
function table(serverEnv: Record<string, string>): ProcessEntry[] {
  return [
    proc(1, 0, ["/sbin/init"], null),
    proc(100, 1, ["hc-core"], { HOME: "/h" }),
    proc(200, 100, ["/bin/bash", "-ic", '"$@"; exec "$0" -i', "/bin/bash", "env", "-u", "HC_SCOPE", "gc", "session", "attach", "s-1"], { HC_SCOPE: TOKEN }),
    proc(201, 200, ["gc", "--city", "/c", "session", "attach", "s-1"], { HOME: "/h" }),
    proc(202, 201, ["tmux", "-L", "city", "attach-session", "-t", "s-1"], { HOME: "/h" }),
    proc(300, 1, ["tmux", "-L", "city", "new-session", "-d"], serverEnv),
    proc(301, 300, ["sh", "canary-agent.sh"], { HOME: "/h" }),
    proc(400, 1, ["gc", "supervisor", "run"], { HOME: "/h" }),
  ];
}

describe("/proc parsing", () => {
  test("parentOf reads the field after the command, whatever the command holds", () => {
    expect(parentOf("1234 (tmux: server) S 1 1234 1234 0 -1 4194560")).toBe(1);
    expect(parentOf("77 (a) b) c) R 42 77 77 0")).toBe(42);
    expect(parentOf("garbage")).toBeNull();
  });

  test("environ and cmdline are NUL-separated", () => {
    expect(nulFields("a\0b c\0\0")).toEqual(["a", "b c"]);
    const env = parseEnviron("HC_SCOPE=x=y\0EMPTY=\0ODD\0");
    expect(env.get("HC_SCOPE")).toBe("x=y");
    expect(env.get("EMPTY")).toBe("");
    expect(env.get("ODD")).toBe("");
  });

  test("treeOf follows parent links down from the root only", () => {
    expect([...treeOf(table({}), 200)].sort()).toEqual([200, 201, 202]);
    expect([...treeOf(table({}), 999)]).toEqual([999]);
  });

  test("carrying matches a variable's exact value", () => {
    const t = [proc(1, 0, [], { RUN: "abc" }), proc(2, 0, [], { RUN: "abcd" }), proc(3, 0, [], null)];
    expect(carrying(t, "RUN", "abc").map((p) => p.pid)).toEqual([1]);
  });
});

describe("auditScope", () => {
  test("no process outside the terminal's tree carries the token: no leak", () => {
    const a = auditScope(table({ HOME: "/h" }), 200, TOKEN);
    expect(a.leaks).toEqual([]);
    expect(a.inside.map((c) => c.pid)).toEqual([200]);
    expect(a.tree).toEqual([200, 201, 202]);
    expect(a.unreadable).toBe(1);
  });

  test("a daemon outside the tree that carries the token is a leak (a tmux server started from the terminal)", () => {
    const a = auditScope(table({ HC_SCOPE: TOKEN }), 200, TOKEN);
    expect(a.leaks.map((l) => l.pid)).toEqual([300]);
    expect(a.leaks[0]!.variables).toEqual(["HC_SCOPE"]);
    expect(auditReport(a).join("\n")).toContain("LEAK pid 300");
  });

  test("a copy of the token under another name counts", () => {
    const a = auditScope(table({ SAVED_SCOPE: `prefix:${TOKEN}` }), 200, TOKEN);
    expect(a.leaks.map((l) => [l.pid, l.variables])).toEqual([[300, ["SAVED_SCOPE"]]]);
  });

  test("a token too short to be unique is refused", () => {
    expect(() => auditScope([], 1, "m7")).toThrow("too short");
  });
});
