// The app-wide fetch budget: herdr's fetch holds a GPUI pool thread per
// request, so at most 2 gascity requests are in flight per app (all copies,
// cities and endpoints together), 1 to an endpoint in degraded mode, started
// in priority order.

import { describe, expect, test } from "bun:test";
import { FetchBudget, PRIORITIES, RECLAIM_AFTER_MS } from "../../../src/sync/budget.ts";
import { HERDR_FETCH_TIMEOUT_MS } from "../../../src/gc/client.ts";
import { FakeClock, FakeGc, flush } from "./fakes.ts";

const A = "http://127.0.0.1:8372";
const B = "http://127.0.0.1:9443";
const GET = { method: "GET", headers: {} };

function setup() {
  const clock = new FakeClock();
  const gc = new FakeGc(clock);
  gc.override = () => ({ hold: true });
  const budget = new FetchBudget(gc.fetch, clock);
  return { clock, gc, budget };
}

describe("cap", () => {
  test("never more than 2 in flight across endpoints, however many callers", async () => {
    const { gc, budget } = setup();
    const done: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) done.push(budget.fetchFor(i % 2 === 0 ? A : B, "snapshot")(`${i % 2 === 0 ? A : B}/x${i}`, GET));
    await flush();
    expect(gc.inFlight).toBe(2);
    expect(budget.stats()).toEqual({ inFlight: 2, queued: 10, maxInFlight: 2 });
    for (let i = 0; i < 12; i++) {
      gc.release();
      await flush();
      expect(gc.inFlight).toBeLessThanOrEqual(2);
    }
    await Promise.all(done);
    expect(gc.maxInFlight).toBe(2);
    expect(budget.stats()).toEqual({ inFlight: 0, queued: 0, maxInFlight: 2 });
  });

  test("a rejected or throwing fetch frees its slot", async () => {
    const clock = new FakeClock();
    const gc = new FakeGc(clock);
    let n = 0;
    const budget = new FetchBudget((url, init) => {
      n++;
      if (n === 1) throw new Error("sync throw");
      if (n === 2) return Promise.reject(new Error("connection refused"));
      return gc.fetch(url, init);
    }, clock);
    const f = budget.fetchFor(A, "snapshot");
    await expect(f(`${A}/v0/city/c/rigs`, GET)).rejects.toThrow("sync throw");
    await expect(f(`${A}/v0/city/c/rigs`, GET)).rejects.toThrow("connection refused");
    const r = await f(`${A}/v0/city/c/rigs`, GET);
    expect(r.status).toBe(200);
    expect(budget.stats().inFlight).toBe(0);
  });
});

describe("priority", () => {
  test("queued requests start in the order mutation > events > snapshot > peek > sweep, FIFO within one", async () => {
    const { gc, budget } = setup();
    const order: string[] = [];
    const go = (p: (typeof PRIORITIES)[number], tag: string) =>
      budget.fetchFor(A, p)(`${A}/${tag}`, GET).then(() => order.push(tag));
    const all = [go("snapshot", "fill1"), go("snapshot", "fill2")];
    await flush();
    all.push(go("sweep", "sweep"), go("peek", "peek"), go("snapshot", "snap1"), go("events", "events"), go("snapshot", "snap2"), go("mutation", "mut"));
    await flush();
    const started = () => gc.seen.map((r) => r.path.slice(1));
    while (gc.heldCount() > 0) {
      gc.release();
      await flush();
    }
    await Promise.all(all);
    expect(started()).toEqual(["fill1", "fill2", "mut", "events", "snap1", "snap2", "peek", "sweep"]);
    expect(PRIORITIES).toEqual(["mutation", "events", "snapshot", "peek", "sweep"]);
    expect(order.length).toBe(8);
  });
});

describe("degraded mode", () => {
  test("a degraded endpoint gets one request in flight; the other endpoint still gets the second slot", async () => {
    const { gc, budget } = setup();
    budget.setDegraded(A, true);
    const all = [0, 1, 2].map((i) => budget.fetchFor(A, "snapshot")(`${A}/a${i}`, GET));
    all.push(budget.fetchFor(B, "snapshot")(`${B}/b0`, GET));
    await flush();
    expect(gc.paths()).toEqual(["/a0", "/b0"]);
    gc.release(); // a0
    await flush();
    expect(gc.paths()).toEqual(["/a0", "/b0", "/a1"]);
    expect(budget.inFlightTo(A)).toBe(1);
    budget.setDegraded(A, false);
    await flush();
    expect(gc.paths()).toEqual(["/a0", "/b0", "/a1"]); // b0 still holds the other slot
    gc.release(); // b0
    await flush();
    expect(gc.paths()).toEqual(["/a0", "/b0", "/a1", "/a2"]);
    while (gc.heldCount() > 0) {
      gc.release();
      await flush();
    }
    await Promise.all(all);
  });

  test("leaving degraded mode starts queued requests at once", async () => {
    const { gc, budget } = setup();
    budget.setDegraded(A, true);
    const all = [0, 1].map((i) => budget.fetchFor(A, "snapshot")(`${A}/a${i}`, GET));
    await flush();
    expect(gc.inFlight).toBe(1);
    budget.setDegraded(A, false);
    await flush();
    expect(gc.inFlight).toBe(2);
    gc.release();
    gc.release();
    await Promise.all(all);
  });
});

describe("reclaiming slots whose fetch never settles", () => {
  // herdr cancels every task of a closed copy, and a cancelled fetch's promise
  // never settles. herdr's own 30 s timeout has freed the pool thread by then,
  // so a slot older than that (plus a margin) is reclaimed.
  test("the reclaim age is past herdr's fetch timeout", () => {
    expect(RECLAIM_AFTER_MS).toBeGreaterThan(HERDR_FETCH_TIMEOUT_MS);
    expect(RECLAIM_AFTER_MS).toBeLessThanOrEqual(HERDR_FETCH_TIMEOUT_MS + 10_000);
  });

  test("a slot that never settles is freed after the reclaim age; its caller gets a cancellation (not a gc timeout) with the host time", async () => {
    const { clock, gc, budget } = setup();
    const stuck = [0, 1].map((i) => budget.fetchFor(A, "snapshot")(`${A}/stuck${i}`, GET).then(() => "settled", (e: unknown) => e));
    const queued = budget.fetchFor(A, "snapshot")(`${A}/next`, GET);
    await flush();
    expect(gc.paths()).toEqual(["/stuck0", "/stuck1"]);
    await clock.advance(RECLAIM_AFTER_MS - 1);
    budget.reclaim();
    await flush();
    expect(budget.stats().inFlight).toBe(2);
    await clock.advance(1);
    budget.reclaim();
    await flush();
    const [e0] = await Promise.all(stuck);
    expect(e0).toBeInstanceOf(Error);
    expect((e0 as Error).message).toContain("cancelled");
    expect((e0 as { hostElapsedMs?: number }).hostElapsedMs).toBe(RECLAIM_AFTER_MS);
    expect((e0 as { cancelled?: string }).cancelled).toBe("copy-closed");
    expect(gc.paths()).toEqual(["/stuck0", "/stuck1", "/next"]);
    expect(budget.stats().inFlight).toBe(1);
    // the original promises settling late (they never do in herdr) must not free a slot twice
    gc.release();
    gc.release();
    await flush();
    expect(budget.stats().inFlight).toBe(1);
    gc.release();
    await queued;
    expect(budget.stats().inFlight).toBe(0);
  });

  test("fetchFor reclaims too, so a degraded endpoint whose one slot leaked gets going again", async () => {
    const { clock, gc, budget } = setup();
    budget.setDegraded(A, true);
    void budget.fetchFor(A, "events")(`${A}/leaked`, GET).catch(() => {});
    await flush();
    await clock.advance(RECLAIM_AFTER_MS);
    const next = budget.fetchFor(A, "events")(`${A}/probe`, GET);
    await flush();
    expect(gc.paths()).toEqual(["/leaked", "/probe"]);
    gc.release();
    gc.release();
    await next;
  });

  test("a rejection reports the host fetch's own duration, not the time spent queued", async () => {
    const { clock, gc, budget } = setup();
    const blockers = [0, 1].map((i) => budget.fetchFor(B, "snapshot")(`${B}/b${i}`, GET));
    const queued = budget.fetchFor(A, "snapshot")(`${A}/a`, GET).catch((e: unknown) => e);
    await flush();
    await clock.advance(29_000);
    gc.release(); // b0 answers: a starts now, after 29 s in the queue
    await flush();
    await clock.advance(100);
    gc.failHeld("error sending request: connection refused"); // b1
    gc.failHeld("error sending request: connection refused"); // a, after 100 ms of host time
    const e = await queued;
    expect((e as Error).message).toContain("connection refused");
    expect((e as { hostElapsedMs?: number }).hostElapsedMs).toBe(100);
    await Promise.allSettled(blockers);
  });
});

describe("dropping and forgetting", () => {
  test("dropQueued rejects only that group's queued requests as abandoned; in-flight ones and other groups are untouched", async () => {
    const { gc, budget } = setup();
    const step = {};
    const other = {};
    const running = [0, 1].map((i) => budget.fetchFor(A, "snapshot", step)(`${A}/run${i}`, GET));
    const mine = budget.fetchFor(A, "snapshot", step)(`${A}/mine`, GET).catch((e: unknown) => e);
    const theirs = budget.fetchFor(A, "snapshot", other)(`${A}/theirs`, GET);
    await flush();
    expect(budget.dropQueued(step)).toBe(1);
    const e = await mine;
    expect((e as { cancelled?: string }).cancelled).toBe("abandoned");
    expect((e as { hostElapsedMs?: number }).hostElapsedMs).toBe(0);
    expect(budget.stats()).toEqual({ inFlight: 2, queued: 1, maxInFlight: 2 });
    gc.release();
    await flush();
    expect(gc.paths()).toEqual(["/run0", "/run1", "/theirs"]);
    gc.release();
    gc.release();
    await Promise.all([...running, theirs]);
  });

  test("forgetEndpoint leaves degraded mode without starting anything; the next pump does", async () => {
    const { gc, budget } = setup();
    budget.setDegraded(A, true);
    const all = [0, 1].map((i) => budget.fetchFor(A, "snapshot")(`${A}/a${i}`, GET));
    await flush();
    expect(gc.inFlight).toBe(1);
    budget.forgetEndpoint(A);
    await flush();
    expect(gc.inFlight).toBe(1);
    budget.reclaim();
    await flush();
    expect(gc.inFlight).toBe(2);
    gc.release();
    gc.release();
    await Promise.all(all);
  });
});
