// The shared "needs a human" poll (sync/needs.ts) through the registry,
// against the fake gc: what it reads, how often, and what it keeps.

import { afterEach, describe, expect, test } from "bun:test";
import { NEEDS_POLL_MS, STATUS_POLL_MS } from "../../../src/sync/needs.ts";
import { SyncRegistry, TICK_MS, type NeedsSubscription } from "../../../src/sync/registry.ts";
import { FakeGc, FakeHost } from "./fakes.ts";

const API = "http://127.0.0.1:8372";
let live: NeedsSubscription[] = [];

afterEach(() => {
  for (const s of live) s.unsubscribe();
  live = [];
});

async function setup(cities: string[] = ["scratch"]) {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  const reg = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5 });
  reg.setOnScreen(true);
  let sub: NeedsSubscription | null = null;
  await host.run("sidebar", () => {
    const made = reg.subscribeNeeds(API);
    if (!made.ok) throw new Error(JSON.stringify(made.error));
    sub = made.value;
    sub.tick(cities);
    host.every(TICK_MS, () => sub?.tick(cities));
  });
  await host.runTurns();
  if (!sub) throw new Error("subscribe");
  live.push(sub);
  return { host, gc, sub: sub as NeedsSubscription };
}

describe("the needs a human poll", () => {
  test("reads each city's pending prompts, human beads and status, and never its agents or sessions", async () => {
    const pending = { items: [{ session_id: "sc-20", request_id: "r-1", kind: "question" }], total: 1 };
    const { host, gc, sub } = await setup(["scratch", "other"]);
    gc.override = (req) => (req.path === "/v0/city/scratch/pending" ? { status: 200, body: pending } : undefined);
    sub.refresh();
    await host.advance(1000);
    const paths = gc.seen.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("/agents") || p.endsWith("/sessions"))).toBe(false);
    for (const city of ["scratch", "other"]) {
      for (const tail of ["pending", "beads", "status"]) expect(paths).toContain(`/v0/city/${city}/${tail}`);
    }
    const s = sub.snapshot().cities.get("scratch");
    expect(s?.waiting).toEqual([expect.objectContaining({ sessionId: "sc-20", requestId: "r-1", kind: "question" })]);
    expect(s?.waiting[0]?.who).not.toBeNull();
    expect(paths).toContain("/v0/city/scratch/session/sc-20");
    expect(paths).toContain("/v0/city/scratch/session/sc-20/pending");
    expect(s?.human.map((b) => b.id)).toEqual(["sc-90", "sc-91"]);
    expect(s?.humanTotal).toBe(2);
    expect(s?.status?.agents).toEqual({ total: 9, running: 6, suspended: 1, quarantined: 0 });
  });

  test("polls every NEEDS_POLL_MS, status every STATUS_POLL_MS, and looks a session up once", async () => {
    const pending = { items: [{ session_id: "sc-20", request_id: "r-1", kind: "question" }], total: 1 };
    const { host, gc } = await setup();
    gc.override = (req) => (req.path.endsWith("/pending") && !req.path.includes("/session/") ? { status: 200, body: pending } : undefined);
    const start = gc.seen.length;
    await host.advance(NEEDS_POLL_MS * 4);
    const seen = gc.seen.slice(start).map((r) => r.path);
    const n = (p: string) => seen.filter((x) => x === p).length;
    expect(n("/v0/city/scratch/beads")).toBe(4);
    expect(n("/v0/city/scratch/status")).toBe(Math.floor((NEEDS_POLL_MS * 4) / STATUS_POLL_MS));
    expect(n("/v0/city/scratch/session/sc-20")).toBe(1);
    expect(n("/v0/city/scratch/session/sc-20/pending")).toBe(1);
  });

  test("a city gc stops listing as running is dropped", async () => {
    const host = new FakeHost();
    const gc = new FakeGc(host);
    const reg = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5 });
    let cities = ["scratch", "other"];
    let sub: NeedsSubscription | null = null;
    await host.run("sidebar", () => {
      const made = reg.subscribeNeeds(API);
      if (!made.ok) throw new Error("subscribe");
      sub = made.value;
      host.every(TICK_MS, () => sub?.tick(cities));
    });
    await host.advance(1000);
    const s = sub as unknown as NeedsSubscription;
    live.push(s);
    expect([...s.snapshot().cities.keys()].sort()).toEqual(["other", "scratch"]);
    cities = ["scratch"];
    await host.advance(TICK_MS);
    expect([...s.snapshot().cities.keys()]).toEqual(["scratch"]);
  });

  test("a 5xx ends the poll and is the snapshot's error; the next good poll clears it", async () => {
    const { host, gc, sub } = await setup();
    gc.override = () => ({ status: 503, body: { title: "Service Unavailable", status: 503, detail: "reloading" } });
    sub.refresh();
    await host.advance(1000);
    expect(sub.snapshot().error).not.toBeNull();
    gc.override = null;
    await host.advance(120_000);
    expect(sub.snapshot().error).toBeNull();
    expect(sub.snapshot().cities.get("scratch")?.human.length).toBe(2);
  });
});
