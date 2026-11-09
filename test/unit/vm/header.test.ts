// The header view-model: the connection chip, where the API URL came from,
// the selected city and the other cities' health, read-only banners, and the
// discovery diagnostics. Pure: built from the city machine only.

import { describe, expect, test } from "bun:test";
import { initialMachine, step, type CityEvent, type CityMachine, type CopyContext } from "../../../src/discovery/city.ts";
import type { Attempt, Endpoint, NoEndpoint } from "../../../src/discovery/resolve.ts";
import type { GcError } from "../../../src/gc/errors.ts";
import type { CityInfo } from "../../../src/gc/types.gen.ts";
import { err, ok } from "../../../src/result.ts";
import { SOURCE_LABELS, headerModel } from "../../../src/vm/header.ts";
import { errorText } from "../../../src/vm/errorText.ts";

const OK_ATTEMPT: Attempt = { source: "supervisor-config", outcome: "ok", url: "http://127.0.0.1:9100", version: "1.2.3" };
const ENDPOINT: Endpoint = {
  url: "http://127.0.0.1:9100", source: "supervisor-config", version: "1.2.3", gcBin: "gc",
  attempts: [
    { source: "setting", outcome: "absent", detail: "no apiUrl setting" },
    { source: "gc-reported", outcome: "absent", detail: "gc supervisor status --json reports no api_url" },
    OK_ATTEMPT,
  ],
};
const city = (name: string, running: boolean, extra: Partial<CityInfo> = {}): CityInfo => ({ name, path: `/c/${name}`, running, ...extra });
const cities = (...items: CityInfo[]): CityEvent => ({ type: "cities", result: ok({ items, unreadable: [], total: items.length }) });
const resolved: CityEvent = { type: "resolved", result: ok(ENDPOINT) };
const UNPINNED: CopyContext = { pinned: null, lastSelection: null };
const machine = (copy: CopyContext, ...events: CityEvent[]): CityMachine => events.reduce(step, initialMachine(copy));
const header = (copy: CopyContext, ...events: CityEvent[]) => headerModel(machine(copy, ...events));

test("source labels", () => {
  expect(SOURCE_LABELS).toEqual({
    setting: "apiUrl setting", "gc-reported": "gc supervisor status", "supervisor-config": "~/.gc/supervisor.toml", default: "built-in default",
  });
});

describe("the chip", () => {
  test("discovering and listing are busy", () => {
    expect(header(UNPINNED).chip).toEqual({ tone: "busy", text: "looking for gc" });
    expect(header(UNPINNED, resolved).chip).toEqual({ tone: "busy", text: "loading cities from http://127.0.0.1:9100" });
  });

  test("connected, with where the URL came from", () => {
    const h = header(UNPINNED, resolved, cities(city("alpha", true)));
    expect(h.chip).toEqual({ tone: "ok", text: "connected" });
    expect(h.endpoint).toBe("gc 1.2.3 at http://127.0.0.1:9100 (from ~/.gc/supervisor.toml)");
    expect(h.city).toBe("alpha");
    expect(h.banners).toEqual([]);
  });

  test("gc not reachable at <url> (source), naming the first candidate tried and how many more", () => {
    const failure: NoEndpoint = {
      reason: "none-reachable",
      attempts: [
        { source: "setting", outcome: "unreachable", url: "http://127.0.0.1:9443", error: { kind: "unreachable", url: "http://127.0.0.1:9443/health", cause: "refused" } },
        { source: "gc-reported", outcome: "absent", detail: "gc supervisor status --json reports no api_url" },
        { source: "default", outcome: "unreachable", url: "http://127.0.0.1:8372", error: { kind: "timeout", url: "http://127.0.0.1:8372/health", ms: 5000 } },
      ],
    };
    const h = header(UNPINNED, { type: "resolved", result: err(failure) });
    expect(h.chip).toEqual({ tone: "error", text: "gc not reachable at http://127.0.0.1:9443 (apiUrl setting); 1 more tried" });
    expect(h.endpoint).toBeNull();
    expect(h.canRetry).toBe(true);
    expect(h.diagnostics).toEqual([
      "apiUrl setting: http://127.0.0.1:9443 unreachable: cannot reach http://127.0.0.1:9443/health: refused",
      "gc supervisor status: gc supervisor status --json reports no api_url",
      "built-in default: http://127.0.0.1:8372 unreachable: no answer from http://127.0.0.1:8372/health within 5 s",
    ]);
  });

  test("a refused non-loopback URL names it and its source", () => {
    const error: GcError = { kind: "not-loopback", url: "http://10.0.0.5:8372" };
    const failure: NoEndpoint = {
      reason: "refused", source: "setting", error,
      attempts: [{ source: "setting", outcome: "refused", url: "http://10.0.0.5:8372", error }],
    };
    const h = header(UNPINNED, { type: "resolved", result: err(failure) });
    expect(h.chip).toEqual({ tone: "error", text: "refusing http://10.0.0.5:8372 (apiUrl setting): only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed" });
    expect(h.diagnostics).toEqual(["apiUrl setting: http://10.0.0.5:8372 refused: only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed"]);
  });

  test("an unreadable source names the file and line", () => {
    const error: GcError = { kind: "supervisor-config", path: "/home/u/.gc/supervisor.toml", line: 2, issue: "port must be a whole number" };
    const failure: NoEndpoint = { reason: "invalid", source: "supervisor-config", error, attempts: [] };
    expect(header(UNPINNED, { type: "resolved", result: err(failure) }).chip).toEqual({
      tone: "error", text: "cannot use ~/.gc/supervisor.toml: /home/u/.gc/supervisor.toml line 2: port must be a whole number",
    });
  });

  test("cities-failed: unreachable, gc too old, or the error", () => {
    const fail = (error: GcError) => header(UNPINNED, resolved, { type: "cities", result: err(error) }).chip;
    expect(fail({ kind: "unreachable", url: "http://127.0.0.1:9100/v0/cities", cause: "refused" })).toEqual({
      tone: "error", text: "gc not reachable at http://127.0.0.1:9100 (~/.gc/supervisor.toml)",
    });
    expect(fail({ kind: "api-missing", operationId: "get-v0-cities" })).toEqual({ tone: "error", text: "gc too old (needs get-v0-cities)" });
    expect(fail({ kind: "decode", operationId: "get-v0-cities", path: "total", issues: ["total: expected number"] })).toEqual({
      tone: "error", text: "unreadable answer to get-v0-cities at total: total: expected number",
    });
  });

  test("choose a city; gc manages none", () => {
    const h = header(UNPINNED, resolved, cities(city("alpha", true), city("beta", false), city("gamma", true)));
    expect(h.chip).toEqual({ tone: "warn", text: "choose a city" });
    expect(h.choices).toEqual([{ name: "alpha", label: "running" }, { name: "beta", label: "stopped" }, { name: "gamma", label: "running" }]);
    expect(header(UNPINNED, resolved, cities()).chip).toEqual({ tone: "warn", text: "gc manages no cities" });
  });

  test("city stopped (status), with gc's error", () => {
    const h = header({ pinned: "alpha", lastSelection: null }, resolved, cities(city("alpha", false, { status: "init_failed", error: "dolt: port in use" })));
    expect(h.chip).toEqual({ tone: "warn", text: "city stopped (init_failed): dolt: port in use" });
    expect(h.city).toBe("alpha (pinned)");
  });

  test("city stopped as answered by a city call", () => {
    const m = step(machine(UNPINNED, resolved, cities(city("alpha", true))), { type: "city-error", city: "alpha", error: { kind: "city-not-running", city: "alpha" } });
    expect(headerModel(m).chip).toEqual({ tone: "warn", text: "city stopped (gc answered: not running)" });
  });

  test("a pinned city gc does not list", () => {
    const h = header({ pinned: "ghost", lastSelection: null }, resolved, cities(city("alpha", true)));
    expect(h.chip).toEqual({ tone: "error", text: 'city "ghost" is not registered with gc at http://127.0.0.1:9100' });
    expect(h.choices).toBeNull();
  });

  test("an unpinned copy whose city disappeared can choose another", () => {
    const h = header(UNPINNED, resolved, cities(city("alpha", true)), cities(city("beta", true)));
    expect(h.chip.text).toBe('city "alpha" is not registered with gc at http://127.0.0.1:9100');
    expect(h.choices).toEqual([{ name: "beta", label: "running" }]);
  });
});

describe("notices: read-only banner and chips", () => {
  const withError = (error: Parameters<typeof step>[1] & { type: "city-error" }) =>
    headerModel(step(machine(UNPINNED, resolved, cities(city("alpha", true))), error));

  test("write-grant-required: a read-only banner, chip says read-only", () => {
    const h = withError({ type: "city-error", city: "alpha", error: { kind: "write-grant-required", status: 401, detail: "missing X-GC-City-Write grant" } });
    expect(h.chip).toEqual({ tone: "warn", text: "connected, read-only" });
    expect(h.banners).toEqual([
      "This city requires signed write grants; the Herdr mod does not mint them, so it is read-only here (gc: missing X-GC-City-Write grant).",
    ]);
  });

  test("read-grant-required: the city's data cannot be read; the chip says so", () => {
    const h = withError({ type: "city-error", city: "alpha", error: { kind: "read-grant-required", status: 401, detail: "missing X-GC-City-Read grant" } });
    expect(h.chip).toEqual({ tone: "error", text: "read grant required" });
    expect(h.banners).toEqual([
      "This city requires signed read grants; the Herdr mod does not mint them, so it cannot show this city's data (gc: missing X-GC-City-Read grant).",
    ]);
  });

  test("read-only server", () => {
    const h = withError({ type: "city-error", city: "alpha", error: { kind: "read-only", detail: "read_only: bound to 0.0.0.0" } });
    expect(h.chip).toEqual({ tone: "warn", text: "read-only server" });
    expect(h.banners).toEqual(["gc serves this API read-only (read_only: bound to 0.0.0.0)."]);
  });

  test("gc too old (needs <op>)", () => {
    const h = withError({ type: "city-error", city: "alpha", error: { kind: "api-missing", operationId: "get-v0-city-by-city-name-pending" } });
    expect(h.chip).toEqual({ tone: "warn", text: "gc too old (needs get-v0-city-by-city-name-pending)" });
    expect(h.banners).toEqual(["gc 1.2.3 lacks get-v0-city-by-city-name-pending: update gc."]);
  });
});

test("host errors outside the machine are banners", () => {
  const m = machine(UNPINNED, resolved, cities(city("alpha", true)));
  expect(headerModel(m, [{ kind: "host-call", api: 'localStorage.setItem("city")', cause: "disk full" }]).banners).toEqual([
    'Herdr: localStorage.setItem("city") failed: disk full.',
  ]);
});

describe("other cities and unreadable entries", () => {
  test("the other cities' health, from the same list", () => {
    const h = header({ pinned: "alpha", lastSelection: null }, resolved, cities(city("alpha", true), city("beta", false, { status: "stopped" }), city("gamma", true)));
    expect(h.others).toEqual([
      { name: "beta", running: false, label: "stopped" },
      { name: "gamma", running: true, label: "running" },
    ]);
  });

  test("unreadable city entries are counted in a banner and listed in diagnostics", () => {
    const event: CityEvent = {
      type: "cities",
      result: ok({
        items: [city("alpha", true)], total: 2,
        unreadable: [{ index: 1, id: "beta", error: { kind: "decode", operationId: "get-v0-cities", path: "items[1].running", issues: ["items[1].running: expected boolean"] } }],
      }),
    };
    const h = header(UNPINNED, resolved, event);
    expect(h.banners).toEqual(["1 city entry from gc could not be read (see diagnostics)."]);
    expect(h.diagnostics.at(-1)).toBe("unreadable city beta (items[1]): unreadable answer to get-v0-cities at items[1].running: items[1].running: expected boolean");
  });

  test("diagnostics list every discovery attempt of a connected copy", () => {
    expect(header(UNPINNED, resolved, cities(city("alpha", true))).diagnostics).toEqual([
      "apiUrl setting: no apiUrl setting",
      "gc supervisor status: gc supervisor status --json reports no api_url",
      "~/.gc/supervisor.toml: http://127.0.0.1:9100 ok (gc 1.2.3)",
    ]);
  });
});

describe("errorText covers every GcError kind", () => {
  const cases: [GcError, string][] = [
    [{ kind: "unreachable", url: "u", cause: "c" }, "cannot reach u: c"],
    [{ kind: "timeout", url: "u", ms: 30000 }, "no answer from u within 30 s"],
    [{ kind: "too-large", url: "u", direction: "response", limitBytes: 8 }, "the response at u is over herdr's 8 byte limit"],
    [{ kind: "http", status: 500, problem: { title: "Internal", detail: "boom" } as never }, "gc answered 500: boom"],
    [{ kind: "http", status: 502, problem: null, raw: "bad gateway" }, "gc answered 502: bad gateway"],
    [{ kind: "csrf-rejected" }, "gc refused a change without X-GC-Request (a bug in the mod)"],
    [{ kind: "read-only", detail: "read_only: x" }, "gc serves this API read-only (read_only: x)"],
    [{ kind: "write-grant-required", status: 403, detail: "write grant rejected" }, "this city requires a signed write grant (write grant rejected)"],
    [{ kind: "read-grant-required", status: 401, detail: "missing X-GC-City-Read grant" }, "this city requires a signed read grant (missing X-GC-City-Read grant)"],
    [{ kind: "city-not-running", city: "alpha" }, 'city "alpha" is not running'],
    [{ kind: "api-missing", operationId: "op" }, "gc too old (needs op)"],
    [{ kind: "decode", operationId: "op", path: "", issues: ["a", "b"] }, "unreadable answer to op: a; b"],
    [{ kind: "outcome-unknown", requestId: null, operationId: "op", cause: "timeout" }, "outcome of op unknown (timeout)"],
    [{ kind: "exec", argv: ["gc", "x"], code: 2, stderr: "bad" }, "gc x exited with code 2: bad"],
    [{ kind: "exec", argv: ["gc", "x"], code: null, stderr: "not found" }, "gc x did not run: not found"],
    [{ kind: "host-incompatible", missing: ["exec", "home"] }, "this herdr-app lacks exec, home"],
    [{ kind: "host-decode", api: "props()", path: "city", issues: ["city: expected string"] }, "unreadable props() at city: city: expected string"],
    [{ kind: "host-call", api: "readTextFile", cause: "denied" }, "readTextFile failed: denied"],
    [{ kind: "supervisor-config", path: "/p", line: 3, issue: "i" }, "/p line 3: i"],
    [{ kind: "not-loopback", url: "http://x:1" }, "only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed"],
    [{ kind: "attach-not-started", sessionId: "s-1", reason: "wake-refused", detail: "d" }, "terminal for s-1 not opened (wake-refused): d"],
  ];
  for (const [error, text] of cases) test(error.kind, () => expect(errorText(error)).toBe(text));

  test("outcome-failed names the request", () => {
    const e = { kind: "outcome-failed", requestId: "r-1", operation: "session.submit", payload: { error_code: "x", error_message: "y" } } as unknown as GcError;
    expect(errorText(e)).toMatch(/^request r-1 \(session\.submit\) failed/);
  });
});

describe("live connection, needs-you count and data age (a running city's shared store)", () => {
  const running = machine(UNPINNED, resolved, cities(city("alpha", true)));
  const NOW = 5_000_000;
  const live = (connection: Parameters<typeof headerModel>[2] extends infer L ? L extends { connection: infer C } ? C : never : never, extra = {}) =>
    headerModel(running, [], { connection, now: NOW, needsYou: 0, age: null, ...extra });

  test("reconnecting in N s, with the cause", () => {
    const h = live({ kind: "backing-off", attempt: 2, retryAt: NOW + 3_400, cause: { kind: "unreachable", url: "http://127.0.0.1:9100/v0/city/alpha/events", cause: "refused" } });
    expect(h.chip).toEqual({ tone: "warn", text: "reconnecting in 4 s (cannot reach http://127.0.0.1:9100/v0/city/alpha/events: refused)" });
    expect(h.canRetry).toBe(true);
  });

  test("connecting until the city's first answer; connected after", () => {
    expect(live({ kind: "connecting" }).chip).toEqual({ tone: "busy", text: "connecting" });
    expect(live({ kind: "connected" }).chip).toEqual({ tone: "ok", text: "connected" });
  });

  test("needs-you count and data age", () => {
    const h = live({ kind: "connected" }, { needsYou: 2, age: "data 1 s old" });
    expect(h.needsYou).toBe("2 need you");
    expect(h.age).toBe("data 1 s old");
    expect(live({ kind: "connected" }, { needsYou: 1 }).needsYou).toBe("1 needs you");
    expect(live({ kind: "connected" }).needsYou).toBeNull();
  });
});

test("gc-supplied city names, statuses and errors are cleaned", () => {
  const h = header({ pinned: "al\u0007pha", lastSelection: null }, resolved, cities(
    city("al\u0007pha", false, { status: "init\u001b[31m_failed", error: "dolt:\r\nport in use\u0000" }),
    city("be‮ta", false, { status: "stop\u0007ped" }),
  ));
  expect(h.chip).toEqual({ tone: "warn", text: "city stopped (init_failed): dolt: port in use" });
  expect(h.city).toBe("alpha (pinned)");
  expect(h.others).toEqual([{ name: "beta", running: false, label: "stopped" }]);
});
