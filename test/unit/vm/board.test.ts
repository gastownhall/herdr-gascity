// The work board's view-model: Ready and In progress from gc's bounded
// /work/ready columns, Recently closed from the closes seen in events (by
// close time) above the one-time seed (by creation time), infrastructure
// beads hidden, readable states, staleness and errors per column, and the
// selected bead's detail. Every gc string is cleaned.

import { describe, expect, test } from "bun:test";
import { INFRASTRUCTURE_BEAD_TYPES } from "../../../src/gc/ops.ts";
import { BOARD_LIMIT, MAX_CLOSED_RECENT } from "../../../src/sync/store.ts";
import { beadDetailModel, beadState, boardModel, type BoardModel, type BeadCard } from "../../../src/vm/board.ts";
import { EMPTY, NOW, bead, failed, ready, slot, snapshot } from "./snap.ts";

function model(parts: Parameters<typeof snapshot>[0], selected: string | null = null): BoardModel {
  return boardModel({ snapshot: snapshot(parts), now: NOW, selected });
}

const ids = (cards: readonly BeadCard[]) => cards.map((c) => c.id);
const work = (items: ReturnType<typeof ready>[], unreadable: { index: number; id: string | null; error: { kind: "decode"; operationId: string; path: string; issues: string[] } }[] = []) => ({ items, unreadable });
const closedBead = (id: string, title: string, extra: Parameters<typeof bead>[2] = {}) => bead(id, title, { status: "closed", ...extra });
const decodeError = { kind: "decode" as const, operationId: "get-v0-city-by-city-name-work-ready", path: "items[1].title", issues: ["title: expected string"] };

describe("columns", () => {
  test("Ready and In progress keep gc's order and show priority, readable state, type, assignee and labels", () => {
    const m = model({
      ready: slot(work([
        ready("fe-14", "add tests", { priority: 1, labels: ["ui", "tests"] }),
        ready("fe-15", "docs", { priority: 2, is_blocked: true }),
      ])),
      inProgress: slot(work([ready("fe-12", "fix login", { status: "in_progress", assignee: "frontend/builder", issue_type: "bug" })])),
    });
    expect(ids(m.ready.cards)).toEqual(["fe-14", "fe-15"]);
    expect(m.ready.cards[0]).toMatchObject({ title: "add tests", priority: "P1", state: "open", type: "task", assignee: null, labels: ["ui", "tests"] });
    expect(m.ready.cards[1]).toMatchObject({ priority: "P2", state: "blocked" });
    expect(m.inProgress.cards[0]).toMatchObject({ id: "fe-12", state: "in progress", type: "bug", assignee: "frontend/builder", priority: null });
    expect([m.ready.title, m.inProgress.title, m.closed.title]).toEqual(["Ready", "In progress", "Recently closed"]);
    expect([m.ready.count, m.inProgress.count]).toEqual(["2", "1"]);
  });

  test("a full page says N+ (gc's work list has no total)", () => {
    const full = Array.from({ length: BOARD_LIMIT }, (_, i) => ready(`b-${i}`, `bead ${i}`));
    expect(model({ ready: slot(work(full)) }).ready.count).toBe(`${BOARD_LIMIT}+`);
    expect(model({ ready: slot(work(full.slice(1))) }).ready.count).toBe(`${BOARD_LIMIT - 1}`);
  });

  test("empty columns say so once their data is in; before that they are loading", () => {
    const m = model({});
    expect(m.ready).toMatchObject({ cards: [], empty: "nothing ready", region: { kind: "ok" } });
    expect(m.inProgress.empty).toBe("nothing in progress");
    expect(m.closed.empty).toBe("nothing closed yet");
    const loading = model({ ready: EMPTY, inProgress: EMPTY, seed: EMPTY });
    expect(loading.ready).toMatchObject({ empty: null, region: { kind: "loading", age: null } });
    expect(loading.closed.region.kind).toBe("loading");
  });

  test("a selected card is marked", () => {
    const m = model({ ready: slot(work([ready("a", "A"), ready("b", "B")])) }, "b");
    expect(m.ready.cards.map((c) => c.selected)).toEqual([false, true]);
  });
});

describe("readable states", () => {
  test("gc's statuses read as words; is_blocked wins; an unknown status is shown raw and reported", () => {
    expect(beadState("open", undefined)).toEqual({ text: "open", unrecognized: null });
    expect(beadState("in_progress", false)).toEqual({ text: "in progress", unrecognized: null });
    expect(beadState("open", true)).toEqual({ text: "blocked", unrecognized: null });
    expect(beadState("closed", undefined)).toEqual({ text: "closed", unrecognized: null });
    expect(beadState("deferred", undefined)).toEqual({ text: "deferred", unrecognized: "bead status deferred" });
    const m = model({ ready: slot(work([ready("a", "A", { status: "hooked" })])) });
    expect(m.ready.cards[0]!.state).toBe("hooked");
    expect(m.drift).toEqual(["bead status hooked"]);
  });
});

describe("infrastructure beads", () => {
  test("the board names the types it hides, from ops.ts", () => {
    expect(model({}).filter).toBe(`hiding infrastructure beads (${INFRASTRUCTURE_BEAD_TYPES.join(", ")})`);
  });

  test("they are hidden in every column, including closes seen in events (which gc does not filter), and counted", () => {
    const m = model({
      ready: slot(work([ready("a", "A"), ready("s", "a session", { issue_type: "session" })])),
      seed: slot(work([ready("m", "a molecule", { status: "closed", issue_type: "molecule" }), ready("c", "C", { status: "closed" })])),
      recent: [
        { seq: 9, bead: closedBead("sess", "session bead", { issue_type: "session" }) },
        { seq: 8, bead: closedBead("g", "gate", { issue_type: "gate" }) },
        { seq: 7, bead: closedBead("d", "D") },
      ],
    });
    expect(ids(m.ready.cards)).toEqual(["a"]);
    expect(ids(m.closed.recent)).toEqual(["d"]);
    expect(ids(m.closed.earlier)).toEqual(["c"]);
    expect(m.hidden).toBe(4);
  });
});

describe("recently closed", () => {
  test("closes seen in events come first, newest close (event seq) first, with gc's close reason and assignee", () => {
    const m = model({
      recent: [
        { seq: 3, bead: closedBead("old", "closed first", { close_reason: "done" }) },
        { seq: 11, bead: closedBead("new", "closed last", { close_reason: "shipped", assignee: "w-1" }) },
      ],
    });
    expect(m.closed.recent.map((c) => [c.id, c.seq, c.closeReason, c.assignee])).toEqual([
      ["new", 11, "shipped", "w-1"],
      ["old", 3, "done", null],
    ]);
  });

  test("the seed follows under its own divider (by creation time), without beads already listed above", () => {
    const m = model({
      recent: [{ seq: 5, bead: closedBead("b", "B") }],
      seed: slot(work([ready("b", "B", { status: "closed" }), ready("a", "A", { status: "closed", close_reason: "dup" })])),
    });
    expect(ids(m.closed.recent)).toEqual(["b"]);
    expect(m.closed.earlier.map((c) => [c.id, c.closeReason])).toEqual([["a", "dup"]]);
    expect(m.closed.divider).toBe("earlier (by creation time)");
  });

  test("a bead closed twice is listed once, at its latest close", () => {
    const m = model({ recent: [{ seq: 4, bead: closedBead("x", "X first") }, { seq: 9, bead: closedBead("x", "X again") }] });
    expect(m.closed.recent.map((c) => [c.id, c.seq, c.title])).toEqual([["x", 9, "X again"]]);
  });

  test("a closed bead that is back in Ready or In progress (reopened) is not listed as closed", () => {
    const m = model({
      ready: slot(work([ready("r", "R")])),
      inProgress: slot(work([ready("p", "P", { status: "in_progress" })])),
      recent: [{ seq: 6, bead: closedBead("r", "R") }],
      seed: slot(work([ready("p", "P", { status: "closed" })])),
    });
    expect(m.closed.recent).toEqual([]);
    expect(m.closed.earlier).toEqual([]);
  });

  test(`the list holds at most ${MAX_CLOSED_RECENT}; the seed fills what the closes leave`, () => {
    const recent = Array.from({ length: 15 }, (_, i) => ({ seq: 100 + i, bead: closedBead(`r-${i}`, `R${i}`) }));
    const seed = Array.from({ length: 20 }, (_, i) => ready(`s-${i}`, `S${i}`, { status: "closed" }));
    const m = model({ recent, seed: slot(work(seed)) });
    expect(m.closed.recent.length).toBe(15);
    expect(ids(m.closed.earlier)).toEqual(["s-0", "s-1", "s-2", "s-3", "s-4"]);
    expect(m.closed.count).toBe(`${MAX_CLOSED_RECENT}`);
  });

  test("closes that could not all be fetched mark the list as possibly incomplete", () => {
    expect(model({ incomplete: true }).closed.banners).toEqual(["may be incomplete: some closes were not fetched"]);
    expect(model({}).closed.banners).toEqual([]);
  });

  test("its age runs from the last event poll (closes arrive by event); a failed seed shows its error above what is known", () => {
    const m = model({ seed: slot(work([]), { ageMs: 600_000 }), polledAt: NOW - 2000 });
    expect(m.closed.region).toMatchObject({ kind: "ok", age: "data 2 s old", stale: false });
    const f = model({ seed: failed({ kind: "http", status: 500, problem: { status: 500, detail: "db down", errors: [] } }), recent: [{ seq: 2, bead: closedBead("d", "D") }] });
    expect(f.closed.region).toMatchObject({ kind: "failed", error: "closed: gc answered 500: db down" });
    expect(ids(f.closed.recent)).toEqual(["d"]);
  });
});

describe("staleness and errors", () => {
  test("a column keeps its last data, greyed, with the error above it", () => {
    const m = model({ ready: slot(work([ready("a", "A")]), { ageMs: 30_000, error: { kind: "unreachable", url: "http://127.0.0.1:8372", cause: "connection refused" } }) });
    expect(m.ready.region).toMatchObject({ kind: "ok", stale: true, error: "ready: cannot reach http://127.0.0.1:8372: connection refused" });
    expect(ids(m.ready.cards)).toEqual(["a"]);
  });

  test("a first fetch that failed says so; no cards, no 'nothing ready'", () => {
    const m = model({ inProgress: failed({ kind: "timeout", url: "http://127.0.0.1:8372/x", ms: 30_000 }) });
    expect(m.inProgress).toMatchObject({ cards: [], empty: null, region: { kind: "failed", error: "in progress: no answer from http://127.0.0.1:8372/x within 30 s" } });
  });

  test("an event watcher that stopped answering makes event-driven columns age instead of being confirmed", () => {
    const m = model({
      ready: slot(work([]), { ageMs: 120_000 }),
      events: { error: { kind: "unreachable", url: "u", cause: "down" } },
    });
    expect(m.ready.region).toMatchObject({ stale: true, age: "data 2 min old" });
  });

  test("an entry gc sent that cannot be read is an 'unreadable bead' row, counted", () => {
    const m = model({
      ready: slot({ items: [ready("a", "A")], unreadable: [{ index: 1, id: "fe-\u001b[31m9", error: decodeError }] }),
      seed: slot({ items: [], unreadable: [{ index: 0, id: null, error: decodeError }] }),
    });
    expect(m.ready.unreadable).toEqual(["unreadable bead fe-9: unreadable answer to get-v0-city-by-city-name-work-ready at items[1].title: title: expected string"]);
    expect(m.closed.unreadable).toEqual(["unreadable bead (entry 0): unreadable answer to get-v0-city-by-city-name-work-ready at items[1].title: title: expected string"]);
    expect(m.unreadable.length).toBe(2);
  });
});

describe("sanitising", () => {
  test("ids, titles, assignees, labels, types and close reasons are cleaned of escapes and control characters", () => {
    const m = model({
      ready: slot(work([ready("fe-\u001b]8;;http://x\u00071", "fix\u202e login\r\nnow", { assignee: "w\u0000-1", labels: ["u\u001b[1mi"], issue_type: "ta\u0007sk" })])),
      recent: [{ seq: 1, bead: closedBead("c-1", "C", { close_reason: "done\u001b[2J\nreally" }) }],
    });
    expect(m.ready.cards[0]).toMatchObject({ id: "fe-1", title: "fix login now", assignee: "w-1", labels: ["ui"], type: "task" });
    expect(m.closed.recent[0]!.closeReason).toBe("done really");
  });
});

describe("bead detail", () => {
  const board = {
    ready: slot(work([ready("fe-14", "add tests", { priority: 1, labels: ["ui"], created_at: "2026-11-09T01:00:00Z" })])),
    recent: [{ seq: 4, bead: closedBead("fe-2", "done thing", { close_reason: "shipped" }) }],
  };

  test("nothing selected: none", () => {
    expect(beadDetailModel({ snapshot: snapshot(board), now: NOW, selected: null })).toEqual({ kind: "none" });
  });

  test("a card's facts show at once; the description arrives with the bead fetched by id", () => {
    const loading = beadDetailModel({ snapshot: snapshot({ ...board, beads: new Map([["fe-14", EMPTY]]) }), now: NOW, selected: "fe-14" });
    expect(loading).toMatchObject({ kind: "bead", id: "fe-14", title: "add tests", description: null, descriptionNote: "loading description" });
    if (loading.kind !== "bead") throw new Error("kind");
    expect(loading.facts).toEqual([["status", "open"], ["priority", "P1"], ["type", "task"], ["labels", "ui"], ["created", "2026-11-09T01:00:00Z"]]);
    const full = beadDetailModel({
      snapshot: snapshot({ ...board, beads: new Map([["fe-14", slot(bead("fe-14", "add tests", { priority: 1, description: "line one\u001b[31m\r\nline two", updated_at: "2026-11-09T02:00:00Z" }))]]) }),
      now: NOW, selected: "fe-14",
    });
    expect(full).toMatchObject({ kind: "bead", description: "line one\nline two", descriptionNote: null });
    if (full.kind !== "bead") throw new Error("kind");
    expect(full.facts).toContainEqual(["updated", "2026-11-09T02:00:00Z"]);
    expect(full.region).toMatchObject({ kind: "ok", age: "data 0 s old", stale: false });
  });

  test("a closed bead shows its close reason; an empty description says so", () => {
    const d = beadDetailModel({ snapshot: snapshot({ ...board, beads: new Map([["fe-2", slot(closedBead("fe-2", "done thing", { close_reason: "shipped" }))]]) }), now: NOW, selected: "fe-2" });
    expect(d).toMatchObject({ kind: "bead", closeReason: "shipped", description: null, descriptionNote: "no description" });
  });

  test("a failed fetch keeps the card's facts and says why the description is missing", () => {
    const d = beadDetailModel({
      snapshot: snapshot({ ...board, beads: new Map([["fe-14", failed({ kind: "http", status: 404, problem: { status: 404, detail: "bead not found", errors: [] } })]]) }),
      now: NOW, selected: "fe-14",
    });
    expect(d).toMatchObject({ kind: "bead", title: "add tests", descriptionNote: "description unavailable: gc answered 404: bead not found" });
  });

  test("a bead neither on the board nor fetched is loading, or failed with gc's reason", () => {
    expect(beadDetailModel({ snapshot: snapshot({ beads: new Map([["x-1", EMPTY]]) }), now: NOW, selected: "x-1" })).toEqual({ kind: "missing", id: "x-1", text: "bead x-1: loading" });
    expect(beadDetailModel({
      snapshot: snapshot({ beads: new Map([["x-\u00071", failed({ kind: "http", status: 404, problem: { status: 404, detail: "gone", errors: [] } })]]) }),
      now: NOW, selected: "x-\u00071",
    })).toEqual({ kind: "missing", id: "x-1", text: "bead x-1: gc answered 404: gone" });
  });
});
