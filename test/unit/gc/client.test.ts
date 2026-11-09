// The gc client against herdr-app's constrained fetch (design §5, §7.3, §9):
// options {method, headers, body} only; the response has status/ok/url/text()
// and no headers; a fixed 30 s timeout and an 8 MiB cap surface as rejected
// promises with herdr's own messages (gpui-kit shell fetch.rs).

import { describe, expect, test } from "bun:test";
import {
  HERDR_FETCH_MAX_BODY_BYTES, HERDR_FETCH_TIMEOUT_MS, X_GC_REQUEST, createGcClient,
  type GcClient, type HostFetch, type HostRequest,
} from "../../../src/gc/client.ts";
import type { OutcomeUnknownCause } from "../../../src/gc/errors.ts";
import { MOD_VERSION } from "../../../src/version.ts";

interface Call {
  url: string;
  init: HostRequest;
}

type Reply = { status: number; body: string } | { throws: unknown } | { rejects: unknown; afterMs?: number };

/** A herdr-shaped fetch that records calls and plays scripted replies, with a fake clock. */
function fakeHost(replies: Reply[]) {
  const calls: Call[] = [];
  let clock = 1_000_000;
  const fetch: HostFetch = (url, init) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("unexpected fetch");
    if ("throws" in r) throw r.throws;
    if ("rejects" in r) {
      clock += r.afterMs ?? 5;
      return Promise.reject(r.rejects);
    }
    clock += 5;
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, url, text: () => Promise.resolve(r.body) });
  };
  return { calls, fetch, now: () => clock };
}

function client(replies: Reply[]): { c: GcClient; calls: Call[] } {
  const host = fakeHost(replies);
  const made = createGcClient({ baseUrl: "http://127.0.0.1:8372", fetch: host.fetch, now: host.now });
  if (!made.ok) throw new Error("client");
  return { c: made.value, calls: host.calls };
}

const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
const OK = json(200, { status: "ok", id: "s-1" });
const SESSION = {
  id: "s-1", template: "worker", session_name: "s-s-1", title: "t", provider: "sh", state: "active",
  running: true, attached: false, created_at: "2026-11-09T00:00:00Z",
};

describe("loopback only (design §9)", () => {
  const host = fakeHost([]);
  const make = (baseUrl: string) => createGcClient({ baseUrl, fetch: host.fetch });

  test("accepts loopback literals with a port, with or without a trailing slash", () => {
    for (const url of ["http://127.0.0.1:8372", "http://localhost:9443/", "http://[::1]:8372"]) {
      const r = make(url);
      expect(r.ok).toBe(true);
      expect(r.ok && r.value.baseUrl).toBe(url.replace(/\/$/, ""));
    }
  });

  test("refuses anything else with not-loopback", () => {
    for (const url of [
      "http://10.0.0.5:8372", "http://cherry.tail.ts.net:8444", "https://gascity.com", "http://127.0.0.1.evil.com:80",
      "http://127.0.0.2:8372", "http://user@127.0.0.1:8372", "http://127.0.0.1:8372/v0", "ftp://127.0.0.1:21", "",
    ]) {
      expect(make(url)).toEqual({ ok: false, error: { kind: "not-loopback", url } });
    }
  });
});

describe("request building", () => {
  test("a read: GET, encoded path params, exploded array query, no CSRF or idempotency header, no body", async () => {
    const { c, calls } = client([json(200, { items: [] })]);
    await c.call("get-v0-city-by-city-name-work-ready", {
      path: { cityName: "my city" },
      query: { limit: 50, status: "in_progress", exclude_type: ["session", "message"], assignee: undefined },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "http://127.0.0.1:8372/v0/city/my%20city/work/ready?limit=50&status=in_progress&exclude_type=session&exclude_type=message",
    );
    expect(calls[0]!.init).toEqual({ method: "GET", headers: { Accept: "application/json, application/problem+json" } });
  });

  test("a mutation sends X-GC-Request: herdr-gascity/<version>", async () => {
    const { c, calls } = client([json(200, { status: "ok" })]);
    await c.call("post-v0-city-by-city-name-bead-by-id-reopen", { path: { cityName: "c", id: "fe-1" } });
    expect(X_GC_REQUEST).toBe(`herdr-gascity/${MOD_VERSION}`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers["X-GC-Request"]).toBe(X_GC_REQUEST);
    expect(calls[0]!.init.headers["Idempotency-Key"]).toBeUndefined();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  test("Idempotency-Key is sent on an operation that declares it", async () => {
    const { c, calls } = client([OK]);
    await c.call("post-v0-city-by-city-name-session-by-id-wake", { path: { cityName: "c", id: "s-1" }, idempotencyKey: "k-1" });
    expect(calls[0]!.init.headers).toEqual({
      Accept: "application/json, application/problem+json", "X-GC-Request": X_GC_REQUEST, "Idempotency-Key": "k-1",
    });
  });

  test("a JSON body gets Content-Type and is serialized once", async () => {
    const { c, calls } = client([json(200, { status: "slung", target: "worker" })]);
    await c.call("post-v0-city-by-city-name-sling", { path: { cityName: "c" }, body: { target: "worker", bead: "fe-1" } });
    expect(calls[0]!.init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe('{"target":"worker","bead":"fe-1"}');
  });

  test("a request body over herdr's 8 MiB cap is refused before sending", async () => {
    const { c, calls } = client([]);
    const r = await c.call("create-bead", {
      path: { cityName: "c" }, body: { title: "t", description: "é".repeat(HERDR_FETCH_MAX_BODY_BYTES / 2) }, idempotencyKey: "k",
    });
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ ok: false, error: { kind: "too-large", url: "http://127.0.0.1:8372/v0/city/c/beads", direction: "request", limitBytes: HERDR_FETCH_MAX_BODY_BYTES } });
  });
});

describe("responses", () => {
  test("2xx decodes to the typed model", async () => {
    const { c } = client([json(200, SESSION)]);
    const r = await c.call("get-v0-city-by-city-name-session-by-id", { path: { cityName: "c", id: "s-1" }, query: { peek: true, peek_lines: 40 } });
    expect(r.ok && r.value.id).toBe("s-1");
  });

  test("a list decodes element by element", async () => {
    const { c } = client([json(200, { items: [SESSION, { id: "s-2" }], total: 2 })]);
    const r = await c.call("get-v0-city-by-city-name-sessions", { path: { cityName: "c" }, query: { limit: 500 } });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.items.map((s) => s.id)).toEqual(["s-1"]);
    expect(r.value.unreadable.map((u) => [u.index, u.id, u.error.path])).toEqual([[1, "s-2", "items[1].title"]]);
    expect(r.value.total).toBe(2);
    expect(r.value.partial_errors).toEqual([]);
  });

  test("a 2xx body that is not JSON is a decode error", async () => {
    const { c } = client([{ status: 200, body: "<html>" }]);
    const r = await c.call("get-health", { path: {} });
    expect(r.ok ? null : r.error).toMatchObject({ kind: "decode", operationId: "get-health", path: "" });
  });

  test("a 2xx body missing a required field is a decode error naming the path", async () => {
    const { c } = client([json(200, { status: "ok", version: "1", uptime_sec: 1, cities_total: 1 })]);
    const r = await c.call("get-health", { path: {} });
    expect(r.ok ? null : r.error).toEqual({
      kind: "decode", operationId: "get-health", path: "cities_running", issues: ["cities_running: missing required number"],
    });
  });

  test("non-2xx goes through the problem mapping", async () => {
    const { c } = client([json(403, { status: 403, title: "Forbidden", detail: "csrf: X-GC-Request header required on mutation endpoints" })]);
    const r = await c.call("post-v0-city-by-city-name-session-by-id-pin", { path: { cityName: "c", id: "s" } });
    expect(r).toEqual({ ok: false, error: { kind: "csrf-rejected" } });
  });
});

describe("transport failures (herdr fetch rejections)", () => {
  const WAKE = { path: { cityName: "c", id: "s-1" }, idempotencyKey: "k-1" } as const;
  const health = (reply: Reply) => client([reply]).c.call("get-health", { path: {} });

  test("connection refused -> unreachable with herdr's message", async () => {
    const cause = "fetching http://127.0.0.1:8372/health failed: error sending request for url (http://127.0.0.1:8372/health)";
    expect(await health({ rejects: new Error(cause) }))
      .toEqual({ ok: false, error: { kind: "unreachable", url: "http://127.0.0.1:8372/health", cause } });
  });

  test("a rejection that took herdr's whole 30 s timeout -> timeout", async () => {
    const r = await health({ rejects: new Error("fetching http://127.0.0.1:8372/health failed: error sending request"), afterMs: HERDR_FETCH_TIMEOUT_MS });
    expect(r).toEqual({ ok: false, error: { kind: "timeout", url: "http://127.0.0.1:8372/health", ms: HERDR_FETCH_TIMEOUT_MS } });
  });

  test("a rejection whose message says it timed out -> timeout, however fast", async () => {
    const r = await health({ rejects: new Error("reading response from http://127.0.0.1:8372/health failed: operation timed out") });
    expect(r.ok ? null : r.error.kind).toBe("timeout");
  });

  test("herdr's 8 MiB response cap -> too-large", async () => {
    const r = await health({ rejects: new Error("response body from http://127.0.0.1:8372/health exceeded the 8388608 byte limit") });
    expect(r).toEqual({ ok: false, error: { kind: "too-large", url: "http://127.0.0.1:8372/health", direction: "response", limitBytes: HERDR_FETCH_MAX_BODY_BYTES } });
  });

  test("a synchronous throw from fetch is classified, not thrown", async () => {
    const r = await health({ throws: new TypeError("HTTP request GET http://127.0.0.1:8372/health is not granted") });
    expect(r.ok ? null : r.error.kind).toBe("unreachable");
  });

  test("a rejection with a non-Error value keeps its text", async () => {
    expect(await health({ rejects: "socket closed" }))
      .toEqual({ ok: false, error: { kind: "unreachable", url: "http://127.0.0.1:8372/health", cause: "socket closed" } });
  });

  test("a mutation that times out, loses its connection or overflows is outcome-unknown", async () => {
    const cases: [Reply, OutcomeUnknownCause][] = [
      [{ rejects: new Error("x"), afterMs: HERDR_FETCH_TIMEOUT_MS }, "timeout"],
      [{ rejects: new Error("fetching … failed: connection reset") }, "unreachable"],
      [{ rejects: new Error("response body from … exceeded the 8388608 byte limit") }, "too-large"],
    ];
    for (const [reply, cause] of cases) {
      const r = await client([reply]).c.call("post-v0-city-by-city-name-session-by-id-wake", WAKE);
      expect(r).toEqual({
        ok: false,
        error: { kind: "outcome-unknown", requestId: null, operationId: "post-v0-city-by-city-name-session-by-id-wake", cause },
      });
    }
  });

  test("text() rejecting is handled like a fetch rejection", async () => {
    const host = fakeHost([]);
    const fetch: HostFetch = (url) =>
      Promise.resolve({ status: 200, ok: true, url, text: () => Promise.reject(new Error("body read failed")) });
    const made = createGcClient({ baseUrl: "http://127.0.0.1:8372", fetch, now: host.now });
    const r = made.ok ? await made.value.call("get-health", { path: {} }) : null;
    expect(r).toEqual({ ok: false, error: { kind: "unreachable", url: "http://127.0.0.1:8372/health", cause: "body read failed" } });
  });
});

describe("no automatic retries (design §7.3)", () => {
  test("a failed mutation is sent exactly once", async () => {
    for (const reply of [json(503, { status: 503, title: "Service Unavailable" }), { rejects: new Error("reset") } as Reply]) {
      const { c, calls } = client([reply, OK, OK]);
      await c.call("post-v0-city-by-city-name-session-by-id-kill", { path: { cityName: "c", id: "s" }, idempotencyKey: "k", query: { force: true } });
      expect(calls).toHaveLength(1);
    }
  });

  test("a failed read is sent exactly once (backoff belongs to the sync engine)", async () => {
    const { c, calls } = client([{ rejects: new Error("refused") }, OK]);
    await c.call("get-v0-cities", { path: {} });
    expect(calls).toHaveLength(1);
  });
});
