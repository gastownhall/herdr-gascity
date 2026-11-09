// What the agents panel needs from the sync engine, under herdr's ownership
// rule (fakes.ts FakeHost): an open detail's wake reasons and pending prompt
// on demand, active-bead titles the board does not carry, the shared city
// list poll, discovery probes through the shared fetch budget, and requests
// that a closed copy took with it, which are cancellations, not gc timeouts.

import { afterEach, describe, expect, test } from "bun:test";
import { resolveEndpoint } from "../../../src/discovery/resolve.ts";
import { pinSession } from "../../../src/gc/ops.ts";
import { RECLAIM_AFTER_MS } from "../../../src/sync/budget.ts";
import { CITIES_FAST_MS, CITIES_SLOW_MS } from "../../../src/sync/cities.ts";
import { SyncRegistry, TICK_MS, type CitiesSubscription, type Subscription } from "../../../src/sync/registry.ts";
import { ok } from "../../../src/result.ts";
import { FakeGc, FakeHost, fixtureBody, type Owner } from "./fakes.ts";

const API = "http://127.0.0.1:8372";
const CITY = "scratch";
const HEALTH = { status: "ok", version: "1.2.3", uptime_sec: 5, cities_total: 1, cities_running: 1 };

interface Copy {
  owner: Owner;
  sub: Subscription;
}

let live: Copy[] = [];
let liveCities: CitiesSubscription[] = [];

function setup() {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  const reg = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5 });
  reg.setOnScreen(true);
  let n = 0;
  const open = async (city = CITY): Promise<Copy> => {
    const owner = `copy-${++n}`;
    let copy: Copy | null = null;
    await host.run(owner, () => {
      const made = reg.subscribe({ apiUrl: API, city });
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      const c: Copy = { owner, sub: made.value };
      c.sub.tick();
      host.every(TICK_MS, () => c.sub.tick());
      copy = c;
    });
    await host.runTurns();
    if (!copy) throw new Error("open");
    live.push(copy);
    return copy;
  };
  const close = (c: Copy) => host.close(c.owner, () => c.sub.unsubscribe());
  return { host, gc, reg, open, close };
}

afterEach(() => {
  for (const c of live) c.sub.unsubscribe();
  for (const c of liveCities) c.unsubscribe();
  live = [];
  liveCities = [];
});

describe("an open detail", () => {
  test("asks for the session's wake reasons once (they cost gc a runtime probe per session), and again only on refresh", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(1000);
    const start = gc.seen.length;
    a.sub.watchPeek("sc-20");
    await host.advance(20_000);
    const wake = gc.paths(start).filter((p) => p.includes("wake_reasons=true"));
    expect(wake).toEqual(["/v0/city/scratch/sessions?limit=500&template=worker&wake_reasons=true"]);
    expect(a.sub.snapshot().details.get("sc-20")?.wakeReasons.value).toEqual({ listed: true, reasons: ["session", "config"] });
    a.sub.refreshDetail("sc-20");
    await host.advance(1000);
    expect(gc.paths(start).filter((p) => p.includes("wake_reasons=true")).length).toBe(2);
  });

  test("a session gc does not list under its template has no wake reasons, said so instead of guessed", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.query.get("wake_reasons") === "true" ? { status: 200, body: { items: [], total: 0 } } : undefined);
    const a = await open();
    await host.advance(1000);
    a.sub.watchPeek("sc-5");
    await host.advance(2000);
    expect(a.sub.snapshot().details.get("sc-5")?.wakeReasons.value).toEqual({ listed: false, reasons: [] });
  });

  test("fetches the session's pending prompt on open and when the city's pending list changes for it", async () => {
    const { host, gc, open } = setup();
    let pending: unknown[] = [];
    gc.override = (req) => {
      if (req.path === "/v0/city/scratch/pending") return { status: 200, body: { items: pending, total: pending.length } };
      if (req.path === "/v0/city/scratch/session/sc-20/pending") {
        return pending.length === 0
          ? { status: 200, body: { supported: true } }
          : { status: 200, body: { supported: true, pending: { request_id: "r-1", kind: "permission", prompt: "Run rm?", options: ["approve", "deny"] } } };
      }
      return undefined;
    };
    const a = await open();
    await host.advance(1000);
    const start = gc.seen.length;
    a.sub.watchPeek("sc-20");
    await host.advance(1000);
    expect(gc.count("/session/sc-20/pending", start)).toBe(1);
    expect(a.sub.snapshot().details.get("sc-20")?.pending.value).toEqual({ supported: true });
    await host.advance(10_000);
    expect(gc.count("/session/sc-20/pending", start)).toBe(1);
    pending = [{ session_id: "sc-20", request_id: "r-1", kind: "permission" }];
    gc.emit({ type: "session.pending", subject: "sc-20" });
    await host.advance(3000);
    expect(gc.count("/session/sc-20/pending", start)).toBe(2);
    expect(a.sub.snapshot().details.get("sc-20")?.pending.value?.pending?.options).toEqual(["approve", "deny"]);
  });

  test("releasing the last watch drops the detail", async () => {
    const { host, open } = setup();
    const a = await open();
    await host.advance(1000);
    const release = a.sub.watchPeek("sc-20");
    await host.advance(2000);
    release();
    expect(a.sub.snapshot().details.has("sc-20")).toBe(false);
  });
});

describe("active beads", () => {
  const withActive = () => {
    const body = fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: Record<string, unknown>[] };
    return { ...body, items: body.items.map((s, i) => (i === 0 ? { ...s, active_bead: "fe-99" } : i === 1 ? { ...s, active_bead: "sc-18" } : s)) };
  };

  test("a session's active bead that is not on the board is fetched by id, once; one on the board is not", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/v0/city/scratch/sessions" ? { status: 200, body: withActive() } : undefined);
    const a = await open();
    await host.advance(20_000);
    expect(gc.count("/bead/fe-99")).toBe(1);
    expect(gc.count("/bead/sc-18")).toBe(0);
    expect(a.sub.snapshot().beads.get("fe-99")?.value?.id).toBe("fe-99");
  });

  test("an event about that bead refetches it; a bead no session works on any more is forgotten", async () => {
    const { host, gc, open } = setup();
    let sessions: unknown = withActive();
    gc.override = (req) => (req.path === "/v0/city/scratch/sessions" ? { status: 200, body: sessions } : undefined);
    const a = await open();
    await host.advance(3000);
    gc.emit({ type: "bead.updated", subject: "fe-99" });
    await host.advance(3000);
    expect(gc.count("/bead/fe-99")).toBe(2);
    sessions = fixtureBody("get-v0-city-by-city-name-sessions", "ok");
    await host.advance(6000);
    expect(a.sub.snapshot().beads.has("fe-99")).toBe(false);
  });
});

describe("active beads off the board are refetched on events, not on every sweep", () => {
  const withActive = (ids: string[]) => {
    const body = fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: Record<string, unknown>[] };
    return { ...body, items: body.items.map((s, i) => (i < ids.length ? { ...s, active_bead: ids[i] } : s)) };
  };

  test("sweeps do not refetch them: three sweeps later each was fetched once", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/v0/city/scratch/sessions" ? { status: 200, body: withActive(["fe-97", "fe-98", "fe-99"]) } : undefined);
    await open();
    await host.advance(3000);
    await host.advance(3 * 60_000);
    for (const id of ["fe-97", "fe-98", "fe-99"]) expect(gc.count(`/bead/${id}`)).toBe(1);
    // the sweep did run
    expect(gc.count("/rigs")).toBeGreaterThanOrEqual(4);
  });

  test("an event gap refetches them (an event about one may have been missed), as does gc coming back and retry now", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/v0/city/scratch/sessions" ? { status: 200, body: withActive(["fe-99"]) } : undefined);
    const a = await open();
    await host.advance(3000);
    gc.emit(...Array.from({ length: 60 }, () => ({ type: "order.fired" })));
    await host.advance(3000);
    expect(gc.count("/bead/fe-99")).toBe(2);
    const sessionsOnly = gc.override;
    gc.override = (req) => (req.path.endsWith("/events") ? { reject: "error sending request: connection refused" } : sessionsOnly?.(req));
    await host.advance(3000);
    gc.override = sessionsOnly;
    await host.advance(70_000);
    expect(a.sub.snapshot().connection).toEqual({ kind: "connected" });
    expect(gc.count("/bead/fe-99")).toBe(3);
    a.sub.retryNow();
    await host.advance(1000);
    expect(gc.count("/bead/fe-99")).toBe(4);
  });

  test("a bead the person has open is still checked at the sweep", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(3000);
    a.sub.watchBead("fe-50");
    await host.advance(1000);
    expect(gc.count("/bead/fe-50")).toBe(1);
    await host.advance(60_000);
    expect(gc.count("/bead/fe-50")).toBe(2);
  });
});

describe("a selected bead", () => {
  test("is fetched by id even when the board shows it (the board has no description), once, and again on an event about it", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(3000);
    const start = gc.seen.length;
    a.sub.watchBead("sc-74");
    await host.advance(3000);
    expect(gc.count("/bead/sc-74", start)).toBe(1);
    expect(a.sub.snapshot().beads.get("sc-74")?.value?.description).toBe("recorded for the herdr-gascity contract fixtures");
    await host.advance(10_000);
    expect(gc.count("/bead/sc-74", start)).toBe(1);
    // the bead's event carries it (the closed seed lists it, so without one the closed list would refetch it too)
    gc.emit({ type: "bead.updated", subject: "sc-74", payload: { bead: { id: "sc-74", title: "t", status: "open", issue_type: "task", labels: [], created_at: "t" } } });
    await host.advance(3000);
    expect(gc.count("/bead/sc-74", start)).toBe(2);
  });

  test("two copies watching one bead fetch it once; the last release forgets it, and an unsubscribe releases", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    const ra = a.sub.watchBead("fe-1");
    b.sub.watchBead("fe-1");
    await host.advance(3000);
    expect(gc.count("/bead/fe-1")).toBe(1);
    ra();
    ra();
    expect(a.sub.snapshot().beads.has("fe-1")).toBe(true);
    b.sub.unsubscribe();
    expect(a.sub.snapshot().beads.has("fe-1")).toBe(false);
  });

  test("closing the copy that watched it while its fetch hangs starts nothing; the surviving copy fetches it again", async () => {
    const { host, gc, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    b.sub.watchBead("fe-1");
    let hold = true;
    gc.override = (req) => (req.path === "/v0/city/scratch/bead/fe-1" && hold ? { hold: true } : undefined);
    await host.run(a.owner, () => a.sub.watchBead("fe-1"));
    await host.advance(TICK_MS);
    expect(gc.count("/bead/fe-1")).toBe(1);
    const starts = host.starts.length;
    await close(a);
    expect(host.starts.slice(starts)).toEqual([]);
    hold = false;
    await host.advance(RECLAIM_AFTER_MS * 5);
    expect(b.sub.snapshot().beads.get("fe-1")?.value?.id).toBe("fe-1");
  });
});

describe("requests a closed copy took with it", () => {
  test("a step abandoned at close drops its queued request: it is never sent, and the close starts nothing", async () => {
    const { host, gc, open, close } = setup();
    gc.override = () => ({ hold: true });
    await open("x");
    await open("y");
    const c = await open("z");
    expect(gc.paths()).toEqual(["/v0/city/x/events?limit=1", "/v0/city/y/events?limit=1"]);
    const starts = host.starts.length;
    await close(c);
    expect(host.starts.slice(starts)).toEqual([]);
    gc.release(200, { items: [], total: 0 });
    await host.runTurns();
    expect(gc.paths().some((p) => p.startsWith("/v0/city/z/"))).toBe(false);
  });

  test("the last close on a backing-off endpoint leaves degraded mode without starting a queued request in the closing copy", async () => {
    const { host, gc, open, close } = setup();
    let down = true;
    gc.override = () => (down ? { reject: "error sending request: connection refused" } : { hold: true });
    const a = await open();
    expect(a.sub.snapshot().connection.kind).toBe("backing-off");
    down = false;
    await host.advance(2000); // the probe goes out and hangs: the one request the degraded endpoint may have
    await host.run(a.owner, () => {
      void pinSession(a.sub.client(), CITY, "sc-20");
    });
    await host.runTurns();
    expect(gc.count("/pin")).toBe(0);
    const starts = host.starts.length;
    await close(a);
    expect(host.starts.slice(starts)).toEqual([]);
  });

  test("a request started in another copy's turn and cancelled with that copy's close is retried, not backed off", async () => {
    const { host, gc, open, close } = setup();
    let holdZ = true;
    gc.override = (req) => (req.path.startsWith("/v0/city/z/") && !holdZ ? undefined : { hold: true });
    const a = await open("x");
    await open("y");
    const z = await open("z");
    // x's answer completes in copy-1's turn, which starts z's queued request: herdr gives it to copy-1
    gc.release(200, { items: [], total: 0 });
    await host.runTurns();
    expect(host.starts.at(-1)).toEqual({ path: "/v0/city/z/events", owner: "copy-1" });
    await close(a);
    holdZ = false;
    await host.advance(RECLAIM_AFTER_MS + TICK_MS);
    const s = z.sub.snapshot();
    expect(s.connection.kind).not.toBe("backing-off");
    expect(s.errors.some((e) => e.error.kind === "cancelled")).toBe(true);
    expect(s.events.held).toBe(false);
    await host.advance(3000);
    expect(z.sub.snapshot().events.cursor).not.toBeNull();
  });
});

describe("the shared city list", () => {
  function cities(reg: SyncRegistry): CitiesSubscription {
    const made = reg.subscribeCities(API);
    if (!made.ok) throw new Error("subscribeCities");
    liveCities.push(made.value);
    return made.value;
  }

  test("one /v0/cities poll per API for every copy: fast while no copy shows a running city, slow once one does", async () => {
    const { host, gc, reg } = setup();
    gc.override = (req) => (req.path === "/v0/cities" ? { status: 200, body: { items: [{ name: CITY, path: "/c", running: true }], total: 1 } } : undefined);
    const a = cities(reg);
    const b = cities(reg);
    let wantFast = true;
    await host.run("copy-a", () => host.every(TICK_MS, () => a.tick(wantFast)));
    await host.run("copy-b", () => host.every(TICK_MS, () => b.tick(wantFast)));
    await host.advance(CITIES_FAST_MS * 3);
    expect(gc.count("/v0/cities")).toBe(3);
    expect(a.snapshot().value?.items.map((c) => c.name)).toEqual([CITY]);
    expect(a.snapshot()).toBe(b.snapshot());
    wantFast = false;
    const start = gc.seen.length;
    await host.advance(CITIES_SLOW_MS * 2);
    expect(gc.count("/v0/cities", start)).toBe(2);
  });

  test("a city.* event refreshes the list at the next tick", async () => {
    const { host, gc, reg, open } = setup();
    const list = cities(reg);
    await open();
    await host.run("copy-c", () => host.every(TICK_MS, () => list.tick(false)));
    await host.advance(1000);
    const start = gc.seen.length;
    gc.emit({ type: "city.updated", subject: CITY });
    await host.advance(3000);
    expect(gc.count("/v0/cities", start)).toBe(1);
  });

  test("closing the copy whose tick started a poll abandons it; the other copy's next tick polls again", async () => {
    const { host, gc, reg } = setup();
    let hold = true;
    gc.override = (req) => (req.path !== "/v0/cities" ? undefined : hold ? { hold: true } : { status: 200, body: { items: [], total: 0 } });
    const a = cities(reg);
    const b = cities(reg);
    await host.run("copy-a", () => {
      a.tick(true);
      host.every(TICK_MS, () => a.tick(true));
    });
    await host.run("copy-b", () => host.every(TICK_MS, () => b.tick(true)));
    expect(gc.count("/v0/cities")).toBe(1);
    hold = false;
    await host.close("copy-a", () => a.unsubscribe());
    await host.advance(TICK_MS);
    expect(gc.count("/v0/cities")).toBe(2);
    expect(b.snapshot().value).not.toBeNull();
  });
});

describe("discovery probes share the fetch budget", () => {
  test("a /health probe that lost its 5 s race stays in flight until herdr's fetch settles; one still queued is dropped", async () => {
    const { host, gc, reg } = setup();
    gc.override = () => ({ hold: true });
    let resolved: unknown = null;
    void resolveEndpoint({
      settings: () => null,
      gcStatus: () => Promise.resolve(ok("{}")),
      readSupervisorConfig: () => Promise.resolve(ok({ path: "/p", text: null })),
      fetch: reg.probeFetch().fetch,
      probeFetch: () => reg.probeFetch(),
      sleep: (ms) => host.sleep(ms),
    }).then((r) => (resolved = r));
    await host.runTurns();
    expect(reg.budgetStats().inFlight).toBe(1);
    await host.advance(5_000);
    expect(resolved).toMatchObject({ ok: false, error: { reason: "none-reachable" } });
    expect(reg.budgetStats().inFlight).toBe(1);
    gc.release(200, HEALTH);
    await host.runTurns();
    expect(reg.budgetStats().inFlight).toBe(0);
  });

  test("a probe still queued when its race is lost is never sent", async () => {
    const { host, gc, reg } = setup();
    gc.override = () => ({ hold: true });
    const filler = reg.probeFetch();
    void filler.fetch(`${API}/a`, { method: "GET", headers: {} }).catch(() => {});
    void filler.fetch(`${API}/b`, { method: "GET", headers: {} }).catch(() => {});
    void resolveEndpoint({
      settings: () => ({ apiUrl: "http://127.0.0.1:9100" }),
      gcStatus: () => Promise.resolve(ok("{}")),
      readSupervisorConfig: () => Promise.resolve(ok({ path: "/p", text: null })),
      fetch: reg.probeFetch().fetch,
      probeFetch: () => reg.probeFetch(),
      sleep: (ms) => host.sleep(ms),
    });
    await host.advance(5_000);
    gc.release();
    await host.runTurns();
    expect(gc.seen.filter((r) => r.path === "/health").length).toBe(1);
  });
});
