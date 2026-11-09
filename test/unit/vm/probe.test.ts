// The probe document is a serialization of the view-models render draws.

import { describe, expect, test } from "bun:test";
import { sessionSubmit, sessionWake } from "../../../src/actions/session.ts";
import { activityModel } from "../../../src/vm/activity.ts";
import { initialMachine, step } from "../../../src/discovery/city.ts";
import { ok } from "../../../src/result.ts";
import { agentsModel } from "../../../src/vm/agents.ts";
import { beadDetailModel, boardModel } from "../../../src/vm/board.ts";
import { detailModel } from "../../../src/vm/detail.ts";
import { headerModel } from "../../../src/vm/header.ts";
import { PROBE_SCHEMA, probeDocument } from "../../../src/vm/probe.ts";
import { NOW, agent, bead, list, ready, session, sessions, slot, snapshot } from "./snap.ts";

const ENDPOINT = { url: "http://127.0.0.1:8372", source: "default" as const, version: "1.4.0", gcBin: "gc", attempts: [] };

describe("probeDocument", () => {
  test("a running city: connection, discovery, sessions with status, board, detail, logs", () => {
    let m = initialMachine({ pinned: null, lastSelection: null });
    m = step(m, { type: "resolved", result: ok(ENDPOINT) });
    m = step(m, { type: "cities", result: ok({ items: [{ name: "scratch", path: "/c", running: true }], unreadable: [], total: 1 }) });
    const snap = snapshot({
      agents: slot(list([agent("w")])),
      sessions: slot(sessions([session("s-1", "w", { program_status: { state: "working", since: "t", working_children: 0 }, active_bead: "fe-1" }), session("s-9", "x")])),
      ready: slot({ items: [ready("fe-1", "fix login", { priority: 1 }), ready("s-x", "a session bead", { issue_type: "session" })], unreadable: [] }),
      seed: slot({ items: [ready("fe-0", "older", { status: "closed", close_reason: "dup\u0007" })], unreadable: [] }),
      peeks: new Map([["s-1", slot(session("s-1", "w", { last_output: "CANARY READY canary-1" }))]]),
      recent: [{ seq: 7, bead: bead("fe-2", "done thing", { status: "closed", close_reason: "canary n1", assignee: "w" }) }],
      beads: new Map([["fe-2", slot(bead("fe-2", "done thing", { status: "closed", close_reason: "canary n1", description: "the canary's bead" }))]]),
    });
    const agents = agentsModel({ snapshot: snap, now: NOW, selected: "s-1", collapsed: new Set() });
    const header = headerModel(m, [], { connection: snap.connection, now: NOW, needsYou: agents.needsYou, age: agents.region.age });
    const doc = probeDocument({
      modVersion: "0.0.0", herdrVersion: "0.1.14", machine: m, header, onScreen: true, keyboard: false, agents,
      board: boardModel({ snapshot: snap, now: NOW, selected: "fe-2" }),
      beadDetail: beadDetailModel({ snapshot: snap, now: NOW, selected: "fe-2" }),
      detail: detailModel({ snapshot: snap, now: NOW, selected: "s-1" }),
      activity: activityModel({
        rev: 2,
        entries: [
          { id: 1, spec: sessionWake("s-1"), key: "k1", attempt: 1, startedAt: NOW - 9000, state: { kind: "done", at: NOW - 8000, detail: "gc: ok", requestId: null } },
          { id: 2, spec: sessionSubmit("s-1", "close fe-1 n1", "default"), key: "k2", attempt: 1, startedAt: NOW - 3000, state: { kind: "done", at: NOW - 1000, detail: "delivered", requestId: "req-9" } },
        ],
      }, snap, NOW),
      diagnostics: [{ at: "2026-11-09T12:00:00Z", source: "events", text: "x" }],
      execLog: [{ at: 1, kind: "exec", argv: ["gc", "supervisor", "status", "--json"] }],
      refreshCount: 2, fetchInFlightMax: 2,
    });
    expect(JSON.parse(JSON.stringify(doc))).toEqual({
      schema: PROBE_SCHEMA,
      mod_version: "0.0.0",
      herdr_version: "0.1.14",
      connection: { text: "connected", tone: "ok" },
      discovery: { source: "default", url: "http://127.0.0.1:8372", version: "1.4.0" },
      city: "scratch",
      city_phase: "city-running",
      visibility: { on_screen: true },
      keyboard: false,
      needs_you: 0,
      data_age: "data 1 s old",
      sessions: [
        { id: "s-1", label: "s-1", agent: "w", group: "city", status: "working", status_kind: "working", status_source: "program", attached: false, active_bead: "fe-1" },
        { id: "s-9", label: "s-9", agent: null, group: null, status: "unknown", status_kind: "unknown", status_source: "none", attached: false, active_bead: null },
      ],
      board: {
        filter: "hiding infrastructure beads (session, message, molecule, gate)",
        hidden: 1,
        ready: { count: "1", cards: [{ id: "fe-1", title: "fix login", state: "open", priority: "P1", assignee: null }] },
        in_progress: { count: "0", cards: [] },
        closed: {
          incomplete: false,
          recent: [{ id: "fe-2", title: "done thing", seq: 7, close_reason: "canary n1", assignee: "w" }],
          earlier: [{ id: "fe-0", title: "older", close_reason: "dup", assignee: null }],
        },
        errors: [],
      },
      bead_detail: { id: "fe-2", title: "done thing", state: "closed", close_reason: "canary n1", description: "the canary's bead" },
      detail: { session: "s-1", status: "working", output: "CANARY READY canary-1", wake_reasons: "loading", pending: { kind: "loading" } },
      actions: [
        { id: 2, action: "session.submit", title: "Send · session s-1", state: "done", detail: "delivered", request_id: "req-9", attempt: 1 },
        { id: 1, action: "session.wake", title: "Wake · session s-1", state: "done", detail: "gc: ok", request_id: null, attempt: 1 },
      ],
      exec_log: [{ at: 1, kind: "exec", argv: ["gc", "supervisor", "status", "--json"] }],
      errors: [{ at: "2026-11-09T12:00:00Z", source: "events", text: "x" }],
      refresh_count: 2,
      fetch_in_flight_max: 2,
    });
  });

  test("the closed list's incomplete flag is the model's own", () => {
    const m = initialMachine({ pinned: null, lastSelection: null });
    const board = boardModel({ snapshot: snapshot({ incomplete: true }), now: NOW, selected: null });
    const doc = probeDocument({
      modVersion: "0.0.0", herdrVersion: null, machine: m, header: headerModel(m), onScreen: false, keyboard: false, agents: null,
      board: { ...board, closed: { ...board.closed, banners: [] } }, beadDetail: { kind: "none" }, detail: { kind: "none" }, activity: null,
      diagnostics: [], execLog: [], refreshCount: 0, fetchInFlightMax: 0,
    });
    expect(doc.board?.closed.incomplete).toBe(true);
    const clean = boardModel({ snapshot: snapshot({}), now: NOW, selected: null });
    const other = probeDocument({
      modVersion: "0.0.0", herdrVersion: null, machine: m, header: headerModel(m), onScreen: false, keyboard: false, agents: null,
      board: { ...clean, closed: { ...clean.closed, banners: ["some other notice"] } }, beadDetail: { kind: "none" }, detail: { kind: "none" }, activity: null,
      diagnostics: [], execLog: [], refreshCount: 0, fetchInFlightMax: 0,
    });
    expect(other.board?.closed.incomplete).toBe(false);
  });

  test("before discovery: no city, no sessions", () => {
    const m = initialMachine({ pinned: null, lastSelection: null });
    const doc = probeDocument({
      modVersion: "0.0.0", herdrVersion: null, machine: m, header: headerModel(m), onScreen: false, keyboard: false, agents: null,
      board: null, beadDetail: { kind: "none" }, detail: { kind: "none" }, activity: null, diagnostics: [], execLog: [], refreshCount: 0, fetchInFlightMax: 0,
    });
    expect(doc).toMatchObject({ connection: { text: "looking for gc", tone: "busy" }, discovery: null, city: null, city_phase: "discovering", sessions: [], board: null, bead_detail: null, detail: null, actions: [] });
  });
});
