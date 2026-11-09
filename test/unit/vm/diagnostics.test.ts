import { describe, expect, test } from "bun:test";
import { DIAGNOSTICS_LIMIT, diagnosticsModel } from "../../../src/vm/diagnostics.ts";

describe("diagnostics drawer", () => {
  test("every recorded failure with its time and source, newest first, cleaned", () => {
    const lines = diagnosticsModel({
      entries: [
        { at: Date.UTC(2026, 10, 9, 12, 0, 1), source: "sessions", error: { kind: "http", status: 500, problem: null, raw: "boom\u0007" } },
        { at: Date.UTC(2026, 10, 9, 12, 0, 2), source: "step", error: { kind: "step-stalled", idleMs: 141_000 } },
        { at: Date.UTC(2026, 10, 9, 12, 0, 3), source: "listener", error: { kind: "listener-failed", message: "x" } },
        { at: Date.UTC(2026, 10, 9, 12, 0, 4), source: "step", error: { kind: "step-crashed", message: "TypeError: y" } },
      ],
      drift: ["program_status.state thinking"],
      unreadable: ["unreadable session s-2: unreadable answer to get-v0-city-by-city-name-sessions at items[1].state: bad"],
    });
    expect(lines).toEqual([
      { at: "2026-11-09T12:00:04Z", source: "step", text: "a refresh step crashed: TypeError: y" },
      { at: "2026-11-09T12:00:03Z", source: "listener", text: "an app-wide listener failed: x" },
      { at: "2026-11-09T12:00:02Z", source: "step", text: "a refresh step made no progress for 141 s and was abandoned" },
      { at: "2026-11-09T12:00:01Z", source: "sessions", text: "gc answered 500: boom" },
      { at: null, source: "gc", text: "unreadable session s-2: unreadable answer to get-v0-city-by-city-name-sessions at items[1].state: bad" },
      { at: null, source: "gc", text: "value this version does not know: program_status.state thinking" },
    ]);
  });

  test("at most the last DIAGNOSTICS_LIMIT failures", () => {
    const entries = Array.from({ length: DIAGNOSTICS_LIMIT + 5 }, (_, i) => ({ at: i * 1000, source: "events", error: { kind: "csrf-rejected" as const } }));
    expect(diagnosticsModel({ entries, drift: [] }).length).toBe(DIAGNOSTICS_LIMIT);
  });
});
