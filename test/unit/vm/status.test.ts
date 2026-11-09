// The status chip's precedence: a pending prompt (needs you) > a lifecycle
// state that is not "active" > program_status > transcript activity >
// unknown. gc's contract: an absent program_status means unknown, never idle.

import { describe, expect, test } from "bun:test";
import type { AgentResponse, SessionProgramStatus } from "../../../src/gc/types.gen.ts";
import { agentStatus, mostUrgent, sessionStatus, urgency, type StatusInput } from "../../../src/vm/status.ts";

const program = (state: SessionProgramStatus["state"], extra: Partial<SessionProgramStatus> = {}): SessionProgramStatus =>
  ({ state, since: "2026-11-09T00:00:00Z", working_children: 0, ...extra });

const session = (extra: Partial<StatusInput> = {}): StatusInput => ({ state: "active", running: true, ...extra });

describe("sessionStatus", () => {
  test("pending wins over everything, with its kind", () => {
    const s = sessionStatus(session({ state: "suspended", program_status: program("working") }), { kind: "permission", requestId: "r-1" });
    expect(s).toMatchObject({ kind: "needs-you", label: "needs you (permission)", source: "pending" });
  });

  test("every program_status.state is shown as itself, with kind, progress and app", () => {
    expect(sessionStatus(session({ program_status: program("blocked", { kind: "question", progress: 40, app: "claude-code" }) }), null))
      .toEqual({ kind: "blocked", label: "blocked (question)", source: "program", detail: "40% · claude-code", unrecognized: null });
    for (const state of ["working", "idle", "done", "error"] as const) {
      expect(sessionStatus(session({ program_status: program(state) }), null)).toMatchObject({ kind: state, label: state, source: "program", detail: null });
    }
  });

  test("an unknown program_status.state is unknown (raw), and flagged for diagnostics", () => {
    expect(sessionStatus(session({ program_status: program({ kind: "unrecognized", raw: "thinking" }) }), null))
      .toEqual({ kind: "unknown", label: "unknown (thinking)", source: "program", detail: null, unrecognized: "program_status.state thinking" });
    expect(sessionStatus(session({ program_status: program("blocked", { kind: { kind: "unrecognized", raw: "captcha" } }) }), null))
      .toMatchObject({ kind: "blocked", label: "blocked (captcha)", unrecognized: "program_status.kind captcha" });
  });

  test("without program_status, the transcript's activity is used and marked as such", () => {
    expect(sessionStatus(session({ activity: "in-turn" }), null)).toMatchObject({ kind: "working", label: "working (transcript)", source: "transcript" });
    expect(sessionStatus(session({ activity: "idle" }), null)).toMatchObject({ kind: "idle", label: "idle (transcript)", source: "transcript" });
    expect(sessionStatus(session({ activity: "napping" }), null))
      .toMatchObject({ kind: "unknown", label: "unknown (napping)", unrecognized: "activity napping" });
  });

  test("with neither, the status is unknown, never idle", () => {
    expect(sessionStatus(session(), null)).toEqual({ kind: "unknown", label: "unknown", source: "none", detail: null, unrecognized: null });
  });

  test("a lifecycle state other than active is the primary chip, with gc's reason", () => {
    const cases: [string, string][] = [
      ["suspended", "suspended"], ["quarantined", "quarantined"], ["stopped", "stopped"], ["draining", "draining"], ["asleep", "asleep"],
      ["creating", "starting"], ["closing", "closing"], ["archived", "archived"],
    ];
    for (const [state, label] of cases) {
      expect(sessionStatus(session({ state, running: false, reason: "idle timeout", program_status: program("working") }), null))
        .toEqual({ kind: "lifecycle", label, source: "lifecycle", detail: "idle timeout", unrecognized: null });
    }
    expect(sessionStatus(session({ state: "hibernating" }), null)).toMatchObject({ kind: "lifecycle", label: "hibernating", unrecognized: "state hibernating" });
  });

  test("gc-supplied text is cleaned", () => {
    expect(sessionStatus(session({ state: "asleep", reason: "bye\u001b[2J\u0007" }), null).detail).toBe("bye");
    expect(sessionStatus(session(), { kind: "perm\u0000ission", requestId: "r" }).label).toBe("needs you (permission)");
  });
});

describe("agentStatus (an agent without sessions)", () => {
  const agent = (extra: Partial<AgentResponse>): AgentResponse => ({ name: "a", state: "idle", suspended: false, running: true, available: true, ...extra });

  test("suspended and not running are lifecycle states", () => {
    expect(agentStatus(agent({ suspended: true }))).toMatchObject({ kind: "lifecycle", label: "suspended" });
    expect(agentStatus(agent({ running: false, state: "stopped" }))).toMatchObject({ kind: "lifecycle", label: "stopped" });
    expect(agentStatus(agent({ running: false, state: "asleep" }))).toMatchObject({ kind: "lifecycle", label: "asleep" });
    expect(agentStatus(agent({ running: false, state: "idle" }))).toMatchObject({ kind: "lifecycle", label: "not running" });
  });

  test("a running agent reads like a session; unavailable reasons are kept", () => {
    expect(agentStatus(agent({ program_status: program("working") }))).toMatchObject({ kind: "working" });
    expect(agentStatus(agent({ activity: "idle" }))).toMatchObject({ kind: "idle", source: "transcript" });
    expect(agentStatus(agent({}))).toMatchObject({ kind: "unknown" });
    expect(agentStatus(agent({ available: false, unavailable_reason: "pool full" }))).toMatchObject({ kind: "unknown", detail: "unavailable: pool full" });
  });
});

describe("roll-up", () => {
  test("most urgent: needs you > blocked > error > working > done > idle > unknown > lifecycle", () => {
    const order: string[] = ["needs-you", "blocked", "error", "working", "done", "idle", "unknown", "lifecycle"];
    const all = [
      sessionStatus(session({ state: "asleep" }), null),
      sessionStatus(session(), null),
      sessionStatus(session({ program_status: program("idle") }), null),
      sessionStatus(session({ program_status: program("done") }), null),
      sessionStatus(session({ program_status: program("working") }), null),
      sessionStatus(session({ program_status: program("error") }), null),
      sessionStatus(session({ program_status: program("blocked") }), null),
      sessionStatus(session(), { kind: "question", requestId: "r" }),
    ];
    expect([...all].sort((a, b) => urgency(a) - urgency(b)).map((s): string => s.kind)).toEqual(order);
    expect(mostUrgent(all)?.kind).toBe("needs-you");
    expect(mostUrgent([])).toBeNull();
  });
});
