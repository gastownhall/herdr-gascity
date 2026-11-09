// The event watcher's cursor. herdr's fetch hides X-GC-Index, so the cursor
// comes from the body: the newest `seq` the page shows. gc reads the page
// before it reads LatestSeq for `total`, so `total` can name an event the page
// does not hold yet; that is not a gap, and the event comes with the next
// poll. A gap is a hole between the cursor and the oldest new event, or an
// unreadable entry that may be new. A total below the cursor means gc's log
// was reset.

import { describe, expect, test } from "bun:test";
import { readEventPage } from "../../../src/sync/watcher.ts";
import type { TypedEventStreamEnvelope } from "../../../src/gc/types.gen.ts";

function ev(seq: number): TypedEventStreamEnvelope {
  return { seq, type: "bead.updated", ts: "t", actor: "a", payload: {} };
}

/** A newest-first page; `null` marks an entry that did not decode. */
function page(total: number, entries: (number | null)[]) {
  const items = entries.filter((e): e is number => e !== null).map(ev);
  const unreadable = entries.flatMap((e, index) => (e === null ? [index] : []));
  return { total, items, unreadable };
}

describe("readEventPage", () => {
  test("nothing new", () => {
    expect(readEventPage(232, page(232, [232, 231, 230]))).toEqual({ cursor: 232, newer: [], resync: null });
  });

  test("new events come back oldest first; the cursor moves to the newest seq shown", () => {
    const r = readEventPage(230, page(233, [233, 232, 231, 230, 229]));
    expect(r.newer.map((e) => e.seq)).toEqual([231, 232, 233]);
    expect(r.cursor).toBe(233);
    expect(r.resync).toBeNull();
  });

  test("gc's race: total names an event appended after the page was read; not a gap, and the event is not skipped", () => {
    const r = readEventPage(230, page(232, [231, 230, 229]));
    expect(r).toEqual({ cursor: 231, newer: [ev(231)], resync: null });
    const next = readEventPage(r.cursor, page(232, [232, 231, 230]));
    expect(next).toEqual({ cursor: 232, newer: [ev(232)], resync: null });
  });

  test("the race with no new event in the page at all", () => {
    expect(readEventPage(230, page(231, [230, 229]))).toEqual({ cursor: 230, newer: [], resync: null });
  });

  test("more new events than the page holds is a gap", () => {
    const r = readEventPage(100, page(160, Array.from({ length: 50 }, (_, i) => 160 - i)));
    expect(r.resync).toBe("gap");
    expect(r.cursor).toBe(160);
    expect(r.newer.length).toBe(50);
  });

  test("an unreadable entry between new events is a gap", () => {
    const r = readEventPage(10, page(13, [13, null, 11, 10]));
    expect(r.resync).toBe("gap");
    expect(r.newer.map((e) => e.seq)).toEqual([11, 13]);
    expect(r.cursor).toBe(13);
  });

  test("an unreadable entry below the cursor is old: no gap", () => {
    expect(readEventPage(12, page(13, [13, 12, null, 10]))).toEqual({ cursor: 13, newer: [ev(13)], resync: null });
  });

  test("an unreadable newest entry is a gap once; the cursor moves to total so it is not one forever", () => {
    const r = readEventPage(10, page(11, [null, 10, 9]));
    expect(r).toEqual({ cursor: 11, newer: [], resync: "gap" });
    expect(readEventPage(r.cursor, page(11, [null, 10, 9]))).toEqual({ cursor: 11, newer: [], resync: null });
  });

  test("a total below the cursor means gc's event log was reset", () => {
    expect(readEventPage(500, page(3, [3, 2, 1]))).toEqual({ cursor: 3, newer: [], resync: "reset" });
  });

  test("an empty log", () => {
    expect(readEventPage(0, page(0, []))).toEqual({ cursor: 0, newer: [], resync: null });
  });
});
