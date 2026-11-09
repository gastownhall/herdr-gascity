// The controller performs discovery's I/O for one copy and feeds the city
// machine; a newer run supersedes an older one.

import { describe, expect, test } from "bun:test";
import { DiscoveryController, type DiscoveryHost } from "../../../src/discovery/controller.ts";
import type { HostFetch } from "../../../src/gc/client.ts";
import type { GcError } from "../../../src/gc/errors.ts";
import { err, ok, type Result } from "../../../src/result.ts";

const HEALTH = { status: "ok", version: "1.2.3", uptime_sec: 1, cities_total: 2, cities_running: 2 };
const CITIES = { items: [{ name: "alpha", path: "/a", running: true }, { name: "beta", path: "/b", running: true }], total: 2 };

function reply(body: unknown, status = 200) {
  return (url: string) => Promise.resolve({ status, ok: status < 300, url, text: () => Promise.resolve(JSON.stringify(body)) });
}

function fakeHost(fetch: HostFetch, remember: Result<null, GcError> = ok(null)) {
  const remembered: string[] = [];
  const host: DiscoveryHost = {
    settings: () => undefined,
    gcStatus: () => Promise.resolve(ok("{}")),
    readSupervisorConfig: () => Promise.resolve(ok({ path: "/h/.gc/supervisor.toml", text: null })),
    fetch,
    probeFetch: () => ({ fetch, drop: () => {} }),
    rememberCity: (city) => {
      remembered.push(city);
      return remember;
    },
  };
  return { host, remembered };
}

const routes = (url: string) => (url.endsWith("/health") ? reply(HEALTH)(url) : url.endsWith("/v0/cities") ? reply(CITIES)(url) : Promise.reject(new Error(`unexpected ${url}`)));
const task = () => {
  const t = { notifies: 0, notify: () => { t.notifies++; }, sleep: () => new Promise<void>(() => {}) };
  return t;
};

describe("run", () => {
  test("discovers, lists cities and notifies after each step", async () => {
    const { host } = fakeHost(routes);
    const c = new DiscoveryController(host, { pinned: "beta", lastSelection: null });
    const t = task();
    await c.run(t);
    expect(c.machine.state).toMatchObject({ phase: "city-running", city: { name: "beta" }, endpoint: { url: "http://127.0.0.1:8372", source: "default" } });
    expect(t.notifies).toBe(3);
  });

  test("no endpoint: stops after resolution", async () => {
    const { host } = fakeHost(() => Promise.reject(new Error("Connection refused")));
    const c = new DiscoveryController(host, { pinned: null, lastSelection: null });
    await c.run(task());
    expect(c.machine.state).toMatchObject({ phase: "no-endpoint", failure: { reason: "none-reachable" } });
  });

  test("a /v0/cities failure is cities-failed", async () => {
    const fetch: HostFetch = (url) => (url.endsWith("/health") ? reply(HEALTH)(url) : reply({ detail: "boom", errors: [] }, 500)(url));
    const c = new DiscoveryController(fakeHost(fetch).host, { pinned: null, lastSelection: null });
    await c.run(task());
    expect(c.machine.state).toMatchObject({ phase: "cities-failed", error: { kind: "http", status: 500 } });
  });

  test("a newer run supersedes an older one still in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const fetch: HostFetch = async (url) => {
      if (url.endsWith("/health") && calls++ === 0) {
        await gate;
        return reply({ ...HEALTH, version: "old" })(url);
      }
      return routes(url);
    };
    const c = new DiscoveryController(fakeHost(fetch).host, { pinned: "alpha", lastSelection: null });
    const first = c.run(task());
    await c.run(task());
    release();
    await first;
    expect(c.machine.state).toMatchObject({ phase: "city-running", endpoint: { version: "1.2.3" } });
  });
});

describe("select", () => {
  test("an unpinned copy switches and remembers the city", async () => {
    const { host, remembered } = fakeHost(routes);
    const c = new DiscoveryController(host, { pinned: null, lastSelection: null });
    await c.run(task());
    expect(c.machine.state.phase).toBe("choose-city");
    c.select("beta");
    expect(c.machine.state).toMatchObject({ phase: "city-running", city: { name: "beta" } });
    expect(remembered).toEqual(["beta"]);
  });

  test("a pinned copy neither switches nor remembers", async () => {
    const { host, remembered } = fakeHost(routes);
    const c = new DiscoveryController(host, { pinned: "alpha", lastSelection: null });
    await c.run(task());
    c.select("beta");
    expect(c.machine.state).toMatchObject({ city: { name: "alpha" } });
    expect(remembered).toEqual([]);
  });

  test("a failure to remember is kept as a host error, not dropped", async () => {
    const failure: GcError = { kind: "host-call", api: 'localStorage.setItem("city")', cause: "disk full" };
    const { host } = fakeHost(routes, err(failure));
    const c = new DiscoveryController(host, { pinned: null, lastSelection: null });
    await c.run(task());
    c.select("alpha");
    expect(c.machine.state).toMatchObject({ phase: "city-running", city: { name: "alpha" } });
    expect(c.hostErrors).toEqual([failure]);
  });
});
