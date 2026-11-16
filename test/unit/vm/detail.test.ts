// The detail pane of the selected session: facts, its conversation
// (transcript) as plain text, wake reasons fetched on demand, and the pending prompt with gc's own
// option list.

import { describe, expect, test } from "bun:test";
import type { DetailState, Slot } from "../../../src/sync/store.ts";
import { PEEK_LINES, type Transcript } from "../../../src/sync/transcript.ts";
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

  test("a terminal capture is plain text with control characters removed, and says how old it is", () => {
    const t = slot<Transcript>({ format: "text", turns: [{ role: "output", text: "\u001b[1mCANARY READY\u001b[0m\r\nline two\u0007" }], olderHidden: false, bounded: false }, { ageMs: 2_000 });
    const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", t]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output).toEqual({
      turns: [{ key: "0", role: null, time: null, lines: ["CANARY READY", "line two"] }],
      text: "CANARY READY\nline two",
      olderHidden: false,
      bounded: null,
      region: { kind: "ok", age: "data 2 s old", stale: false, error: null },
    });
  });

  test("a conversation shows each turn under its role, cleaned, oldest first; older turns not kept are said", () => {
    const t = slot<Transcript>({
      format: "conversation",
      turns: [
        { id: "u1", role: "user", text: "fix\u0007 the test", timestamp: "2026-11-16T17:20:00Z" },
        { id: "a1", role: "assistant\u001b[31m", text: "Looking.\n[Bash]" },
      ],
      olderHidden: true,
      bounded: false,
    });
    const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", t]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.turns).toEqual([
      { key: "u1", role: "user", time: "2026-11-16T17:20:00Z", lines: ["fix the test"] },
      { key: "a1", role: "assistant", time: null, lines: ["Looking.", "[Bash]"] },
    ]);
    expect(m.output.text).toBe("fix the test\nLooking.\n[Bash]");
    expect(m.output.olderHidden).toBe(true);
  });

  test("updating: new turns appear as the store appends them", () => {
    const at = (turns: Transcript["turns"]) => {
      const t = slot<Transcript>({ format: "conversation", turns, olderHidden: false, bounded: false });
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", t]]) }), now: NOW, selected: "s-1" });
      if (m.kind !== "session") throw new Error(m.kind);
      return m.output.turns?.map((x) => x.key);
    };
    expect(at([{ id: "u1", role: "user", text: "hi" }])).toEqual(["u1"]);
    expect(at([{ id: "u1", role: "user", text: "hi" }, { id: "a1", role: "assistant", text: "hello" }])).toEqual(["u1", "a1"]);
  });

  test("a conversation too large to read shows gc's bounded peek and says why", () => {
    const t = slot<Transcript>({ format: "text", turns: [{ role: "output", text: "$ make" }], olderHidden: false, bounded: true });
    const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", t]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.text).toBe("$ make");
    expect(m.output.bounded).toBe(`the conversation is too large to read here; showing the terminal's last ${PEEK_LINES} lines`);
  });

  test("empty: no read yet is loading; an empty transcript says so", () => {
    let m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.region.kind).toBe("loading");
    expect(m.output.turns).toBeNull();
    const empty = slot<Transcript>({ format: "conversation", turns: [], olderHidden: false, bounded: false });
    m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", empty]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.turns).toEqual([]);
    expect(m.output.text).toBe("(no output)");
  });

  test("error and stale: a failed read keeps the last turns, greyed, with the error", () => {
    const t: Slot<Transcript> = {
      ...slot<Transcript>({ format: "text", turns: [{ role: "output", text: "last seen" }], olderHidden: false, bounded: false }, { ageMs: 30_000 }),
      error: { kind: "http", status: 404, problem: null, raw: "gone" },
    };
    const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), transcripts: new Map([["s-1", t]]) }), now: NOW, selected: "s-1" });
    if (m.kind !== "session") throw new Error(m.kind);
    expect(m.output.text).toBe("last seen");
    expect(m.output.region.stale).toBe(true);
    expect(m.output.region.error).toContain("404");
  });

  test("wake reasons: listed, not listed, loading, failed", () => {
    const at = (d: Partial<DetailState>) => {
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])), details: details(d) }), now: NOW, selected: "s-1" });
      if (m.kind !== "session") throw new Error(m.kind);
      return m.wakeReasons;
    };
    expect(at({ wakeReasons: slot({ listed: true, reasons: ["session", "config\u0007"], session: null }) })).toBe("session, config");
    expect(at({ wakeReasons: slot({ listed: true, reasons: [], session: null }) })).toBe("none");
    expect(at({ wakeReasons: slot({ listed: false, reasons: [], session: null }) })).toBe("gc did not list this session under its template");
    expect(at({})).toBe("loading");
    expect(at({ wakeReasons: failed({ kind: "http", status: 500, problem: null, raw: "x" }) })).toBe("unavailable: gc answered 500: x");
  });

  test("keep awake: the pane says what it did for the session", () => {
    const at = (k: Parameters<typeof detailModel>[0]["keepAwake"]) => {
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([S1])) }), now: NOW, selected: "s-1", keepAwake: k });
      return m.kind === "session" ? m.keepAwake : null;
    };
    expect(at(undefined)).toBe("Keep awake: not watched");
    expect(at({ kind: "pinned" })).toBe("Keep awake: pinned by this pane until it closes");
    expect(at({ kind: "not-pinned", why: "already pinned in gc (not by this pane): left as it is\u0007" }))
      .toBe("Keep awake: already pinned in gc (not by this pane): left as it is");
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
    expect(m.pending).toEqual({
      kind: "prompt", requestId: "r-1", promptKind: "permission", prompt: "Run rm -rf build?", options: ["approve", "deny", "select:always"],
      answer: { requestId: "r-1", options: ["approve", "deny", "select:always"] },
    });
  });

  test("an answer sends gc's option exactly as gc listed it; the button shows it cleaned", () => {
    const m = detailModel({
      snapshot: snapshot({
        sessions: slot(sessions([S1])),
        details: details({ pending: slot({ supported: true, pending: { request_id: "r-2", kind: "question", options: ["select:\u001b[1mB"] } }) }),
      }),
      now: NOW, selected: "s-1",
    });
    if (m.kind !== "session" || m.pending.kind !== "prompt") throw new Error("no prompt");
    expect(m.pending.options).toEqual(["select:B"]);
    expect(m.pending.answer).toEqual({ requestId: "r-2", options: ["select:\u001b[1mB"] });
  });

  test("the session's raw id and whether it can be interrupted", () => {
    const at = (x: typeof S1) => {
      const m = detailModel({ snapshot: snapshot({ sessions: slot(sessions([x])) }), now: NOW, selected: x.id });
      if (m.kind !== "session") throw new Error(m.kind);
      return [m.ref, m.canInterrupt];
    };
    expect(at(S1)).toEqual(["s-1", false]);
    expect(at({ ...S1, submission_capabilities: { supports_follow_up: true, supports_interrupt_now: true, supports_steer: false } })).toEqual(["s-1", true]);
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
