// canary/scope-audit.ts attachRoot: finding an attach terminal's root process
// and its HC_SCOPE token from the process table alone (herdr's terminal list
// has no pids). The root is the topmost ancestor of the attach that carries
// HC_SCOPE: herdr's wrapper shell, whose `env -u HC_SCOPE` child is the gc.

import { describe, expect, test } from "bun:test";
import type { ProcessEntry } from "../../../canary/proc.ts";
import { attachRoot } from "../../../canary/scope-audit.ts";

const TOKEN = "m7-run-0123456789abcdef";
const TAIL = ["--city", "/c", "session", "attach", "s-1"];

function proc(pid: number, ppid: number, argv: string[], env: Record<string, string> | null): ProcessEntry {
  return { pid, ppid, argv, environ: env === null ? null : new Map(Object.entries(env)) };
}

function terminal(id: string, wrapper: number, token: string, flag: string[] = []): ProcessEntry[] {
  const attach = ["--city", "/c", "session", "attach", id, ...flag];
  return [
    proc(wrapper, 100, ["/bin/bash", "-ic", '"$@"; exec "$0" -i', "/bin/bash", "env", "-u", "HC_SCOPE", "/opt/gc", ...attach], { HC_SCOPE: token }),
    proc(wrapper + 1, wrapper, ["/opt/gc", ...attach], { HOME: "/h" }),
    proc(wrapper + 2, wrapper + 1, ["tmux", "-L", "city", "attach-session", "-t", id], { HOME: "/h" }),
  ];
}

const HOST = [proc(1, 0, ["/sbin/init"], null), proc(100, 1, ["hc-core"], { HOME: "/h" })];

describe("attachRoot", () => {
  test("the root is the wrapper shell that carries HC_SCOPE; the token is its value", () => {
    expect(attachRoot([...HOST, ...terminal("s-1", 200, TOKEN)], TAIL)).toEqual({ root: 200, token: TOKEN });
  });

  test("an attach with --no-start is found too", () => {
    expect(attachRoot([...HOST, ...terminal("s-1", 200, TOKEN, ["--no-start"])], TAIL)).toEqual({ root: 200, token: TOKEN });
  });

  test("another session's attach is not it", () => {
    expect(() => attachRoot([...HOST, ...terminal("s-2", 200, TOKEN)], TAIL)).toThrow("no process runs");
  });

  test("an attach no HC_SCOPE carrier started (not a herdr terminal) has no root", () => {
    const t = [...HOST, proc(300, 100, ["/opt/gc", ...TAIL], { HOME: "/h" })];
    expect(() => attachRoot(t, TAIL)).toThrow("no ancestor carries HC_SCOPE");
  });

  test("two terminals attached to the same session are ambiguous", () => {
    expect(() => attachRoot([...HOST, ...terminal("s-1", 200, TOKEN), ...terminal("s-1", 400, `${TOKEN}-b`)], TAIL)).toThrow("2 terminals");
  });
});
