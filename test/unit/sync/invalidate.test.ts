// The invalidation map: which gc event types make which store domains stale,
// and which bead subjects get a targeted refetch.

import { describe, expect, test } from "bun:test";
import { ALL_DOMAINS, invalidationFor, type Domain } from "../../../src/sync/invalidate.ts";
import type { TypedEventStreamEnvelope } from "../../../src/gc/types.gen.ts";

let seq = 100;
function ev(type: string, subject?: string): TypedEventStreamEnvelope {
  return { seq: ++seq, type, ts: "2026-11-09T00:00:00Z", actor: "test", ...(subject === undefined ? {} : { subject }), payload: {} };
}

const known = { sessionIds: new Set(["sc-20", "sc-6"]) };

function domains(...events: TypedEventStreamEnvelope[]): Domain[] {
  return [...invalidationFor(events, known).domains].sort();
}

describe("event type → domains", () => {
  const table: [string, string | undefined, Domain[]][] = [
    ["session.woke", "sc-20", ["agents", "sessions"]],
    ["session.crashed", "sc-20", ["agents", "sessions"]],
    ["session.suspended", "sc-99", ["agents", "sessions"]],
    ["session.updated", undefined, ["agents", "sessions"]],
    ["request.result.session.create", "req-1", ["agents", "sessions"]],
    ["request.result.session.message", "req-1", ["agents", "sessions"]],
    ["request.failed", "req-1", ["agents", "sessions"]],
    ["worker.operation", "sc-20", ["agents", "sessions"]],
    ["session.pending", "sc-20", ["pending"]],
    ["session.pending_cleared", "sc-20", ["pending"]],
    ["bead.closed", "fe-9", ["inProgress", "ready"]],
    ["bead.created", "fe-9", ["inProgress", "ready"]],
    ["bead.updated", "fe-9", ["inProgress", "ready"]],
    ["bead.deleted", "fe-9", ["inProgress", "ready"]],
    ["bead.dead_assignee_reopened", "fe-9", ["inProgress", "ready"]],
    ["bead.updated", "sc-20", ["inProgress", "ready", "sessions"]],
    ["bead.created", "sc-6", ["inProgress", "ready", "sessions"]],
    ["bead.claim_released", "sc-20", ["sessions"]],
    ["bead.claim_released", "fe-9", []],
    ["city.suspended", undefined, ["agents", "rigs"]],
    ["city.resumed", undefined, ["agents", "rigs"]],
    ["order.fired", "gate-sweep", []],
    ["mail.sent", "m-1", []],
    ["some.future.type", "x", []],
  ];
  for (const [type, subject, want] of table) {
    test(`${type}${subject ? ` (${subject})` : ""} → ${want.join(", ") || "nothing"}`, () => {
      expect(domains(ev(type, subject))).toEqual(want);
    });
  }

  test("ALL_DOMAINS lists every domain once", () => {
    expect([...ALL_DOMAINS].sort()).toEqual(["agents", "inProgress", "pending", "ready", "rigs", "sessions"]);
  });
});

describe("closed beads and the city list", () => {
  test("bead.closed subjects go to the closed list with the event's seq, newest last, deduped to the latest seq", () => {
    const a = ev("bead.closed", "fe-9");
    const b = ev("bead.closed", "sc-74");
    const c = ev("bead.closed", "fe-9");
    const inv = invalidationFor([a, b, c], known);
    expect(inv.closed).toEqual([{ id: "sc-74", seq: b.seq }, { id: "fe-9", seq: c.seq }]);
  });

  test("bead events without a subject still refetch the board columns", () => {
    const inv = invalidationFor([ev("bead.closed"), ev("bead.updated")], known);
    expect([...inv.domains].sort()).toEqual(["inProgress", "ready"]);
    expect(inv.closed).toEqual([]);
  });

  test("city.* events report a city-list change", () => {
    expect(invalidationFor([ev("city.suspended")], known).cities).toBe(true);
    expect(invalidationFor([ev("session.woke")], known).cities).toBe(false);
  });

  test("no events, no work", () => {
    const inv = invalidationFor([], known);
    expect(inv.domains.size + inv.closed.length).toBe(0);
  });
});
