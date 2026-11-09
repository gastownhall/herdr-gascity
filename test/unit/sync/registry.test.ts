// The shared per-city store and its registry, end to end against a fake gc,
// under herdr's task-ownership rule (fakes.ts FakeHost): each copy drives its
// store from a periodic timer of its own; a fetch belongs to the copy whose
// code started it and is resumed in that copy's scope; a closed copy's
// fetches and timers never settle.

import { afterEach, describe, expect, test } from "bun:test";
import { pinSession } from "../../../src/gc/ops.ts";
import { RECLAIM_AFTER_MS } from "../../../src/sync/budget.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../../src/sync/registry.ts";
import {
  ERROR_RING, MAX_CLOSED_RECENT, MAX_SESSION_ROWS, SESSION_PAGE, STEP_STALL_MS, domainFreshness, type EventBatch,
} from "../../../src/sync/store.ts";
import { FakeGc, FakeHost, fixtureBody, flush, type Owner } from "./fakes.ts";

const API = "http://127.0.0.1:8372";
const CITY = "scratch";
const WORK = "exclude_type=session&exclude_type=message&exclude_type=molecule&exclude_type=gate";

interface Copy {
  owner: Owner;
  sub: Subscription;
  rev: number;
  renders: number;
}

let live: Copy[] = [];

function setup(opts: { onScreen?: boolean; random?: () => number; onError?: () => void } = {}) {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  const reg = new SyncRegistry({
    fetch: host.wrap(gc.fetch), clock: host, random: opts.random ?? (() => 0.5), ...(opts.onError ? { onError: opts.onError } : {}),
  });
  reg.setOnScreen(opts.onScreen ?? true);
  let n = 0;
  /** Opens a copy as main.ts will: subscribe, tick once, and tick from its own periodic timer — all in its own scope. */
  const open = async (city = CITY, api = API): Promise<Copy> => {
    const owner = `copy-${++n}`;
    let copy: Copy | null = null;
    await host.run(owner, () => {
      const made = reg.subscribe({ apiUrl: api, city });
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      const c: Copy = { owner, sub: made.value, rev: 0, renders: 0 };
      c.rev = c.sub.tick();
      host.every(TICK_MS, () => {
        const rev = c.sub.tick();
        if (rev !== c.rev) {
          c.rev = rev;
          c.renders++;
        }
      });
      copy = c;
    });
    await host.runTurns();
    if (!copy) throw new Error("open");
    live.push(copy);
    return copy;
  };
  /** herdr closes a copy: unsubscribe in its scope, then every task it owns is cancelled. */
  const close = (c: Copy) => host.close(c.owner, () => c.sub.unsubscribe());
  return { host, gc, reg, open, close };
}

afterEach(() => {
  for (const c of live) c.sub.unsubscribe();
  live = [];
});

describe("registry: one store per (API, city)", () => {
  test("two copies of one city share one store and one set of polls", async () => {
    const { host, gc, reg, open } = setup();
    const a = await open();
    const b = await open();
    expect(reg.storeCount()).toBe(1);
    expect(a.sub.snapshot()).toBe(b.sub.snapshot());
    const start = gc.seen.length;
    await host.advance(10_000);
    // on screen: one event poll per 2 s and one sessions poll per 5 s, for both copies together
    expect(gc.count("/events", start)).toBe(5);
    expect(gc.count("/sessions", start)).toBe(2);
    expect(a.renders).toBeGreaterThan(0);
    expect(b.renders).toBeGreaterThan(0);
  });

  test("different cities or endpoints get their own stores", async () => {
    const { reg, open } = setup();
    await open("scratch");
    await open("other");
    await open("scratch", "http://127.0.0.1:9443");
    expect(reg.storeCount()).toBe(3);
  });

  test("a non-loopback endpoint is refused with a typed error", () => {
    const { reg } = setup();
    const r = reg.subscribe({ apiUrl: "http://10.0.0.5:8372", city: CITY });
    expect(r).toEqual({ ok: false, error: { kind: "not-loopback", url: "http://10.0.0.5:8372" } });
    expect(reg.storeCount()).toBe(0);
  });

  test("the last close drops the store and stops its polls", async () => {
    const { host, gc, reg, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    await close(a);
    await close(b);
    expect(reg.storeCount()).toBe(0);
    const start = gc.seen.length;
    await host.advance(120_000);
    expect(gc.seen.length).toBe(start);
  });

  test("a fresh registry (a mod reload re-runs the module) starts clean", async () => {
    const first = setup();
    await first.open();
    await first.host.advance(2000);
    const second = new SyncRegistry({ fetch: first.host.wrap(first.gc.fetch), clock: first.host, random: () => 0.5 });
    const start = first.gc.seen.length;
    await first.host.run("reloaded", () => {
      const made = second.subscribe({ apiUrl: API, city: CITY });
      if (!made.ok) throw new Error("subscribe");
      made.value.tick();
      made.value.unsubscribe();
    });
    expect(first.gc.paths(start)[0]).toBe("/v0/city/scratch/events?limit=1");
  });
});

describe("closing copies (herdr cancels a closed copy's tasks)", () => {
  test("the driving copy closes between polls: the next copy's tick carries on with the same cursor", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(2000);
    const cursor = b.sub.snapshot().events.cursor;
    expect(cursor).toBe(1);
    await close(a);
    const start = gc.seen.length;
    gc.emit({ type: "session.woke", subject: "sc-20" });
    await host.advance(2600);
    expect(gc.paths(start).filter((p) => p.endsWith("/events?limit=1"))).toEqual([]);
    expect(gc.count("/sessions", start)).toBe(1);
    expect(b.sub.snapshot().events.cursor).toBe(2);
    const s2 = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/events", s2)).toBe(5);
    expect(host.starts.slice(-3).every((s) => s.owner === b.owner)).toBe(true);
  });

  test("three copies, the driver closes: the survivors keep polling (no lease wait)", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    await open();
    await host.advance(5000);
    await close(a);
    const start = gc.seen.length;
    await host.advance(10 * 60_000);
    expect(gc.count("/events", start)).toBe(300);
    expect(host.now() - (b.sub.snapshot().events.polledAt ?? 0)).toBeLessThan(2000);
  });

  test("the driver closes while its request is in flight: its slot comes back, the others keep polling", async () => {
    const { host, gc, reg, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(5000);
    gc.override = (req) => (req.path.endsWith("/events") ? { hold: true } : undefined);
    await host.advance(1000); // a's 6 s poll is held open
    expect(gc.heldCount()).toBe(1);
    await close(a);
    gc.override = null;
    gc.release(200, { items: [], total: 1 }); // gc answers; the completion belongs to closed a: it never settles
    await host.advance(10_000);
    expect(gc.count("/events")).toBeGreaterThanOrEqual(8);
    expect(b.sub.snapshot().connection).toEqual({ kind: "connected" });
    await host.advance(RECLAIM_AFTER_MS);
    expect(reg.budgetStats().inFlight).toBe(0);
  });

  test("two such closes in two cities do not starve a city opened afterwards", async () => {
    const { host, gc, reg, open, close } = setup();
    const x = await open("x");
    const y = await open("y");
    await host.advance(5000);
    gc.override = () => ({ hold: true });
    await host.advance(1000);
    expect(gc.heldCount()).toBe(2);
    await close(x);
    await close(y);
    gc.override = null;
    while (gc.heldCount() > 0) gc.release(200, { items: [], total: 1 });
    await host.advance(1000);
    const z = await open("z");
    await host.advance(RECLAIM_AFTER_MS + 5000);
    const s = z.sub.snapshot();
    expect(s.sessions.value?.items.length).toBe(3);
    expect(s.rigs.value?.items.length).toBe(1);
    expect(reg.budgetStats().inFlight).toBe(0);
  });

  test("a probe whose copy closes mid-flight does not wedge the endpoint", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(5000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(3000); // backing off
    gc.override = () => ({ hold: true }); // gc accepts but hangs
    await host.advance(10_000); // the probe goes out and hangs
    expect(gc.heldCount()).toBe(1);
    await close(a);
    while (gc.heldCount() > 0) gc.failHeld("operation timed out"); // its completion belongs to closed a
    gc.override = null; // gc is healthy again
    await host.run(b.owner, () => b.sub.retryNow());
    await host.advance(RECLAIM_AFTER_MS + 10_000);
    expect(b.sub.snapshot().connection).toEqual({ kind: "connected" });
    const start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/events", start)).toBe(5);
  });

  test("a city's queued request started in another city's scope survives that city's close", async () => {
    const { host, gc, reg, open, close } = setup();
    const x = await open("x");
    await open("y");
    const z = await open("z");
    await host.advance(5000);
    gc.override = () => ({ hold: true });
    await host.advance(1000); // x and y hold both slots; z's poll queues
    expect(reg.budgetStats()).toMatchObject({ inFlight: 2, queued: 1 });
    gc.release(200, { items: [], total: 1 }); // x's answer runs in x's scope, and the budget starts z's poll there
    await host.runTurns();
    expect(host.starts.at(-1)).toEqual({ path: "/v0/city/z/events", owner: x.owner });
    await close(x);
    gc.override = null;
    while (gc.heldCount() > 0) gc.release(200, { items: [], total: 1 });
    await host.advance(RECLAIM_AFTER_MS + 10_000);
    const start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.seen.slice(start).filter((r) => r.path === "/v0/city/z/events").length).toBe(5);
    expect(z.sub.snapshot().connection).toEqual({ kind: "connected" });
  });

  test("a copy that switches city (unsubscribes but stays open): its step's late answers are dropped", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    const b = await open();
    await host.advance(1000);
    gc.emit({ type: "session.woke", subject: "sc-20" });
    gc.override = (req) => (req.path.endsWith("/events") ? { hold: true } : undefined);
    await host.advance(1000); // a's 2 s event poll is held
    expect(gc.heldCount()).toBe(1);
    await host.run(a.owner, () => a.sub.unsubscribe()); // a stays open (another city now)
    gc.override = null;
    await host.advance(2000); // b's tick polls at 4 s: sees seq 2
    expect(b.sub.snapshot().events.cursor).toBe(2);
    gc.release(200, { items: [{ seq: 1, type: "order.fired", ts: "t", actor: "a", payload: {} }], total: 1 }); // a's stale page
    await host.runTurns();
    expect(b.sub.snapshot().events.cursor).toBe(2);
    expect(b.sub.snapshot().events.resyncs).toBe(0);

    // the same for a domain fetch
    gc.override = (req) => (req.path.endsWith("/sessions") ? { hold: true } : undefined);
    await host.advance(6000); // b's sessions poll at 10 s is held
    expect(gc.heldCount()).toBe(1);
    const c = await open();
    await host.run(b.owner, () => b.sub.unsubscribe());
    gc.override = null;
    await host.advance(5000); // c refetches sessions
    gc.release(200, { items: [], total: 0 }); // b's stale answer: an empty list
    await host.runTurns();
    expect(c.sub.snapshot().sessions.value?.items.length).toBe(3);
  });

  test("a step stalled behind requests that never settle is abandoned and recorded", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ hold: true });
    // ten mutations hold both slots in turn, ahead of a's reads, for longer than the stall limit
    for (let i = 0; i < 10; i++) void pinSession(a.sub.client(), CITY, `s-${i}`);
    await host.advance(STEP_STALL_MS + 5000);
    expect(a.sub.snapshot().errors.some((e) => e.source === "step" && e.error.kind === "step-stalled")).toBe(true);
    gc.override = null;
  });
});

describe("first poll refused (a city not running yet, a read grant, an older gc)", () => {
  test("no spin: the cursor read is retried at the sweep cadence, and the city loads once it answers", async () => {
    const { host, gc, open } = setup();
    let up = false;
    gc.override = () => (up ? undefined : { status: 404, body: fixtureBody("get-v0-city-by-city-name-sessions", "city-not-running") });
    const a = await open();
    await host.advance(5 * 60_000);
    const times = gc.seen.map((r) => r.at);
    expect(times.length).toBe(6);
    expect(times.slice(1).every((t, i) => t - (times[i] ?? 0) === 60_000)).toBe(true);
    expect(a.sub.snapshot().events.error).toMatchObject({ kind: "city-not-running" });
    up = true;
    await host.advance(60_000);
    const s = a.sub.snapshot();
    expect(s.events.cursor).toBe(1);
    expect(s.sessions.value?.items.length).toBe(3);
    expect(s.events.error).toBeNull();
  });
});

describe("initial load", () => {
  test("takes the cursor first, then loads every domain", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    const paths = gc.paths();
    expect(paths[0]).toBe("/v0/city/scratch/events?limit=1");
    expect(new Set(paths.slice(1))).toEqual(new Set([
      "/v0/city/scratch/rigs",
      "/v0/city/scratch/agents",
      "/v0/city/scratch/sessions?limit=500",
      "/v0/city/scratch/pending",
      `/v0/city/scratch/work/ready?${WORK}&limit=50`,
      `/v0/city/scratch/work/ready?${WORK}&limit=50&status=in_progress`,
      `/v0/city/scratch/work/ready?${WORK}&limit=20&sort=newest&status=closed`,
    ]));
    const s = a.sub.snapshot();
    expect(s.connection).toEqual({ kind: "connected" });
    expect(s.events.cursor).toBe(1);
    expect(s.sessions.value?.items.map((x) => x.id)).toEqual(["sc-20", "sc-6", "sc-5"]);
    expect(s.rigs.value?.items.map((r) => r.name)).toEqual(["frontend"]);
    expect(s.ready.value?.items.length).toBe(4);
    expect(s.closed.seed.value?.items.length).toBe(20);
    for (const d of ["rigs", "agents", "sessions", "pending", "ready", "inProgress"] as const) {
      expect(s[d].error).toBeNull();
      expect(s[d].fetchedAt).toBe(host.now());
      expect(domainFreshness(s, d, host.now()).kind).toBe("fresh");
    }
  });

  test("the cursor is the newest seq shown, not total (gc reads total after the page)", async () => {
    const { gc, open } = setup();
    gc.total = 7; // an event appended while gc was answering
    const a = await open();
    expect(a.sub.snapshot().events.cursor).toBe(1);
  });

  test("the closed seed is fetched once per store, not on sweeps", async () => {
    const { host, gc, open } = setup();
    await open();
    await host.advance(130_000);
    expect(gc.paths().filter((p) => p.includes("status=closed")).length).toBe(1);
  });

  test("sessions follow next_cursor in pages of 500 up to 2000 rows, then say so", async () => {
    const { gc, open } = setup();
    const base = (fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: Record<string, unknown>[] }).items[0];
    gc.override = (req) => {
      if (!req.path.endsWith("/sessions")) return undefined;
      const page = Number(req.query.get("cursor") ?? "0");
      const items = Array.from({ length: SESSION_PAGE }, (_, i) => ({ ...base, id: `s-${page * SESSION_PAGE + i}` }));
      return { status: 200, body: { items, total: 2600, next_cursor: String(page + 1) } };
    };
    const a = await open();
    const sessions = a.sub.snapshot().sessions.value;
    expect(gc.paths().filter((p) => p.includes("/sessions"))).toEqual([
      "/v0/city/scratch/sessions?limit=500",
      "/v0/city/scratch/sessions?limit=500&cursor=1",
      "/v0/city/scratch/sessions?limit=500&cursor=2",
      "/v0/city/scratch/sessions?limit=500&cursor=3",
    ]);
    expect(sessions?.items.length).toBe(MAX_SESSION_ROWS);
    expect(sessions?.total).toBe(2600);
    expect(sessions?.truncated).toBe(true);
  });
});

describe("event watcher → targeted refetches", () => {
  test("session events refetch sessions and agents after the 300 ms debounce, nothing else", async () => {
    const { host, gc, open } = setup();
    await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit({ type: "session.woke", subject: "sc-20" });
    await host.advance(1000); // the 2 s event poll
    expect(gc.paths(start)).toEqual(["/v0/city/scratch/events?limit=50"]);
    await host.advance(250);
    expect(gc.paths(start).length).toBe(1); // still debouncing
    await host.advance(250);
    expect(new Set(gc.paths(start).slice(1))).toEqual(new Set(["/v0/city/scratch/sessions?limit=500", "/v0/city/scratch/agents"]));
  });

  test("gc's page/total race: the raced event is delivered by the next poll, without a resync", async () => {
    const { host, gc, reg, open } = setup();
    const batches: EventBatch[] = [];
    reg.onEvents((b) => batches.push(b));
    const a = await open();
    await host.advance(1000);
    gc.emit({ type: "session.woke", subject: "sc-20" });
    gc.total = 3; // seq 3 is appended between gc's page read and its total
    await host.advance(1000);
    gc.total = null;
    gc.events.push({ seq: 3, type: "session.pending", subject: "sc-20" });
    await host.advance(2000);
    expect(batches.map((b) => b.events.map((e) => `${e.seq}:${e.type}`))).toEqual([["2:session.woke"], ["3:session.pending"]]);
    expect(a.sub.snapshot().events.resyncs).toBe(0);
  });

  test("bursts coalesce: many events in one window, one refetch per domain", async () => {
    const { host, gc, open } = setup();
    await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit({ type: "session.woke", subject: "sc-20" }, { type: "session.stopped", subject: "sc-6" }, { type: "worker.operation", subject: "sc-5" });
    await host.advance(1500);
    expect(gc.count("/sessions", start)).toBe(1);
    expect(gc.count("/agents", start)).toBe(1);
  });

  test("bead.updated refetches both board columns, once per debounce window", async () => {
    const { host, gc, open } = setup();
    await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit({ type: "bead.updated", subject: "sc-74" }, { type: "bead.updated", subject: "zz-1" }, { type: "bead.deleted", subject: "fe-1" });
    await host.advance(1500);
    expect(gc.paths(start).slice(1).sort()).toEqual([
      `/v0/city/scratch/work/ready?${WORK}&limit=50`,
      `/v0/city/scratch/work/ready?${WORK}&limit=50&status=in_progress`,
    ]);
  });

  test("a board column refetched after a gap is the newest word on its beads (no stale per-bead copies)", async () => {
    const { host, gc, open } = setup();
    const ready = fixtureBody("get-v0-city-by-city-name-work-ready", "ready") as { items: { id: string; title: string }[] };
    const id = ready.items[0]?.id ?? "";
    let version = "v1";
    gc.override = (req) =>
      req.path.endsWith("/work/ready") && !req.query.get("status")
        ? { status: 200, body: { items: ready.items.map((b, i) => (i === 0 ? { ...b, title: `title ${version}` } : b)) } }
        : undefined;
    const a = await open();
    await host.advance(1000);
    version = "v2";
    gc.emit({ type: "bead.updated", subject: id }, ...Array.from({ length: 60 }, () => ({ type: "order.fired" })));
    await host.advance(2000);
    const s = a.sub.snapshot();
    expect(s.events.resyncs).toBe(1);
    expect(s.ready.value?.items.find((b) => b.id === id)?.title).toBe("title v2");
    expect(s.ready.dirty).toBe(false);
    expect(domainFreshness(s, "ready", host.now()).kind).toBe("fresh");
  });

  test("bead.closed adds the bead to the closed list by event seq and refetches the columns", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit({ type: "bead.closed", subject: "fe-1" }, { type: "bead.closed", subject: "sc-74" });
    await host.advance(1500);
    expect(gc.count("/bead/fe-1", start)).toBe(1);
    expect(gc.count("/bead/sc-74", start)).toBe(1);
    expect(gc.count("/work/ready", start)).toBe(2);
    const closed = a.sub.snapshot().closed;
    expect(closed.recent.map((c) => [c.bead.id, c.seq])).toEqual([["sc-74", 3], ["fe-1", 2]]);
    expect(closed.incomplete).toBe(false);
  });

  test("more than 10 closes in one step: the extras are dropped and the list is marked incomplete", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit(...Array.from({ length: 12 }, (_, i) => ({ type: "bead.closed", subject: `b-${i}` })));
    await host.advance(1500);
    expect(gc.count("", start) - 3).toBe(10); // minus the event poll and the two column refetches
    const closed = a.sub.snapshot().closed;
    expect(closed.recent.length).toBe(10);
    expect(closed.recent[0]?.bead.id).toBe("b-11");
    expect(closed.incomplete).toBe(true);
  });

  test("the closed list keeps the newest 20", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    for (let round = 0; round < 3; round++) {
      gc.emit(...Array.from({ length: 10 }, (_, i) => ({ type: "bead.closed", subject: `r${round}-${i}` })));
      await host.advance(2000);
    }
    await host.advance(500);
    const recent = a.sub.snapshot().closed.recent;
    expect(recent.length).toBe(MAX_CLOSED_RECENT);
    expect(recent[0]?.bead.id).toBe("r2-9");
  });

  test("a gap (more new events than one page) resyncs every domain", async () => {
    const { host, gc, open } = setup();
    await open();
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit(...Array.from({ length: 60 }, () => ({ type: "order.fired" })));
    await host.advance(1500);
    for (const p of ["/rigs", "/agents", "/sessions", "/pending"]) expect(gc.count(p, start)).toBe(1);
    expect(gc.count("/work/ready", start)).toBe(2); // ready + in progress, not the closed seed
  });

  test("gc's event log reset (total below the cursor) resyncs and re-bases the cursor", async () => {
    const { host, gc, open } = setup();
    gc.emit(...Array.from({ length: 9 }, () => ({ type: "order.fired" })));
    const a = await open();
    await host.advance(1000);
    expect(a.sub.snapshot().events.cursor).toBe(10);
    gc.events = [{ seq: 1, type: "controller.started" }];
    const start = gc.seen.length;
    await host.advance(1500);
    expect(a.sub.snapshot().events.cursor).toBe(1);
    expect(a.sub.snapshot().events.resyncs).toBe(1);
    expect(gc.count("/rigs", start)).toBe(1);
  });

  test("new events reach app-wide listeners once per batch, however many copies", async () => {
    const { host, gc, reg, open } = setup();
    const batches: EventBatch[] = [];
    const off = reg.onEvents((b) => batches.push(b));
    await open();
    await open();
    await open();
    await host.advance(1000);
    gc.emit({ type: "session.pending", subject: "sc-20" }, { type: "city.suspended" });
    await host.advance(1000);
    expect(batches.length).toBe(1);
    expect(batches[0]?.key).toEqual({ apiUrl: API, city: CITY });
    expect(batches[0]?.events.map((e) => e.type)).toEqual(["session.pending", "city.suspended"]);
    expect(batches[0]?.citiesChanged).toBe(true);
    expect(batches[0]?.resync).toBeNull();
    off();
    gc.emit({ type: "session.pending", subject: "sc-6" });
    await host.advance(2000);
    expect(batches.length).toBe(1);
  });

  test("a throwing listener or onError hook is recorded, not swallowed, and does not stop the watcher", async () => {
    const { host, gc, reg, open } = setup({ onError: () => { throw new Error("log failed"); } });
    reg.onEvents(() => {
      throw new Error("toast failed");
    });
    const a = await open();
    await host.advance(1000);
    gc.emit({ type: "session.pending", subject: "sc-20" });
    await host.advance(1500);
    const s = a.sub.snapshot();
    expect(s.errors.map((e) => [e.source, e.error.kind])).toEqual([["listener", "listener-failed"], ["onError", "listener-failed"]]);
    expect(gc.count("/pending")).toBe(2);
  });

  test("a step that crashes is recorded and the next tick runs a fresh one", async () => {
    let calls = 0;
    const { host, gc, open } = setup({ random: () => { if (calls++ === 0) throw new Error("jitter broke"); return 0.5; } });
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(1000);
    expect(a.sub.snapshot().errors.some((e) => e.source === "step" && e.error.kind === "step-crashed")).toBe(true);
    gc.override = null;
    const start = gc.seen.length;
    await host.advance(4000);
    expect(gc.count("/events", start)).toBeGreaterThanOrEqual(2);
  });
});

describe("visibility", () => {
  test("hidden: events every 10 s, sessions + pending every 30 s, sweep every 60 s", async () => {
    const { host, gc, open } = setup({ onScreen: false });
    await open();
    const start = gc.seen.length;
    await host.advance(60_000);
    expect(gc.count("/events", start)).toBe(6);
    expect(gc.count("/sessions", start)).toBe(2);
    expect(gc.count("/pending", start)).toBe(2);
    expect(gc.count("/rigs", start)).toBe(1);
  });

  test("becoming visible polls at the next tick and switches to the on-screen cadence", async () => {
    const { host, gc, reg, open } = setup({ onScreen: false });
    await open();
    await host.advance(4000);
    const start = gc.seen.length;
    reg.setOnScreen(true);
    await host.advance(TICK_MS);
    expect(gc.paths(start)).toEqual(["/v0/city/scratch/events?limit=50"]);
    await host.advance(10_000);
    expect(gc.count("/events", start)).toBe(6);
  });

  test("the detail peek polls every 2 s on screen, pauses hidden, stops when released", async () => {
    const { host, gc, reg, open } = setup();
    const a = await open();
    const release = a.sub.watchPeek("sc-20");
    await host.advance(TICK_MS);
    expect(gc.paths().at(-1)).toBe("/v0/city/scratch/session/sc-20?peek=true&peek_lines=40");
    expect(a.sub.snapshot().peeks.get("sc-20")?.value?.id).toBe("sc-20");
    let start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/session/sc-20", start)).toBe(5);
    reg.setOnScreen(false);
    start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/session/sc-20", start)).toBe(0);
    reg.setOnScreen(true);
    release();
    start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/session/sc-20", start)).toBe(0);
    expect(a.sub.snapshot().peeks.has("sc-20")).toBe(false);
  });

  test("a peek watched by two copies is released only when both release it", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    const ra = a.sub.watchPeek("sc-20");
    b.sub.watchPeek("sc-20");
    ra();
    await host.advance(TICK_MS);
    const start = gc.seen.length;
    await host.advance(4000);
    expect(gc.count("/session/sc-20", start)).toBe(2);
    await close(b); // closing releases that copy's peeks
    const s2 = gc.seen.length;
    await host.advance(4000);
    expect(gc.count("/session/sc-20", s2)).toBe(0);
  });
});

describe("fetch budget across copies and cities", () => {
  test("never more than 2 requests in flight, with many copies of many cities", async () => {
    const { host, gc, reg, open } = setup();
    for (const city of ["a", "b", "c", "d"]) for (let i = 0; i < 3; i++) await open(city);
    gc.override = () => ({ hold: true });
    await host.advance(2000);
    for (let i = 0; i < 400 && gc.heldCount() > 0; i++) {
      expect(gc.inFlight).toBeLessThanOrEqual(2);
      gc.release(200, { items: [], total: 0 });
      await flush();
      await host.advance(TICK_MS);
    }
    expect(gc.maxInFlight).toBe(2);
    expect(reg.budgetStats().maxInFlight).toBe(2);
    expect(reg.storeCount()).toBe(4);
  });
});

describe("backoff", () => {
  test("gc down: only the probe runs, at 1 s, 1.5 s, 2.5 s, … (jitter 0.5), capped at 60 s; typed connection state", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    const start = gc.seen.length;
    await host.advance(500_000);
    const s = a.sub.snapshot();
    expect(s.connection.kind).toBe("backing-off");
    if (s.connection.kind === "backing-off") {
      expect(s.connection.cause.kind).toBe("unreachable");
      expect(s.connection.retryAt).toBeGreaterThan(host.now());
    }
    const times = gc.seen.slice(start).map((r) => r.at);
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps.slice(0, 8)).toEqual([1000, 1500, 2500, 4500, 8500, 16500, 30500, 30500]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000);
    expect(gc.paths(start).every((p) => p.endsWith("/events?limit=50"))).toBe(true);
    expect(gc.maxInFlight).toBe(1);
    expect(domainFreshness(s, "sessions", host.now())).toMatchObject({ kind: "stale", reason: "overdue" });
  });

  test("recovery resets the backoff, reports connected, and resyncs every domain", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(20_000);
    gc.override = null;
    const start = gc.seen.length;
    await host.advance(40_000);
    expect(a.sub.snapshot().connection).toEqual({ kind: "connected" });
    for (const p of ["/rigs", "/agents", "/sessions", "/pending"]) expect(gc.count(p, start)).toBeGreaterThanOrEqual(1);
    const s2 = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/events", s2)).toBe(5);
  });

  test("retry now probes at the next tick", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(30_000);
    gc.override = null;
    const start = gc.seen.length;
    a.sub.retryNow();
    await host.advance(TICK_MS);
    expect(gc.paths(start)[0]).toBe("/v0/city/scratch/events?limit=50");
    expect(a.sub.snapshot().connection).toEqual({ kind: "connected" });
  });

  test("a read answered from off the loopback origin (a redirect) is an error in state and backs the endpoint off", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = (req) => ({ status: 200, body: { items: [], total: 1 }, finalUrl: `http://10.0.0.5:8372${req.path}` });
    await host.advance(1000);
    const s = a.sub.snapshot();
    expect(s.events.error).toEqual({ kind: "not-loopback", url: "http://10.0.0.5:8372/v0/city/scratch/events" });
    expect(s.connection).toMatchObject({ kind: "backing-off", cause: { kind: "not-loopback" } });
    expect(s.errors.at(-1)?.error.kind).toBe("not-loopback");
    const start = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("", start)).toBeLessThanOrEqual(4);
  });

  test("a 5xx on a read backs off", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = (req) => (req.path.endsWith("/events") ? { status: 503, body: { title: "Unavailable", status: 503, detail: "busy" } } : undefined);
    await host.advance(1000);
    expect(a.sub.snapshot().connection.kind).toBe("backing-off");
    expect(a.sub.snapshot().events.error).toMatchObject({ kind: "http", status: 503 });
  });

  test("the closed seed's outcome counts for the endpoint", async () => {
    const { gc, open } = setup();
    gc.override = (req) => (req.query.get("status") === "closed" ? { reject: "error sending request: connection refused" } : undefined);
    const a = await open();
    expect(a.sub.snapshot().connection.kind).toBe("backing-off");
    expect(a.sub.snapshot().closed.seed.error).toMatchObject({ kind: "unreachable" });
  });

  test("4xx on a read is shown and held: not retried on the 5 s tick, only at the sweep or on retry now", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    let fail = true;
    gc.override = (req) =>
      fail && req.path.endsWith("/sessions") ? { status: 404, body: fixtureBody("get-v0-city-by-city-name-sessions", "city-not-running") } : undefined;
    await host.advance(4000); // the sessions poll at 5 s fails
    expect(a.sub.snapshot().sessions.error).toMatchObject({ kind: "city-not-running" });
    expect(a.sub.snapshot().sessions.held).toBe(true);
    expect(a.sub.snapshot().sessions.value?.items.length).toBe(3); // last good data kept
    expect(a.sub.snapshot().connection).toEqual({ kind: "connected" });
    let start = gc.seen.length;
    gc.emit({ type: "session.woke", subject: "sc-20" });
    await host.advance(30_000);
    expect(gc.count("/sessions", start)).toBe(0);
    fail = false;
    a.sub.retryNow();
    start = gc.seen.length;
    await host.advance(TICK_MS);
    expect(gc.count("/sessions", start)).toBe(1);
    expect(a.sub.snapshot().sessions.error).toBeNull();
    expect(a.sub.snapshot().sessions.held).toBe(false);
  });

  test("a held domain comes back at the sweep", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    let fail = true;
    gc.override = (req) => (fail && req.path.endsWith("/rigs") ? { status: 404, body: fixtureBody("get-v0-city-by-city-name-sessions", "city-not-running") } : undefined);
    gc.emit({ type: "city.resumed" });
    await host.advance(1500);
    expect(a.sub.snapshot().rigs.held).toBe(true);
    fail = false;
    const start = gc.seen.length;
    await host.advance(60_000);
    expect(gc.count("/rigs", start)).toBe(1);
    expect(a.sub.snapshot().rigs.held).toBe(false);
  });

  test("every failure lands in the bounded diagnostics ring", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(3_600_000);
    const errors = a.sub.snapshot().errors;
    expect(errors.length).toBe(ERROR_RING);
    expect(errors.every((e) => e.source === "events" && e.error.kind === "unreachable")).toBe(true);
  });

  test("an unreadable event that may be new is a gap; decoded events still reach listeners", async () => {
    const { host, gc, reg, open } = setup();
    const batches: EventBatch[] = [];
    reg.onEvents((b) => batches.push(b));
    await open();
    await host.advance(1000);
    gc.override = (req) =>
      req.path.endsWith("/events") && req.query.get("limit") === "50"
        ? { status: 200, body: { items: [{ seq: 3, type: "session.woke", ts: "t", actor: "a", payload: {} }, { seq: "two" }], total: 3 } }
        : undefined;
    const start = gc.seen.length;
    await host.advance(1500);
    expect(batches.at(-1)?.resync).toBe("gap");
    expect(batches.at(-1)?.events.map((e) => e.seq)).toEqual([3]);
    expect(gc.count("/rigs", start)).toBe(1);
  });
});

describe("render notifications", () => {
  test("tick() returns the snapshot rev, which changes when data does", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    const r0 = a.sub.snapshot().rev;
    gc.emit({ type: "session.woke", subject: "sc-20" });
    await host.advance(2500);
    expect(a.sub.tick()).toBeGreaterThan(r0);
    expect(a.renders).toBeGreaterThan(0);
  });
});

describe("for actions (mutations come later; their plumbing is here)", () => {
  test("the subscription's client sends at mutation priority, ahead of queued event polls", async () => {
    const { host, gc, open } = setup();
    gc.override = () => ({ hold: true });
    const a = await open("a");
    await open("b");
    await open("c"); // c's cursor poll (events priority) queues behind a and b
    expect(gc.paths()).toEqual(["/v0/city/a/events?limit=1", "/v0/city/b/events?limit=1"]);
    let pinned: ReturnType<typeof pinSession> | null = null;
    await host.run(a.owner, () => {
      pinned = pinSession(a.sub.client(), "a", "sc-20");
    });
    gc.release(200, { items: [], total: 0 }); // a's cursor: one slot frees
    await host.runTurns();
    expect(gc.paths().at(-1)).toBe("/v0/city/a/session/sc-20/pin");
    expect(gc.seen.at(-1)?.init.headers["X-GC-Request"]).toStartWith("herdr-gascity/");
    gc.override = null;
    gc.release(200, { items: [], total: 0 }); // b's cursor
    gc.release(200, fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok"));
    await host.runTurns();
    expect(pinned).not.toBeNull();
    expect((await (pinned as unknown as ReturnType<typeof pinSession>)).ok).toBe(true);
  });

  test("a mutation whose outcome is unknown is never retried and does not count as gc answering", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    gc.override = (req) => (req.path.endsWith("/pin") ? { reject: "error sending request: connection reset" } : undefined);
    const call = pinSession(a.sub.client(), "scratch", "sc-20");
    await host.runTurns();
    const r = await call;
    expect(r).toMatchObject({ ok: false, error: { kind: "outcome-unknown", cause: "unreachable" } });
    gc.override = (req) =>
      req.path.endsWith("/pin") ? { status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok"), finalUrl: "http://10.0.0.5:8372/x" } : undefined;
    const again = pinSession(a.sub.client(), "scratch", "sc-20");
    await host.runTurns();
    const redirected = await again;
    expect(redirected).toMatchObject({ ok: false, error: { kind: "outcome-unknown", cause: "redirected" } });
    await host.advance(120_000);
    expect(gc.count("/pin")).toBe(2);
    expect(a.sub.snapshot().connection).toEqual({ kind: "connected" });
  });

  test("a mutation whose copy closed mid-flight becomes outcome-unknown once its slot is reclaimed", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(1000);
    gc.override = (req) => (req.path.endsWith("/pin") ? { hold: true } : undefined);
    let pinned: Promise<unknown> | null = null;
    await host.run(a.owner, () => {
      pinned = pinSession(a.sub.client(), "scratch", "sc-20");
    });
    await close(a);
    gc.override = null;
    gc.release(200, fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok")); // owned by closed a: never settles
    await host.advance(RECLAIM_AFTER_MS + TICK_MS);
    // cancelled with its copy, not a gc timeout: it may have been applied, and nothing backs off for it
    expect(await (pinned as unknown as Promise<unknown>)).toMatchObject({ ok: false, error: { kind: "outcome-unknown", cause: "cancelled" } });
    expect(gc.count("/pin")).toBe(1);
    expect(b.sub.snapshot().connection).toEqual({ kind: "connected" });
  });

  test("refresh(domains) refetches those domains at the next tick", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    const start = gc.seen.length;
    a.sub.refresh(["sessions", "ready"]);
    await host.advance(TICK_MS);
    expect(gc.paths(start).sort()).toEqual([
      "/v0/city/scratch/sessions?limit=500",
      `/v0/city/scratch/work/ready?${WORK}&limit=50`,
    ]);
  });
});
