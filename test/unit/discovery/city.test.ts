// The per-copy city state machine:
//   discovering → no-endpoint | listing → cities-failed | choose-city | city-unknown
//               | city-running ⇄ city-stopped
// A pinned copy (props.city) shows only its city; an unpinned copy selects
// its last selection, else the only running city, else asks.

import { describe, expect, test } from "bun:test";
import {
  decodeCopy, initialMachine, step, type CityEvent, type CityList, type CityMachine, type CopyContext,
} from "../../../src/discovery/city.ts";
import type { Endpoint, NoEndpoint } from "../../../src/discovery/resolve.ts";
import type { CityInfo } from "../../../src/gc/types.gen.ts";
import { err, ok } from "../../../src/result.ts";

const ENDPOINT: Endpoint = {
  url: "http://127.0.0.1:8372", source: "default", version: "1.2.3", gcBin: "gc",
  attempts: [{ source: "default", outcome: "ok", url: "http://127.0.0.1:8372", version: "1.2.3" }],
};
const city = (name: string, running: boolean, extra: Partial<CityInfo> = {}): CityInfo => ({ name, path: `/c/${name}`, running, ...extra });
const list = (...items: CityInfo[]): CityList => ({ items, unreadable: [], total: items.length });

const UNPINNED: CopyContext = { pinned: null, lastSelection: null };
const run = (copy: CopyContext, ...events: CityEvent[]): CityMachine => events.reduce(step, initialMachine(copy));
const resolved: CityEvent = { type: "resolved", result: ok(ENDPOINT) };
const cities = (...items: CityInfo[]): CityEvent => ({ type: "cities", result: ok(list(...items)) });

describe("decodeCopy: props() and the copy's last selection", () => {
  test("herdr's props() is null for an unpinned copy", () => {
    expect(decodeCopy(null, null)).toEqual(ok({ pinned: null, lastSelection: null }));
    expect(decodeCopy(undefined, "alpha")).toEqual(ok({ pinned: null, lastSelection: "alpha" }));
  });

  test("props.city pins the copy; other props (an overlay id) do not", () => {
    expect(decodeCopy({ city: "alpha" }, "beta")).toEqual(ok({ pinned: "alpha", lastSelection: "beta" }));
    expect(decodeCopy({ overlay: "o-1" }, null)).toEqual(ok({ pinned: null, lastSelection: null }));
  });

  test("a props.city that is not a non-empty string is a host-decode error", () => {
    for (const props of [{ city: 3 }, { city: "" }, "alpha", [1]]) {
      const r = decodeCopy(props, null);
      expect(!r.ok && r.error).toMatchObject({ kind: "host-decode", api: "props()" });
    }
  });
});

describe("discovery", () => {
  test("starts discovering", () => {
    expect(initialMachine(UNPINNED).state).toEqual({ phase: "discovering" });
  });

  test("no endpoint: no-endpoint with the resolution failure", () => {
    const failure: NoEndpoint = { reason: "none-reachable", attempts: [] };
    expect(run(UNPINNED, { type: "resolved", result: err(failure) }).state).toEqual({ phase: "no-endpoint", failure });
  });

  test("an endpoint: listing cities", () => {
    expect(run(UNPINNED, resolved).state).toEqual({ phase: "listing", endpoint: ENDPOINT });
  });

  test("discover (retry) from any state starts over", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", true)), { type: "discover" });
    expect(m.state).toEqual({ phase: "discovering" });
  });
});

describe("the city list", () => {
  test("a failed /v0/cities is cities-failed, with the error", () => {
    const error = { kind: "unreachable", url: "http://127.0.0.1:8372/v0/cities", cause: "refused" } as const;
    expect(run(UNPINNED, resolved, { type: "cities", result: err(error) }).state).toEqual({
      phase: "cities-failed", endpoint: ENDPOINT, error, selected: null,
    });
  });

  test("api-missing on /v0/cities (gc too old) is cities-failed too", () => {
    const error = { kind: "api-missing", operationId: "get-v0-cities" } as const;
    expect(run(UNPINNED, resolved, { type: "cities", result: err(error) }).state).toMatchObject({ phase: "cities-failed", error });
  });

  test("a later good list after a failure keeps the copy's city", () => {
    const error = { kind: "timeout", url: "u", ms: 30_000 } as const;
    const m = run(UNPINNED, resolved, cities(city("alpha", true), city("beta", true)), { type: "select", city: "beta" },
      { type: "cities", result: err(error) }, cities(city("alpha", true), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-running", city: { name: "beta" } });
  });
});

describe("selection: pinned > this copy's choice > last selection > the only running city > ask", () => {
  test("unpinned, one running city among stopped ones: that city", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", false), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-running", city: { name: "beta" }, notices: [] });
  });

  test("unpinned, several running and no last selection: ask", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", true), city("beta", true)));
    expect(m.state).toEqual({ phase: "choose-city", endpoint: ENDPOINT, cities: list(city("alpha", true), city("beta", true)) });
  });

  test("unpinned, no running city and no last selection: ask (an empty list asks too)", () => {
    expect(run(UNPINNED, resolved, cities(city("alpha", false))).state.phase).toBe("choose-city");
    expect(run(UNPINNED, resolved, cities()).state.phase).toBe("choose-city");
  });

  test("unpinned: the last selection wins over the only running city, even when stopped", () => {
    const m = run({ pinned: null, lastSelection: "alpha" }, resolved, cities(city("alpha", false, { status: "stopped" }), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-stopped", city: { name: "alpha", status: "stopped" }, cause: "list" });
  });

  test("unpinned: a last selection gc no longer lists is passed over", () => {
    const m = run({ pinned: null, lastSelection: "gone" }, resolved, cities(city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-running", city: { name: "beta" } });
  });

  test("pinned: always its city, even when another is the only running one", () => {
    const m = run({ pinned: "alpha", lastSelection: "beta" }, resolved, cities(city("alpha", false, { error: "boom" }), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-stopped", city: { name: "alpha", error: "boom" } });
  });

  test("pinned to a city gc does not list: city-unknown, never another city", () => {
    const m = run({ pinned: "ghost", lastSelection: null }, resolved, cities(city("beta", true)));
    expect(m.state).toEqual({ phase: "city-unknown", endpoint: ENDPOINT, cities: list(city("beta", true)), city: "ghost" });
  });

  test("unpinned: selecting a city switches to it and becomes the last selection", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", true), city("beta", true)), { type: "select", city: "beta" });
    expect(m.state).toMatchObject({ phase: "city-running", city: { name: "beta" } });
    expect(m.copy).toEqual({ pinned: null, lastSelection: "beta" });
  });

  test("unpinned: a selection survives a list where another city is the only running one", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", true), city("beta", true)), { type: "select", city: "alpha" },
      cities(city("alpha", false), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-stopped", city: { name: "alpha" } });
  });

  test("unpinned: a selected city that disappears from the list is city-unknown", () => {
    const m = run(UNPINNED, resolved, cities(city("alpha", true)), cities(city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-unknown", city: "alpha" });
  });

  test("pinned: select does nothing (a pinned copy offers no city switcher)", () => {
    const before = run({ pinned: "alpha", lastSelection: null }, resolved, cities(city("alpha", true), city("beta", true)));
    const after = step(before, { type: "select", city: "beta" });
    expect(after).toBe(before);
  });

  test("select before the list is known does nothing", () => {
    const before = run(UNPINNED, resolved);
    expect(step(before, { type: "select", city: "alpha" })).toBe(before);
  });
});

describe("running ⇄ stopped", () => {
  const running = () => run(UNPINNED, resolved, cities(city("alpha", true)));

  test("the list says stopped: city-stopped; running again: city-running", () => {
    const stopped = step(running(), cities(city("alpha", false, { status: "stopping" })));
    expect(stopped.state).toMatchObject({ phase: "city-stopped", city: { name: "alpha", status: "stopping" }, cause: "list" });
    expect(step(stopped, cities(city("alpha", true))).state).toMatchObject({ phase: "city-running", city: { name: "alpha" } });
  });

  test("a city call answering city-not-running: city-stopped until the list says running", () => {
    const m = step(running(), { type: "city-error", city: "alpha", error: { kind: "city-not-running", city: "alpha" } });
    expect(m.state).toMatchObject({ phase: "city-stopped", city: { name: "alpha" }, cause: "api" });
    expect(step(m, cities(city("alpha", true))).state.phase).toBe("city-running");
  });

  test("an error for a city this copy no longer shows changes nothing", () => {
    const before = running();
    expect(step(before, { type: "city-error", city: "beta", error: { kind: "city-not-running", city: "beta" } })).toBe(before);
  });
});

describe("notices on a selected city", () => {
  const running = () => run(UNPINNED, resolved, cities(city("alpha", true)));
  const writeGrant = { kind: "write-grant-required", status: 401, detail: "missing X-GC-City-Write grant" } as const;

  test("write-grant-required: still running, with a read-only notice", () => {
    const m = step(running(), { type: "city-error", city: "alpha", error: writeGrant });
    expect(m.state).toMatchObject({ phase: "city-running", notices: [{ kind: "write-grant-required", detail: "missing X-GC-City-Write grant" }] });
  });

  test("read-only server and api-missing notices; the same notice is not repeated", () => {
    let m = running();
    for (const error of [
      { kind: "read-only", detail: "read_only: mutations disabled" },
      { kind: "api-missing", operationId: "get-v0-city-by-city-name-work-ready" },
      { kind: "api-missing", operationId: "get-v0-city-by-city-name-work-ready" },
      writeGrant, writeGrant,
      { kind: "read-grant-required", status: 403, detail: "read grant rejected" },
    ] as const) m = step(m, { type: "city-error", city: "alpha", error });
    expect(m.state).toMatchObject({
      phase: "city-running",
      notices: [
        { kind: "read-only", detail: "read_only: mutations disabled" },
        { kind: "api-missing", operationId: "get-v0-city-by-city-name-work-ready" },
        { kind: "write-grant-required", detail: "missing X-GC-City-Write grant" },
        { kind: "read-grant-required", detail: "read grant rejected" },
      ],
    });
  });

  test("notices survive stop/start of the same city, and are dropped when the copy switches city", () => {
    let m = run(UNPINNED, resolved, cities(city("alpha", true), city("beta", true)), { type: "select", city: "alpha" });
    m = step(m, { type: "city-error", city: "alpha", error: writeGrant });
    m = step(m, cities(city("alpha", false), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-stopped", notices: [{ kind: "write-grant-required" }] });
    m = step(m, cities(city("alpha", true), city("beta", true)));
    expect(m.state).toMatchObject({ phase: "city-running", notices: [{ kind: "write-grant-required" }] });
    m = step(m, { type: "select", city: "beta" });
    expect(m.state).toMatchObject({ phase: "city-running", city: { name: "beta" }, notices: [] });
  });
});
