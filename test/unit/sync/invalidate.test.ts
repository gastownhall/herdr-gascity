// The invalidation map: which gc event types make which store domains stale,
// and which bead subjects get a targeted refetch.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_DOMAINS, HANDLED_BY_NAME, SESSION_LIFECYCLE, invalidationFor, type Domain } from "../../../src/sync/invalidate.ts";
import type { TypedEventStreamEnvelope } from "../../../src/gc/types.gen.ts";

let seq = 100;
const BEAD_PAYLOADS = new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted"]);

/** A bead event carries its bead, as gc's do; `labels` are the bead's. */
function beadPayload(id: string, labels: string[]) {
  return { bead: { id, title: "t", status: "open", issue_type: "task", labels, created_at: "2026-11-09T00:00:00Z" } };
}

function ev(type: string, subject?: string, payload?: unknown): TypedEventStreamEnvelope {
  const body = payload ?? (BEAD_PAYLOADS.has(type) ? beadPayload(subject ?? "fe-1", []) : {});
  return { seq: ++seq, type, ts: "2026-11-09T00:00:00Z", actor: "test", ...(subject === undefined ? {} : { subject }), payload: body };
}

const known = { sessionIds: new Set(["sc-20", "sc-6"]), humanIds: new Set(["ga-h1"]) };

function domains(...events: TypedEventStreamEnvelope[]): Domain[] {
  return [...invalidationFor(events, known).domains].sort();
}

describe("event type → domains", () => {
  const table: [string, string | undefined, Domain[]][] = [
    ["session.woke", "sc-20", ["agents", "sessions"]],
    ["session.crashed", "sc-20", ["agents", "sessions"]],
    ["session.suspended", "sc-99", ["agents", "sessions"]],
    ["session.updated", undefined, ["agents", "sessions"]],
    ["session.created", "sc-30", ["agents", "sessions"]],
    ["session.created", undefined, ["agents", "sessions"]],
    ["session.closed", "sc-20", ["agents", "pending", "sessions"]],
    ["session.closed", undefined, ["agents", "pending", "sessions"]],
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
    ["bead.dead_assignee_reopened", "fe-9", ["human", "inProgress", "ready"]],
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
    expect([...ALL_DOMAINS].sort()).toEqual(["agents", "human", "inProgress", "pending", "ready", "rigs", "sessions"]);
  });
});

describe("event types handled by name", () => {
  test("each is one of gc's event names in the pinned spec, so a rename in gc fails here at the re-pin", () => {
    const spec = JSON.parse(readFileSync(join(import.meta.dir, "../../../api/openapi.pinned.json"), "utf8")) as {
      components: { schemas: { TypedEventStreamEnvelopeCustom: { properties: { type: { not: { enum: string[] } } } } } };
    };
    // gc's typed envelope lists every known event type here (the custom envelope is "any type but these").
    const known = new Set(spec.components.schemas.TypedEventStreamEnvelopeCustom.properties.type.not.enum);
    expect(known.size).toBeGreaterThan(0);
    expect(HANDLED_BY_NAME.filter((t) => !known.has(t))).toEqual([]);
    expect(HANDLED_BY_NAME).toContain("session.created");
  });
});

describe("session lifecycle events (session.created, session.closed)", () => {
  test("both are handled by name, not only by the session.* prefix", () => {
    expect([...SESSION_LIFECYCLE].sort()).toEqual(["session.closed", "session.created"]);
  });

  test("a created session's bead event is not needed to refresh sessions", () => {
    // sc-30 is not a known session yet: only session.created can surface it.
    expect(domains(ev("session.created", "sc-30"))).toEqual(["agents", "sessions"]);
  });

  test("a closed session's pending prompt is refetched with it", () => {
    expect(domains(ev("session.closed", "sc-6"), ev("bead.closed", "sc-6"))).toEqual([
      "agents", "inProgress", "pending", "ready", "sessions",
    ]);
  });
});

describe("bead events without a subject, and the city list", () => {
  test("bead events without a subject still refetch the board columns", () => {
    const inv = invalidationFor([ev("bead.closed"), ev("bead.updated")], known);
    expect([...inv.domains].sort()).toEqual(["inProgress", "ready"]);
  });

  test("city.* events report a city-list change", () => {
    expect(invalidationFor([ev("city.suspended")], known).cities).toBe(true);
    expect(invalidationFor([ev("session.woke")], known).cities).toBe(false);
  });

  test("no events, no work", () => {
    const inv = invalidationFor([], known);
    expect(inv.domains.size).toBe(0);
  });
});

describe("the Needs-a-human list", () => {
  test("a bead labeled human refetches it", () => {
    expect(domains(ev("bead.created", "ga-2", beadPayload("ga-2", ["human"])))).toEqual(["human", "inProgress", "ready"]);
  });

  test("a listed bead that lost the label, or closed, refetches it", () => {
    expect(domains(ev("bead.updated", "ga-h1", beadPayload("ga-h1", [])))).toEqual(["human", "inProgress", "ready"]);
    expect(domains(ev("bead.closed", undefined, beadPayload("ga-h1", ["human"])))).toEqual(["human", "inProgress", "ready"]);
  });

  test("a bead event whose bead cannot be read refetches it", () => {
    expect(domains(ev("bead.updated", "fe-9", {}))).toEqual(["human", "inProgress", "ready"]);
  });

  test("other bead changes leave it alone", () => {
    expect(domains(ev("bead.updated", "fe-9", beadPayload("fe-9", ["needs-review"])), ev("bead.deleted", "fe-8"))).toEqual(["inProgress", "ready"]);
  });
});
