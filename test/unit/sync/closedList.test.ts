// The recently-closed list the store keeps: closes in close order (event
// seq), only beads gc says are closed, infrastructure beads counted but not
// listed, and beads that were reopened or deleted dropped (also from the seed).

import { describe, expect, test } from "bun:test";
import type * as T from "../../../src/gc/types.gen.ts";
import { ClosedList } from "../../../src/sync/closedList.ts";

const bead = (id: string, status = "closed", extra: Partial<T.Bead> = {}): T.Bead => ({ id, title: id, status, issue_type: "task", labels: [], created_at: "t", ...extra });
const ids = (l: ClosedList) => l.recent().map((c) => [c.bead.id, c.seq]);

describe("ClosedList", () => {
  test("keeps closes newest first, one per bead at its latest close, at most `limit`", () => {
    const l = new ClosedList(3);
    l.closed(1, bead("a"));
    l.closed(4, bead("b"));
    l.closed(2, bead("c"));
    l.closed(5, bead("a"));
    l.closed(3, bead("b"));
    expect(ids(l)).toEqual([["a", 5], ["b", 4], ["c", 2]]);
    l.closed(6, bead("d"));
    expect(ids(l)).toEqual([["d", 6], ["a", 5], ["b", 4]]);
  });

  test("a bead whose fetched state is not closed (reopened before the fetch) is not listed, and leaves the seed", () => {
    const l = new ClosedList(20);
    l.closed(3, bead("a", "open"));
    expect(ids(l)).toEqual([]);
    expect(l.dropped("a")).toBe(true);
  });

  test("current state: a listed bead that is no longer closed is dropped; one still closed is updated in place", () => {
    const l = new ClosedList(20);
    l.closed(3, bead("a"));
    l.closed(4, bead("b"));
    l.current(bead("a", "closed", { close_reason: "now with a reason" }));
    expect(l.recent()[1]).toEqual({ seq: 3, bead: bead("a", "closed", { close_reason: "now with a reason" }) });
    l.current(bead("b", "blocked"));
    expect(ids(l)).toEqual([["a", 3]]);
    expect(l.dropped("b")).toBe(true);
  });

  test("current state of a bead not listed but closed adds nothing (no close time is known)", () => {
    const l = new ClosedList(20);
    l.current(bead("z"));
    expect(ids(l)).toEqual([]);
    expect(l.dropped("z")).toBe(false);
  });

  test("removed (deleted, or gc no longer has it): dropped from the list and the seed", () => {
    const l = new ClosedList(20);
    l.closed(3, bead("a"));
    l.remove("a");
    l.remove("seeded");
    expect(ids(l)).toEqual([]);
    expect(l.dropped("a") && l.dropped("seeded")).toBe(true);
  });

  test("a later close of a dropped bead lists it again", () => {
    const l = new ClosedList(20);
    l.remove("a");
    l.closed(9, bead("a"));
    expect(ids(l)).toEqual([["a", 9]]);
  });

  test("infrastructure closes take no slot: counted (distinct, the newest `limit`), never listed", () => {
    const l = new ClosedList(2);
    l.closed(1, bead("s1", "closed", { issue_type: "session" }));
    l.closed(2, bead("m1", "closed", { issue_type: "molecule" }));
    l.closed(3, bead("s1", "closed", { issue_type: "session" }));
    l.closed(4, bead("t1"));
    expect(ids(l)).toEqual([["t1", 4]]);
    expect(l.hidden()).toBe(2);
    l.closed(5, bead("g1", "closed", { issue_type: "gate" }));
    expect(l.hidden()).toBe(2);
  });
});
