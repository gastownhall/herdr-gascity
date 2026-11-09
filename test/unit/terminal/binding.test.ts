// The TerminalBinding seam (src/terminal/binding.ts): how a session's
// terminal is shown. Today the only binding is an attach tab; it is refused
// for transports gc cannot attach to, and its ids and paths come from gc
// (the session list and /v0/cities), validated before any argv is built.

import { describe, expect, test } from "bun:test";
import { attachRefusal, resolveBinding } from "../../../src/terminal/binding.ts";
import type * as T from "../../../src/gc/types.gen.ts";
import { fixtureBody } from "../sync/fakes.ts";

const SESSION = fixtureBody("get-v0-city-by-city-name-session-by-id", "peek") as T.SessionResponse;
const INPUT = { session: SESSION, cityPath: "/scratch/city", gcBin: "gc", gcVersion: "dev" };

describe("transport gating", () => {
  test("transports gc cannot attach to say why", () => {
    expect(attachRefusal("acp")).toContain("acp");
    expect(attachRefusal("subprocess")).toContain("subprocess");
  });

  test("an empty, absent or unknown transport is allowed: gc answers in the tab", () => {
    expect(attachRefusal(undefined)).toBeNull();
    expect(attachRefusal("")).toBeNull();
    expect(attachRefusal("some-new-transport")).toBeNull();
  });
});

describe("resolveBinding", () => {
  test("an attach tab for gc's session id and city path", () => {
    expect(resolveBinding(INPUT)).toEqual({
      ok: true, value: { kind: "attach-tab", target: { gcBin: "gc", cityPath: "/scratch/city", sessionId: "sc-20" }, noStart: false },
    });
  });

  test("--no-start once gc is new enough", () => {
    const r = resolveBinding({ ...INPUT, gcVersion: "1.6.0" });
    expect(r.ok && r.value.noStart).toBe(true);
  });

  test("refused for a transport without attach", () => {
    const r = resolveBinding({ ...INPUT, session: { ...SESSION, transport: "acp" } });
    expect(r.ok).toBe(false);
  });

  test("refused for an id, path or gc program that could not go into an argv", () => {
    expect(resolveBinding({ ...INPUT, session: { ...SESSION, id: "-x" } }).ok).toBe(false);
    expect(resolveBinding({ ...INPUT, cityPath: "relative/city" }).ok).toBe(false);
    expect(resolveBinding({ ...INPUT, gcBin: "/bin/sh" }).ok).toBe(false);
  });
});
