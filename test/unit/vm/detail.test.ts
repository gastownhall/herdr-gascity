// The detail pane of the selected session: facts, output (peek) as plain
// text, wake reasons fetched on demand, and the pending prompt with gc's own
// option list.

import { describe, expect, test } from "bun:test";
import type { DetailState } from "../../../src/sync/store.ts";
import { detailModel } from "../../../src/vm/detail.ts";
import { EMPTY, NOW, failed, agent, list, session, sessions, slot, snapshot } from "./snap.ts";

const S1 = session("s-1", "w", {
  alias: "one", provider: "claude", transport: "tmux-like", attached: true, active_bead: "fe-1", last_active: "2026-11-09T01:00:00Z",
  program_status: { state: "working", since: "t", working_children: 0 },
  submission_capabilities: { supports_follow_up: true, supports_interrupt_now: false, supports_steer: false },
});

const details = (d: Partial<DetailState>): Map<string, DetailState> => new Map([["s-1", { wakeReasons: EMPTY, pending: EMPTY, ...d }]]);

describe("detailModel", () => {
  test("nothing selected", () => {
    expect(detailModel({ snapshot: snapshot(), now: NOW, selected: null })).toEqual({ kind: "none" });
  });

  test("a selected session gc no longer lists says so", () => {
    expect(detailModel({ snapshot: snapshot({ sessions: slot(sessions([])) }), now: NOW, selected: "s-1" }))
      .toEqual({ kind: "gone", id: "s-1", text: "session s-1 is no longer listed by gc" });
  });

  test("facts, status and the agent it belongs to", () => {
    const m = detailModel({
      snapshot: snapshot({ agents: slot(list([agent("w")])), sessions: slot(sessions([S1])) }),
      now: NOW, selected: "s-1",
    });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.title).toBe("w / one");
    expect(m.status.label).toBe("working");
    expect(m.facts).toEqual([
      ["id", "s-1"], ["state", "active, running"], ["provider", "claude"], ["transport", "tmux-like"], ["attached", "yes"],
      ["active bead", "fe-1"], ["last active", "2026-11-09T01:00:00Z"], ["input", "follow-up"],
    ]);
  });

  test("output is plain text with control characters removed, and says how old it is", () => {
    const peek = slot({ ...S1, last_output: "\u001b[1mCANARY READY\u001b[0m\r\nline two\u0007" }, { ageMs: 2_000 });
    const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), peeks: new Map([["s-1", peek]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output).toEqual({ text: "CANARY READY\nline two", region: { kind: "ok", age: "data 2 s old", stale: false, error: null } });
  });

  test("no output yet is loading; output gc does not give is said", () => {
    let m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.region.kind).toBe("loading");
    m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), peeks: new Map([["s-1", slot(S1)]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.text).toBe("(no output)");
  });

  test("wake reasons: listed, not listed, loading, failed", () => {
    const at = (d: Partial<DetailState>) => {
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), details: details(d) }), now: NOW, selected: "s-1" });
      if (m.kind !== "session") throw new Error(m.kind);
      return m.wakeReasons;
    };
    expect(at({ wakeReasons: slot({ listed: true, reasons: ["session", "config\u0007"] }) })).toBe("session, config");
    expect(at({ wakeReasons: slot({ listed: true, reasons: [] }) })).toBe("none");
    expect(at({ wakeReasons: slot({ listed: false, reasons: [] }) })).toBe("gc did not list this session under its template");
    expect(at({})).toBe("loading");
    expect(at({ wakeReasons: failed({ kind: "http", status: 500, problem: null, raw: "x" }) })).toBe("unavailable: gc answered 500: x");
  });

  test("a pending prompt shows its text and gc's options, in gc's order", () => {
    const m = detailModel({
      snapshot: snapshot({
        sessions: slot(sessions([S1])),
        details: details({
          pending: slot({ supported: true, pending: { request_id: "r-1", kind: "permission", prompt: "Run\u001b[31m rm -rf build?", options: ["approve", "deny", "select:always"] } }),
        }),
      }),
      now: NOW, selected: "s-1",
    });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.pending).toEqual({ kind: "prompt", requestId: "r-1", promptKind: "permission", prompt: "Run rm -rf build?", options: ["approve", "deny", "select:always"] });
  });

  test("no prompt, a provider without prompts, and a failed fetch are each said", () => {
    const at = (d: Partial<DetailState>) => {
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), details: details(d) }), now: NOW, selected: "s-1" });
      if (m.kind !== "session") throw new Error(m.kind);
      return m.pending;
    };
    expect(at({ pending: slot({ supported: true }) })).toEqual({ kind: "none" });
    expect(at({ pending: slot({ supported: false }) })).toEqual({ kind: "unsupported" });
    expect(at({})).toEqual({ kind: "loading" });
    expect(at({ pending: failed({ kind: "unreachable", url: "u", cause: "refused" }) })).toEqual({ kind: "failed", error: "cannot reach u: refused" });
  });
});
