// The attach argv (src/terminal/argv.ts): every argv the mod hands herdr's
// tab.new starts with `env -u HC_SCOPE -u HC_TERMINAL_ID -u HC_TERMINAL_SOCKET`,
// so nothing the attach starts carries herdr-core's sweep token; `--no-start`
// is added only for a gc new enough to have it; the shape check the host
// wrapper runs refuses everything but that exact form.

import { describe, expect, test } from "bun:test";
import {
  HC_SCRUB, NO_START_FLAG, NO_START_MIN_GC, attachArgv, attachArgvIssue, attachTail, cityPathIssue, isAttachOf, sessionIdIssue, supportsNoStart,
} from "../../../src/terminal/argv.ts";

const TARGET = { gcBin: "gc", cityPath: "/scratch/city", sessionId: "sc-20" };

describe("attachArgv", () => {
  test("always starts with the env -u HC_* prefix, then gc --city <path> session attach <id>", () => {
    expect(attachArgv(TARGET, false)).toEqual([
      "env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", "gc", "--city", "/scratch/city", "session", "attach", "sc-20",
    ]);
    for (const noStart of [false, true]) {
      for (const gcBin of ["gc", "/opt/homebrew/bin/gc"]) {
        expect(attachArgv({ ...TARGET, gcBin }, noStart).slice(0, HC_SCRUB.length)).toEqual([...HC_SCRUB]);
      }
    }
  });

  test("--no-start goes last when gc has it", () => {
    expect(attachArgv(TARGET, true).slice(-2)).toEqual(["sc-20", NO_START_FLAG]);
  });

  test("the tail dedupe matches is gc --city <path> session attach <id>", () => {
    expect(attachTail(TARGET)).toEqual(["gc", "--city", "/scratch/city", "session", "attach", "sc-20"]);
  });
});

describe("isAttachOf", () => {
  test("matches our argv with or without --no-start, also behind herdr's shell wrapper", () => {
    expect(isAttachOf(attachArgv(TARGET, false), TARGET)).toBe(true);
    expect(isAttachOf(attachArgv(TARGET, true), TARGET)).toBe(true);
    expect(isAttachOf(["/bin/zsh", "-ic", '"$@"; exec "$0" -i', "/bin/zsh", ...attachArgv(TARGET, false)], TARGET)).toBe(true);
  });

  test("another session, city or gc program is not a match", () => {
    expect(isAttachOf(attachArgv({ ...TARGET, sessionId: "sc-2" }, false), TARGET)).toBe(false);
    expect(isAttachOf(attachArgv({ ...TARGET, cityPath: "/other" }, false), TARGET)).toBe(false);
    expect(isAttachOf(attachArgv({ ...TARGET, gcBin: "/usr/local/bin/gc" }, false), TARGET)).toBe(false);
    expect(isAttachOf(["zsh"], TARGET)).toBe(false);
    expect(isAttachOf(["gc", "--city", "/scratch/city", "session", "attach", "sc-20", "--other"], TARGET)).toBe(false);
  });
});

describe("attachArgvIssue (the host wrapper's shape check)", () => {
  test("our argv passes, with and without --no-start", () => {
    expect(attachArgvIssue(attachArgv(TARGET, false))).toBeNull();
    expect(attachArgvIssue(attachArgv({ ...TARGET, gcBin: "/opt/homebrew/bin/gc" }, true))).toBeNull();
  });

  const bad: [string, string[]][] = [
    ["empty", []],
    ["no env prefix", ["gc", "--city", "/c", "session", "attach", "sc-20"]],
    ["a missing -u", ["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "gc", "--city", "/c", "session", "attach", "sc-20"]],
    ["another program", [...HC_SCRUB, "sh", "--city", "/c", "session", "attach", "sc-20"]],
    ["another gc verb", [...HC_SCRUB, "gc", "--city", "/c", "session", "kill", "sc-20"]],
    ["a relative city path", [...HC_SCRUB, "gc", "--city", "c", "session", "attach", "sc-20"]],
    ["a flag as the id", [...HC_SCRUB, "gc", "--city", "/c", "session", "attach", "--force"]],
    ["an extra argument", [...HC_SCRUB, "gc", "--city", "/c", "session", "attach", "sc-20", "--force"]],
    ["a shell word", [...HC_SCRUB, "gc", "--city", "/c", "session", "attach", "sc-20;rm"]],
    ["an env assignment", ["env", "HC_SCOPE=x", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", "gc", "--city", "/c", "session", "attach", "sc-20"]],
  ];
  for (const [name, argv] of bad) {
    test(`refuses ${name}`, () => {
      expect(attachArgvIssue(argv)).not.toBeNull();
    });
  }
});

describe("ids and paths", () => {
  test("session ids: gc's id characters only, never a flag", () => {
    for (const ok of ["sc-20", "ga-u7fb", "gc-1.2", "S_1"]) expect(sessionIdIssue(ok)).toBeNull();
    for (const bad of ["", "-rf", "--no-start", "a b", "a/b", "a\u0000b", "x".repeat(129), "é"]) expect(sessionIdIssue(bad)).not.toBeNull();
  });

  test("city paths: absolute, no control characters, no .. segment", () => {
    for (const ok of ["/scratch/city", "/home/me/My City", "/"]) expect(cityPathIssue(ok)).toBeNull();
    for (const bad of ["", "city", "-c", "/a/../b", "/a/..", "/a\nb", "/a\u001bb"]) expect(cityPathIssue(bad)).not.toBeNull();
  });
});

describe("supportsNoStart: --no-start only on a gc that has it", () => {
  test(`the documented minimum is ${NO_START_MIN_GC}`, () => {
    expect(NO_START_MIN_GC).toBe("1.6.0");
  });

  const cases: [string, boolean][] = [
    ["1.6.0", true], ["v1.6.0", true], ["1.6.1", true], ["1.10.0", true], ["2.0.0", true], ["1.6.0-rc1", true],
    ["1.5.1", false], ["v1.5.9", false], ["0.14.0", false], ["dev", false], ["", false], ["unknown", false], ["1.6", false],
  ];
  for (const [version, want] of cases) {
    test(`gc ${JSON.stringify(version)} → ${want}`, () => {
      expect(supportsNoStart(version)).toBe(want);
    });
  }
});
