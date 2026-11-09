// One copy of the mod (src/copy.ts) wired to discovery and the shared sync
// registry, under herdr's ownership rule (sync/fakes.ts FakeHost): each copy
// discovers in its own init task, ticks from its own periodic timer, renders
// from the shared snapshot, and on close unsubscribes without starting
// anything. Surviving copies keep updating.

import { afterEach, describe, expect, test } from "bun:test";
import { DiscoveryController } from "../../src/discovery/controller.ts";
import { CopyController, type CopyHost } from "../../src/copy.ts";
import { err, ok } from "../../src/result.ts";
import { PROBE_WRITE_DEADLINE_MS, ProbeWriter, type ProbeIo } from "../../src/probe.ts";
import { SyncRegistry, TICK_MS } from "../../src/sync/registry.ts";
import type { VisibilityInput } from "../../src/sync/visibility.ts";
import { FakeGc, FakeHost, fixtureBody, type Owner } from "./sync/fakes.ts";

const API = "http://127.0.0.1:8372";

interface Opened {
  owner: Owner;
  copy: CopyController;
  notifies: number;
}

let opened: Opened[] = [];

afterEach(() => {
  for (const o of opened) o.copy.close();
  opened = [];
});

function setup(opts: { visibility?: VisibilityInput; probe?: boolean; herdrVersion?: CopyHost["herdrVersion"] } = {}) {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  const registry = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5 });
  const files = new Map<string, string>();
  let writes = 0;
  let probeOn = opts.probe ?? false;
  const io: ProbeIo = {
    path: () => "/app/data/gascity-probe/probe.json",
    read: (p) => Promise.resolve(ok(files.get(p) ?? null)),
    write: (p, text, expected) => {
      writes++;
      if ((files.get(p) ?? null) !== expected) return Promise.resolve(err({ kind: "host-call", api: `writeTextFile(${p})`, cause: "stale snapshot" }));
      files.set(p, text);
      return Promise.resolve(ok(null));
    },
  };
  const probe = new ProbeWriter(io);
  let visibility: VisibilityInput = opts.visibility ?? { windowOpen: false, layoutMods: [], panes: [{ pane: "p1", tab: "t1", mod: "gascity" }], focus: { space: "s", tab: "t1" } };
  let visibilityThrows: string | null = null;
  const copyHost: CopyHost = {
    visibility: () => {
      if (visibilityThrows !== null) throw new Error(visibilityThrows);
      return ok(visibility);
    },
    probeEnabled: () => probeOn,
    herdrVersion: opts.herdrVersion ?? (() => ok("0.1.14")),
    execLog: () => [],
    setProbe: () => {},
    settings: () => null,
    setGcBin: () => ok(undefined),
    keyboard: () => false,
    focusTarget: () => null,
    terminal: { scene: () => ok({ spaces: [], panes: [], terminals: [] }), openTab: () => ok(null), selectTab: () => ok(null) },
  };
  let n = 0;
  /** Opens a copy as main.ts does: discovery task and periodic timer, both in the copy's own scope. */
  const open = async (props: { pinned?: string } = {}): Promise<Opened> => {
    const owner = `copy-${++n}`;
    const discovery = new DiscoveryController({
      settings: () => null,
      gcStatus: () => Promise.resolve(ok("{}")),
      readSupervisorConfig: () => Promise.resolve(ok({ path: "/h/.gc/supervisor.toml", text: null })),
      fetch: registry.probeFetch().fetch,
      probeFetch: () => registry.probeFetch(),
      rememberCity: () => ok(null),
    }, { pinned: props.pinned ?? null, lastSelection: null });
    const copy = new CopyController({ registry, discovery, host: copyHost, clock: host, probe });
    const o: Opened = { owner, copy, notifies: 0 };
    await host.run(owner, () => {
      void copy.discover({ notify: () => o.notifies++, sleep: (ms) => host.sleep(ms) });
      // the timer's own context spawns a rediscovery, so its work belongs to this copy
      host.every(TICK_MS, () => {
        if (copy.tick((body) => void body({ notify: () => o.notifies++, sleep: (ms) => host.sleep(ms) }))) o.notifies++;
      });
    });
    await host.runTurns();
    opened.push(o);
    return o;
  };
  const close = (o: Opened) => host.close(o.owner, () => o.copy.close());
  return {
    host, gc, registry, open, close, files,
    writes: () => writes,
    setProbe: (on: boolean) => { probeOn = on; },
    setVisibility: (v: VisibilityInput) => { visibility = v; },
    throwFromVisibility: (message: string | null) => { visibilityThrows = message; },
  };
}

describe("a copy", () => {
  test("discovers, subscribes to its running city from its own tick, and renders agents from the shared snapshot", async () => {
    const { host, open } = setup();
    const a = await open();
    await host.advance(3000);
    const v = a.copy.view(host.now());
    expect(v.header.chip).toEqual({ tone: "ok", text: "connected" });
    expect(v.header.city).toBe("scratch");
    expect(v.agents?.groups.map((g) => g.key)).toEqual(["rig:frontend", "city"]);
    expect(v.agents?.region.kind).toBe("ok");
    expect(a.notifies).toBeGreaterThan(0);
  });

  test("two copies of one city share one store; closing one starts nothing, and the other keeps updating", async () => {
    const { host, gc, registry, open, close } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    expect(registry.storeCount()).toBe(1);
    const starts = host.starts.length;
    await close(a);
    expect(host.starts.slice(starts)).toEqual([]);
    const before = b.notifies;
    const seen = gc.seen.length;
    gc.emit({ type: "session.woke", subject: "sc-20" });
    await host.advance(5000);
    expect(gc.count("/sessions", seen)).toBeGreaterThan(0);
    expect(host.starts.slice(starts).every((s) => s.owner !== a.owner)).toBe(true);
    expect(b.notifies).toBeGreaterThan(before);
    expect(b.copy.view(host.now()).header.chip.text).toBe("connected");
  });

  test("the last copy's close drops the store and the city list poll; nothing polls afterwards", async () => {
    const { host, gc, registry, open, close } = setup();
    const a = await open();
    await host.advance(3000);
    await close(a);
    expect(registry.storeCount()).toBe(0);
    const seen = gc.seen.length;
    await host.advance(120_000);
    expect(gc.seen.length).toBe(seen);
  });

  test("selecting a session watches its detail (output, wake reasons, pending prompt); deselecting releases it", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(3000);
    a.copy.selectSession("sc-20");
    await host.advance(3000);
    expect(gc.count("/session/sc-20")).toBeGreaterThan(0);
    expect(gc.count("/session/sc-20/pending")).toBe(1);
    expect(gc.paths().filter((p) => p.includes("wake_reasons=true")).length).toBe(1);
    const detail = a.copy.view(host.now()).detail;
    expect(detail.kind).toBe("session");
    a.copy.selectSession(null);
    await host.advance(TICK_MS);
    const seen = gc.seen.length;
    await host.advance(10_000);
    expect(gc.count("/session/sc-20", seen)).toBe(0);
  });

  test("renders the work board from the shared snapshot: columns without infrastructure beads, the closed seed by creation time, a bead in Ready not listed as closed", async () => {
    const { host, open } = setup();
    const a = await open();
    await host.advance(3000);
    const board = a.copy.view(host.now()).board;
    expect(board?.ready.cards.map((c) => c.id)).toEqual(["sc-18", "fe-1", "sc-58", "sc-74"]);
    expect(board?.inProgress.empty).toBe("nothing in progress");
    expect(board?.closed.recent).toEqual([]);
    // the recorded seed has sc-74 closed and a session bead; the recorded Ready column has sc-74 open again
    expect(board?.closed.earlier.map((c) => c.id)).not.toContain("sc-60");
    expect(board?.closed.earlier.map((c) => c.id)).not.toContain("sc-74");
    expect(board?.closed.earlier[0]).toMatchObject({ id: "sc-73", closeReason: "order dispatch completed: tracking bead lifecycle finished" });
    expect(board?.hidden).toBe(1);
  });

  test("a bead.closed event puts the bead at the top of Recently closed, with gc's close reason", async () => {
    const { host, gc, open } = setup();
    let closed = false;
    gc.override = (req) => {
      if (req.path === "/v0/city/scratch/bead/fe-1") {
        return { status: 200, body: { id: "fe-1", title: "Frontend rig task", status: "closed", issue_type: "task", labels: [], created_at: "t", close_reason: "canary done" } };
      }
      if (closed && req.path === "/v0/city/scratch/work/ready" && !req.query.has("status")) {
        const body = fixtureBody("get-v0-city-by-city-name-work-ready", "ready") as { items: { id: string }[] };
        return { status: 200, body: { items: body.items.filter((b) => b.id !== "fe-1") } };
      }
      return undefined;
    };
    const a = await open();
    await host.advance(3000);
    closed = true;
    gc.emit({ type: "bead.closed", subject: "fe-1" });
    await host.advance(3000);
    const board = a.copy.view(host.now()).board;
    expect(board?.closed.recent.map((c) => [c.id, c.closeReason])).toEqual([["fe-1", "canary done"]]);
    expect(board?.ready.cards.map((c) => c.id)).not.toContain("fe-1");
  });

  test("selecting a bead watches it (its description comes by id); deselecting releases it", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(3000);
    a.copy.selectBead("sc-74");
    await host.advance(1000);
    expect(gc.count("/bead/sc-74")).toBe(1);
    const d = a.copy.view(host.now()).beadDetail;
    expect(d).toMatchObject({ kind: "bead", id: "sc-74", description: "recorded for the herdr-gascity contract fixtures" });
    expect(a.copy.view(host.now()).board?.ready.cards.find((c) => c.id === "sc-74")?.selected).toBe(true);
    a.copy.selectBead(null);
    expect(a.copy.view(host.now()).beadDetail).toEqual({ kind: "none" });
    const seen = gc.seen.length;
    gc.emit({ type: "bead.updated", subject: "sc-74", payload: { bead: { id: "sc-74", title: "t", status: "open", issue_type: "task", labels: [], created_at: "t" } } });
    await host.advance(3000);
    expect(gc.count("/bead/sc-74", seen)).toBe(0);
  });

  test("switching city clears the selected bead: it is not watched in the new city", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/v0/cities"
      ? { status: 200, body: { items: [{ name: "scratch", path: "/s", running: true }, { name: "other", path: "/o", running: true }], total: 2 } }
      : undefined);
    const a = await open({ pinned: undefined });
    a.copy.selectCity("scratch");
    await host.advance(3000);
    a.copy.selectBead("sc-74");
    await host.advance(1000);
    expect(gc.count("/v0/city/scratch/bead/sc-74")).toBe(1);
    a.copy.selectCity("other");
    await host.advance(3000);
    expect(a.copy.view(host.now()).header.city).toBe("other");
    expect(a.copy.view(host.now()).beadDetail).toEqual({ kind: "none" });
    expect(gc.count("/v0/city/other/bead/sc-74")).toBe(0);
  });

  test("a city call answering 'not running' moves the copy to city stopped and ends its subscription", async () => {
    const { host, gc, registry, open } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.path.startsWith("/v0/city/scratch/")
      ? { status: 404, body: { title: "Not Found", status: 404, detail: "not_found: city not found or not running: scratch" } }
      : undefined);
    await host.advance(6000);
    expect(a.copy.view(host.now()).header.chip.text).toBe("city stopped (gc answered: not running)");
    expect(registry.storeCount()).toBe(0);
  });

  test("the copy tells the registry whether a gascity view may be on screen", async () => {
    const { host, gc, open, setVisibility } = setup();
    await open();
    await host.advance(3000);
    setVisibility({ windowOpen: false, layoutMods: [], panes: [{ pane: "p1", tab: "t1", mod: "gascity" }], focus: { space: "s", tab: "t2" } });
    const seen = gc.seen.length;
    await host.advance(20_000);
    // hidden: an event poll every 10 s instead of every 2 s
    expect(gc.count("/events", seen)).toBe(2);
  });

  test("with the probe on, the probe file is written from the copy's tick", async () => {
    const { host, open, files } = setup({ probe: true });
    await open();
    await host.advance(3000);
    const doc = JSON.parse(files.get("/app/data/gascity-probe/probe.json") ?? "{}");
    expect(doc).toMatchObject({ schema: "gascity-herdr-probe/4", connection: { text: "connected" }, city: "scratch", visibility: { on_screen: true } });
    expect(doc.sessions.length).toBe(3);
    expect(doc.board.ready.cards.map((c: { id: string }) => c.id)).toEqual(["sc-18", "fe-1", "sc-58", "sc-74"]);
    expect(doc.board.closed.earlier[0]).toEqual({ id: "sc-73", title: "order:gate-sweep", close_reason: "order dispatch completed: tracking bead lifecycle finished", assignee: null });
    expect(doc.fetch_in_flight_max).toBeLessThanOrEqual(2);
  });

  test("several copies with different documents (one has a detail open) do not take turns rewriting the probe", async () => {
    const { host, open, writes } = setup({ probe: true });
    const a = await open();
    const b = await open();
    const c = await open();
    await host.advance(3000);
    b.copy.selectSession("sc-20");
    c.copy.toggleDiagnostics();
    await host.advance(5000);
    const before = writes();
    await host.advance(20_000);
    // one owner: about one write a second, as with a single copy (its data age changes every second);
    // three copies taking turns wrote about nine a second
    expect(writes() - before).toBeLessThanOrEqual(30);
    void a;
  });

  test("the next copy takes the probe over when its owner closes", async () => {
    const { host, open, close, files } = setup({ probe: true });
    const a = await open();
    const b = await open();
    await host.advance(3000);
    b.copy.selectSession("sc-20");
    await host.advance(3000);
    expect(JSON.parse(files.get("/app/data/gascity-probe/probe.json") ?? "{}").detail).toBeNull();
    await close(a);
    await host.advance(PROBE_WRITE_DEADLINE_MS + 3000);
    expect(JSON.parse(files.get("/app/data/gascity-probe/probe.json") ?? "{}").detail?.session).toBe("sc-20");
  });

  test("turning the probe off empties the probe file (it holds agent output and prompts)", async () => {
    const { host, open, files, setProbe } = setup({ probe: true });
    const a = await open();
    await host.advance(3000);
    a.copy.selectSession("sc-20");
    await host.advance(3000);
    expect(files.get("/app/data/gascity-probe/probe.json")).toContain("sc-20");
    setProbe(false);
    await host.advance(1000);
    expect(files.get("/app/data/gascity-probe/probe.json")).toBe("");
  });

  test("retry now with a running city refetches everything and the city list, keeping what is shown; it does not rediscover", async () => {
    const { host, gc, open } = setup();
    const a = await open();
    await host.advance(6000);
    const seen = gc.seen.length;
    await host.run(a.owner, () => a.copy.retry({ notify: () => {}, sleep: (ms) => host.sleep(ms) }));
    expect(a.copy.view(host.now()).agents?.groups.length).toBe(2);
    await host.advance(1000);
    expect(gc.count("/health", seen)).toBe(0);
    expect(gc.count("/v0/cities", seen)).toBe(1);
    for (const d of ["/rigs", "/agents", "/sessions", "/pending"]) expect(gc.count(d, seen)).toBe(1);
    expect(a.copy.view(host.now()).refreshCount).toBe(1);
  });

  test("retry now without a running city rediscovers", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/health" ? { reject: "error sending request: connection refused" } : undefined);
    const a = await open();
    await host.advance(1000);
    expect(a.copy.view(host.now()).header.chip.text).toMatch(/^gc not reachable/);
    gc.override = null;
    await host.run(a.owner, () => a.copy.retry({ notify: () => {}, sleep: (ms) => host.sleep(ms) }));
    await host.advance(3000);
    expect(a.copy.view(host.now()).header.chip.text).toBe("connected");
  });
});

describe("failures inside a copy's own work reach its diagnostics", () => {
  test("herdr's version that cannot be read is recorded once (not swallowed); the probe says null", async () => {
    let reads = 0;
    const { host, open, files } = setup({
      probe: true,
      herdrVersion: () => {
        reads++;
        return err({ kind: "host-call", api: "updates()", cause: "updates is not a function" });
      },
    });
    const a = await open();
    await host.advance(6000);
    expect(reads).toBeGreaterThan(1);
    const lines = a.copy.view(host.now()).diagnostics.filter((d) => d.source === "herdr");
    expect(lines.map((d) => d.text)).toEqual(["updates() failed: updates is not a function"]);
    expect(JSON.parse(files.get("/app/data/gascity-probe/probe.json") ?? "{}").herdr_version).toBeNull();
  });

  test("an exception thrown inside a tick is recorded in the diagnostics, and the next tick carries on", async () => {
    const { host, open, throwFromVisibility } = setup();
    const a = await open();
    await host.advance(3000);
    throwFromVisibility("panes() exploded");
    await host.advance(1000);
    const crashed = a.copy.view(host.now()).diagnostics.filter((d) => d.source === "tick");
    expect(crashed.map((d) => d.text)).toEqual(["a periodic update failed: panes() exploded"]);
    throwFromVisibility(null);
    await host.advance(3000);
    expect(a.copy.view(host.now()).header.chip.text).toBe("connected");
  });
});

describe("rediscovery from the copy's own tick", () => {
  test("a copy with no endpoint rediscovers from its own tick, backing off, until gc answers; no Retry needed", async () => {
    const { host, gc, open } = setup();
    gc.override = (req) => (req.path === "/health" ? { reject: "error sending request: connection refused" } : undefined);
    const a = await open();
    await host.advance(1000);
    expect(a.copy.view(host.now()).header.chip.text).toMatch(/^gc not reachable/);
    const first = gc.count("/health");
    await host.advance(40_000);
    // 5 s, then 10 s, then 20 s apart: three more tries in 40 s, not one per tick
    expect(gc.count("/health") - first).toBe(3);
    gc.override = null;
    await host.advance(60_000);
    expect(a.copy.view(host.now()).header.chip.text).toBe("connected");
    expect(host.starts.filter((s) => s.path === "/health").every((s) => s.owner === a.owner)).toBe(true);
  });

  test("a discovering copy whose /health ran in another copy's turn recovers when that copy closes", async () => {
    const { host, gc, registry, open, close } = setup();
    const a = await open();
    await host.advance(3000);
    // two slow requests of a take both fetch slots; gc is slow to answer /health too
    gc.override = (req) => (req.path.endsWith("/rigs") || req.path === "/health" ? { hold: true } : undefined);
    await host.run(a.owner, () => {
      for (let i = 0; i < 2; i++) registry.probeFetch().fetch(`${API}/v0/city/scratch/rigs`, { method: "GET", headers: {} }).catch(() => {});
    });
    expect(registry.budgetStats().inFlight).toBe(2);
    const healthBefore = gc.count("/health");
    const b = await open();
    await host.advance(1000);
    // b's /health waits in the queue; a's held request ends in a's turn, which starts b's probe there
    expect(gc.count("/health")).toBe(healthBefore);
    gc.release(200, { items: [], total: 1 });
    await host.runTurns();
    expect(gc.count("/health")).toBe(healthBefore + 1);
    expect(host.starts.filter((s) => s.path === "/health").at(-1)?.owner).toBe(a.owner);
    // a closes with b's probe in flight: herdr never settles it
    await close(a);
    gc.override = null;
    await host.advance(120_000);
    expect(b.copy.view(host.now()).header.chip.text).toBe("connected");
    expect(host.starts.filter((s) => s.path === "/health").at(-1)?.owner).toBe(b.owner);
  });

  test("closing a copy cancels its discovery: nothing it started runs gc or sends a request afterwards", async () => {
    const { host, gc, open, close } = setup();
    gc.override = (req) => (req.path === "/health" ? { hold: true } : undefined);
    const a = await open();
    await host.advance(1000);
    const starts = host.starts.length;
    await close(a);
    gc.override = null;
    await host.advance(120_000);
    expect(host.starts.slice(starts)).toEqual([]);
  });
});

