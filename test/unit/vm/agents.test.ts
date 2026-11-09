// The agents panel's view-model: rigs → agents → sessions joined from the
// shared snapshot, status chips with pending, active beads, and the region's
// staleness and errors. Nothing gc lists is dropped.

import { describe, expect, test } from "bun:test";
import { agentsModel, type AgentsModel, type SessionRow } from "../../../src/vm/agents.ts";
import { NOW, failed, agent, bead, list, ready, rig, session, sessions, slot, snapshot, EMPTY } from "./snap.ts";

const decodeError = (id: string) => ({ kind: "decode" as const, operationId: "get-v0-city-by-city-name-sessions", path: "items[1].state", issues: [`state: expected string (${id})`] });

function model(parts: Parameters<typeof snapshot>[0], opts: { selected?: string | null; collapsed?: string[] } = {}): AgentsModel {
  return agentsModel({ snapshot: snapshot(parts), now: NOW, selected: opts.selected ?? null, collapsed: new Set(opts.collapsed ?? []) });
}

const sessionIds = (rows: SessionRow[]) => rows.map((r) => r.id);

describe("the join", () => {
  const parts = {
    rigs: slot(list([rig("frontend", { agent_count: 2, running_count: 1 }), rig("docs", { suspended: true })])),
    agents: slot(list([
      agent("planner"),
      agent("frontend/builder", { rig: "frontend", pool: "frontend/builder", pool_limits: { min: 0, max: -1 } }),
      agent("frontend/reviewer", { rig: "frontend", running: false, state: "stopped" }),
      agent("ops/watch", { rig: "ops" }),
    ])),
    sessions: slot(sessions([
      session("s-1", "frontend/builder", { agent_name: "frontend/builder", program_status: { state: "working", since: "t", working_children: 0 } }),
      session("s-2", "frontend/builder", { agent_name: "frontend/builder-2", alias: "builder two", program_status: { state: "idle", since: "t", working_children: 0 } }),
      session("s-3", "planner", { agent_name: "planner", activity: "idle" }),
      session("s-9", "gone/template", { agent_name: "gone/agent" }),
    ])),
  };

  test("actions address gc's own names: a listed rig's name, an agent's qualified name and its suspension", () => {
    const m = model({ ...parts, agents: slot(list([agent("frontend/builder", { rig: "frontend", suspended: true }), agent("ops/watch", { rig: "ops" }), agent("planner")])) });
    expect(m.groups.map((g) => [g.key, g.rig])).toEqual([["rig:frontend", "frontend"], ["rig:docs", "docs"], ["rig:ops", null], ["city", null]]);
    expect(m.groups.flatMap((g) => g.agents.map((a) => [a.ref, a.suspended]))).toEqual([["frontend/builder", true], ["ops/watch", false], ["planner", false]]);
  });

  test("rigs in gc's order with their counts, then rigs only agents name, then the city's own agents", () => {
    const m = model(parts);
    expect(m.groups.map((g) => [g.key, g.title, g.counts, g.listed, g.suspended])).toEqual([
      ["rig:frontend", "rig: frontend", "2 agents · 1 running", true, false],
      ["rig:docs", "rig: docs", "0 agents · 0 running", true, true],
      ["rig:ops", "rig: ops", null, false, false],
      ["city", "city", null, true, false],
    ]);
  });

  test("sessions join their agent by agent_name, else by template; pool agents show their limits", () => {
    const m = model(parts);
    const builder = m.groups[0]!.agents[0]!;
    expect(builder.name).toBe("frontend/builder");
    expect(builder.pool).toBe("pool 0–unlimited");
    expect(sessionIds(builder.sessions)).toEqual(["s-1", "s-2"]);
    expect(builder.sessions[1]!.label).toBe("builder two");
    expect(builder.status.kind).toBe("working");
    expect(m.groups[3]!.agents.map((a) => [a.name, sessionIds(a.sessions)])).toEqual([["planner", ["s-3"]]]);
  });

  test("a session that matches no agent is listed under Other sessions, never dropped", () => {
    expect(sessionIds(model(parts).other)).toEqual(["s-9"]);
  });

  test("an agent without sessions shows its own state", () => {
    const reviewer = model(parts).groups[0]!.agents[1]!;
    expect(reviewer.sessions).toEqual([]);
    expect(reviewer.status).toMatchObject({ kind: "lifecycle", label: "stopped" });
  });

  test("a collapsed group keeps its header and counts but hides its agents", () => {
    const m = model(parts, { collapsed: ["rig:frontend"] });
    expect(m.groups[0]).toMatchObject({ collapsed: true, agents: [] });
    expect(m.groups[1]!.collapsed).toBe(false);
  });

  test("the selected session is marked", () => {
    const m = model(parts, { selected: "s-2" });
    expect(m.groups[0]!.agents[0]!.sessions.map((s) => s.selected)).toEqual([false, true]);
  });
});

describe("status, pending and active beads", () => {
  test("a pending interaction makes the session (and its agent) need you, and is counted", () => {
    const m = model({
      agents: slot(list([agent("w")])),
      sessions: slot(sessions([
        session("s-1", "w", { program_status: { state: "working", since: "t", working_children: 0 } }),
        session("s-2", "w", { program_status: { state: "blocked", kind: "permission", since: "t", working_children: 0 } }),
      ])),
      pending: slot(list([{ session_id: "s-2", request_id: "r-1", kind: "permission" }, { session_id: "s-404", request_id: "r-2", kind: "question" }])),
    });
    const w = m.groups[0]!.agents[0]!;
    expect(w.sessions.map((s) => s.status.kind)).toEqual(["working", "needs-you"]);
    expect(w.status.label).toBe("needs you (permission)");
    expect(m.needsYou).toBe(2);
  });

  test("the active bead's title comes from the board, else from a fetched bead, never guessed", () => {
    const m = model({
      agents: slot(list([agent("w")])),
      sessions: slot(sessions([
        session("s-1", "w", { active_bead: "fe-1" }),
        session("s-2", "w", { active_bead: "fe-2" }),
        session("s-3", "w", { active_bead: "fe-3" }),
        session("s-4", "w", { active_bead: "fe-4" }),
        session("s-5", "w"),
      ])),
      ready: slot({ items: [ready("fe-1", "fix login")], unreadable: [] }),
      beads: new Map([
        ["fe-2", slot(bead("fe-2", "add tests"))],
        ["fe-3", EMPTY],
        ["fe-4", failed({ kind: "http", status: 404, problem: { detail: "bead not found", errors: [] } })],
      ]),
      recent: [],
    });
    expect(m.groups[0]!.agents[0]!.sessions.map((s) => s.activeBead)).toEqual([
      { id: "fe-1", title: "fix login", note: null },
      { id: "fe-2", title: "add tests", note: null },
      { id: "fe-3", title: null, note: "loading title" },
      { id: "fe-4", title: null, note: "title unavailable: gc answered 404: bead not found" },
      null,
    ]);
  });

  test("attached and transport are carried; unknown values are listed for the diagnostics once each", () => {
    const m = model({
      agents: slot(list([agent("w")])),
      sessions: slot(sessions([
        session("s-1", "w", { attached: true, transport: "acp", program_status: { state: { kind: "unrecognized", raw: "thinking" }, since: "t", working_children: 0 } }),
        session("s-2", "w", { program_status: { state: { kind: "unrecognized", raw: "thinking" }, since: "t", working_children: 0 } }),
      ])),
    });
    expect(m.groups[0]!.agents[0]!.sessions[0]).toMatchObject({ attached: true, transport: "acp" });
    expect(m.drift).toEqual(["program_status.state thinking"]);
  });

  test("gc-supplied names and titles are cleaned", () => {
    const m = model({
      agents: slot(list([agent("w\u001b[31m", { display_name: "Worker\u0007" })])),
      sessions: slot(sessions([session("s-1", "w\u001b[31m", { alias: "one‮", active_bead: "b-1" })])),
      beads: new Map([["b-1", slot(bead("b-1", "title\r\nwith\u0000 break"))]]),
    });
    const a = m.groups[0]!.agents[0]!;
    expect(a.label).toBe("Worker");
    expect(a.sessions[0]!.label).toBe("one");
    expect(a.sessions[0]!.activeBead?.title).toBe("title with break");
  });
});

describe("pagination, partial lists and unreadable rows", () => {
  test("a truncated session list says how many are shown of how many", () => {
    const m = model({ sessions: slot(sessions([session("s-1", "x")], { total: 2400, truncated: true })) });
    expect(m.banners).toContain("showing 1 of 2400 sessions");
  });

  test("partial answers show gc's partial_errors verbatim (cleaned)", () => {
    const m = model({
      agents: slot({ ...list([agent("w")], { partial: true, partial_errors: ["rig frontend: config unreadable\u0007"] }) }),
      sessions: slot(sessions([], { partial: true, partialErrors: ["runtime probe failed"] })),
    });
    expect(m.banners).toEqual([
      "gc's agent list is partial: rig frontend: config unreadable",
      "gc's session list is partial: runtime probe failed",
    ]);
  });

  test("an entry gc sent that cannot be read is an 'unreadable' row, not a gap", () => {
    const m = model({
      sessions: slot(sessions([session("s-1", "x")], { unreadable: [{ index: 1, id: "s-2", error: decodeError("s-2") }] })),
      agents: slot(list([], { unreadable: [{ index: 0, id: null, error: { ...decodeError("a"), operationId: "get-v0-city-by-city-name-agents" } }] })),
    });
    expect(m.unreadable).toEqual([
      { kind: "agent", text: "unreadable agent (entry 0): unreadable answer to get-v0-city-by-city-name-agents at items[1].state: state: expected string (a)" },
      { kind: "session", text: "unreadable session s-2: unreadable answer to get-v0-city-by-city-name-sessions at items[1].state: state: expected string (s-2)" },
    ]);
  });
});

describe("staleness and errors", () => {
  test("fresh data says how old it is", () => {
    const m = model({ sessions: slot(sessions([]), { ageMs: 3_000 }), agents: slot(list([]), { ageMs: 1_000 }), rigs: slot(list([]), { ageMs: 2_000 }) });
    expect(m.region).toEqual({ kind: "ok", age: "data 3 s old", stale: false, error: null });
  });

  test("before the first answer the region is loading", () => {
    expect(model({ sessions: EMPTY }).region).toEqual({ kind: "loading", age: null, stale: false, error: null });
  });

  test("a failure before any data is shown as the region's error", () => {
    const m = model({ sessions: failed({ kind: "unreachable", url: "http://127.0.0.1:8372/v0/city/scratch/sessions", cause: "refused" }) });
    expect(m.region).toEqual({
      kind: "failed", age: null, stale: true, error: "sessions: cannot reach http://127.0.0.1:8372/v0/city/scratch/sessions: refused",
    });
  });

  test("a failure after data keeps the data, greyed, with the error above it", () => {
    const m = model({
      agents: slot(list([agent("w")])),
      sessions: slot(sessions([session("s-1", "w")]), { ageMs: 40_000, error: { kind: "http", status: 500, problem: null, raw: "boom" } }),
    });
    expect(m.region).toEqual({ kind: "ok", age: "data 40 s old", stale: true, error: "sessions: gc answered 500: boom" });
    expect(m.groups[0]!.agents[0]!.sessions.map((s) => s.id)).toEqual(["s-1"]);
  });

  test("data not refreshed for a long time is stale without an error", () => {
    const m = model({ sessions: slot(sessions([]), { ageMs: 120_000 }) });
    expect(m.region).toMatchObject({ kind: "ok", age: "data 2 min old", stale: true, error: null });
  });
});
