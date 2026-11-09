// Decoding what gc's bead events carry: the whole bead, for the closed list.

import { describe, expect, test } from "bun:test";
import { eventBead } from "../../../src/gc/events.ts";

describe("eventBead: the bead a bead event carries", () => {
  const bead = { id: "fe-1", title: "T", status: "open", issue_type: "task", labels: null, created_at: "t" };
  const ev = (type: string, payload: unknown) => ({ seq: 1, type, ts: "t", actor: "a", subject: "fe-1", payload });

  test("bead.created/updated/closed/deleted carry gc's BeadEventPayload: the bead is decoded", () => {
    for (const type of ["bead.created", "bead.updated", "bead.closed", "bead.deleted"]) {
      expect(eventBead(ev(type, { bead }))).toEqual({ ok: true, value: { ...bead, labels: [] } });
    }
  });

  test("other event types carry no bead: null, not an error", () => {
    expect(eventBead(ev("bead.dead_assignee_reopened", { bead }))).toEqual({ ok: true, value: null });
    expect(eventBead(ev("session.woke", {}))).toEqual({ ok: true, value: null });
  });

  test("a payload that does not decode is a decode error naming the event", () => {
    const r = eventBead(ev("bead.updated", { bead: { id: "fe-1" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ kind: "decode", operationId: "get-v0-city-by-city-name-events" });
      expect(r.error.path.startsWith("event 1 bead.updated payload")).toBe(true);
    }
  });
});
