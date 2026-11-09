// The probe document is a serialization of the view-models render draws.

import { describe, expect, test } from "bun:test";
import { initialMachine, step } from "../../../src/discovery/city.ts";
import { ok } from "../../../src/result.ts";
import { agentsModel } from "../../../src/vm/agents.ts";
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
      ready: slot({ items: [ready("fe-1", "fix login")], unreadable: [] }),
      peeks: new Map([["s-1", slot(session("s-1", "w", { last_output: "CANARY READY canary-1" }))]]),
      recent: [{ seq: 7, bead: bead("fe-2", "done thing", { status: "closed", close_reason: "canary n1" }) }],
    });
    const agents = agentsModel({ snapshot: snap, now: NOW, selected: "s-1", collapsed: new Set() });
    const header = headerModel(m, [], { connection: snap.connection, now: NOW, needsYou: agents.needsYou, age: agents.region.age });
    const doc = probeDocument({
      modVersion: "0.0.0", herdrVersion: "0.1.14", machine: m, header, onScreen: true, keyboard: false, agents, snapshot: snap,
      detail: detailModel({ snapshot: snap, now: NOW, selected: "s-1" }),
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
        ready: [{ id: "fe-1", title: "fix login" }],
        in_progress: [],
        closed_ring: [{ id: "fe-2", seq: 7, title: "done thing", close_reason: "canary n1" }],
      },
      detail: { session: "s-1", status: "working", output: "CANARY READY canary-1", wake_reasons: "loading", pending: { kind: "loading" } },
      actions: [],
      exec_log: [{ at: 1, kind: "exec", argv: ["gc", "supervisor", "status", "--json"] }],
      errors: [{ at: "2026-11-09T12:00:00Z", source: "events", text: "x" }],
      refresh_count: 2,
      fetch_in_flight_max: 2,
    });
  });

  test("before discovery: no city, no sessions", () => {
    const m = initialMachine({ pinned: null, lastSelection: null });
    const doc = probeDocument({
      modVersion: "0.0.0", herdrVersion: null, machine: m, header: headerModel(m), onScreen: false, keyboard: false, agents: null,
      snapshot: null, detail: { kind: "none" }, diagnostics: [], execLog: [], refreshCount: 0, fetchInFlightMax: 0,
    });
    expect(doc).toMatchObject({ connection: { text: "looking for gc", tone: "busy" }, discovery: null, city: null, city_phase: "discovering", sessions: [], detail: null });
  });
});
