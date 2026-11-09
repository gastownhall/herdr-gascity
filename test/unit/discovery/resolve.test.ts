// Endpoint resolution: the first candidate that answers GET /health wins, in
// the order setting → gc-reported URL → supervisor.toml → default. Every
// candidate's outcome is kept, so the header and diagnostics show where the
// URL came from and what was tried. Loopback only.

import { describe, expect, test } from "bun:test";
import type { HostFetch } from "../../../src/gc/client.ts";
import type { GcError } from "../../../src/gc/errors.ts";
import {
  DEFAULT_API_URL, HEALTH_PROBE_MS, HEALTH_QUEUE_MS, resolveEndpoint, type ResolveHost,
} from "../../../src/discovery/resolve.ts";
import { err, ok, type Result } from "../../../src/result.ts";
import { FakeClock, flush } from "../sync/fakes.ts";

const HEALTH = { status: "ok", version: "1.2.3", build_id: "b1", uptime_sec: 5, cities_total: 1, cities_running: 1 };
const CONFIG_PATH = "/home/u/.gc/supervisor.toml";

type Reply = "health" | "refused" | "hang" | { status: number; body: string };

interface Setup {
  settings?: unknown;
  gcStatus?: Result<string, GcError>;
  config?: Result<string | null, GcError>;
  /** Reply per base URL; anything not listed refuses the connection. */
  replies?: Record<string, Reply>;
  /** Whether sleep(ms) resolves (true: every probe deadline passes at once). */
  deadlinesPass?: boolean;
}

function host(setup: Setup) {
  const fetched: string[] = [];
  const execs: string[] = [];
  const sleeps: number[] = [];
  let configReads = 0;
  let drops = 0;
  const fetch: HostFetch = (url) => {
    fetched.push(url);
    const base = Object.keys(setup.replies ?? {}).find((b) => url.startsWith(`${b}/`));
    const reply = base ? setup.replies![base]! : "refused";
    if (reply === "refused") return Promise.reject(new Error("error sending request: Connection refused (os error 111)"));
    if (reply === "hang") return new Promise(() => {});
    const r = reply === "health" ? { status: 200, body: JSON.stringify(HEALTH) } : reply;
    return Promise.resolve({ status: r.status, ok: r.status < 300, url, text: () => Promise.resolve(r.body) });
  };
  const h: ResolveHost = {
    settings: () => setup.settings,
    gcStatus: (gcBin) => {
      execs.push(gcBin);
      return Promise.resolve(setup.gcStatus ?? ok('{"running":true}'));
    },
    readSupervisorConfig: () => {
      configReads++;
      const r = setup.config ?? ok(null);
      return Promise.resolve(r.ok ? ok({ path: CONFIG_PATH, text: r.value }) : r);
    },
    fetch,
    probeFetch: () => ({ fetch, drop: () => { drops++; return 0; }, sent: Promise.resolve() }),
    sleep: (ms) => {
      sleeps.push(ms);
      // A passing deadline fires after the immediate replies have settled.
      return setup.deadlinesPass ? new Promise((r) => setTimeout(r, 0)) : new Promise(() => {});
    },
  };
  return { h, fetched, execs, sleeps, configReads: () => configReads, drops: () => drops };
}

const resolve = async (setup: Setup) => {
  const t = host(setup);
  return { r: await resolveEndpoint(t.h), ...t };
};

describe("resolution order (first hit wins) and the source shown", () => {
  test("default: http://127.0.0.1:8372", () => {
    expect(DEFAULT_API_URL).toBe("http://127.0.0.1:8372");
    expect(HEALTH_PROBE_MS).toBe(5_000);
  });

  test("1. the apiUrl setting wins and nothing else is consulted", async () => {
    const { r, execs, configReads, fetched } = await resolve({
      settings: { apiUrl: "http://127.0.0.1:9443/" },
      replies: { "http://127.0.0.1:9443": "health", "http://127.0.0.1:8372": "health" },
    });
    expect(r.ok && r.value).toMatchObject({ url: "http://127.0.0.1:9443", source: "setting", version: "1.2.3", gcBin: "gc" });
    expect(r.ok && r.value.attempts).toEqual([{ source: "setting", outcome: "ok", url: "http://127.0.0.1:9443", version: "1.2.3" }]);
    expect(fetched).toEqual(["http://127.0.0.1:9443/health"]);
    expect(execs).toEqual([]);
    expect(configReads()).toBe(0);
  });

  test("2. gc's reported api_url, from the configured gcBin, when gc reports one", async () => {
    const { r, execs, configReads } = await resolve({
      settings: { gcBin: "/opt/gc/bin/gc" },
      gcStatus: ok('{"running":true,"api_url":"http://localhost:8400"}'),
      replies: { "http://localhost:8400": "health" },
    });
    expect(r.ok && r.value).toMatchObject({ url: "http://localhost:8400", source: "gc-reported", gcBin: "/opt/gc/bin/gc" });
    expect(r.ok && r.value.attempts).toEqual([
      { source: "setting", outcome: "absent", detail: "no apiUrl setting" },
      { source: "gc-reported", outcome: "ok", url: "http://localhost:8400", version: "1.2.3" },
    ]);
    expect(execs).toEqual(["/opt/gc/bin/gc"]);
    expect(configReads()).toBe(0);
  });

  test("3. supervisor.toml when gc does not report a URL (today's gc)", async () => {
    const { r } = await resolve({
      config: ok("[supervisor]\nport = 9100\nbind = \"0.0.0.0\"\n"),
      replies: { "http://127.0.0.1:9100": "health" },
    });
    expect(r.ok && r.value).toMatchObject({ url: "http://127.0.0.1:9100", source: "supervisor-config" });
    expect(r.ok && r.value.attempts).toEqual([
      { source: "setting", outcome: "absent", detail: "no apiUrl setting" },
      { source: "gc-reported", outcome: "absent", detail: "gc supervisor status --json reports no api_url" },
      { source: "supervisor-config", outcome: "ok", url: "http://127.0.0.1:9100", version: "1.2.3" },
    ]);
  });

  test("4. the default when there is no supervisor.toml", async () => {
    const { r } = await resolve({ replies: { "http://127.0.0.1:8372": "health" } });
    expect(r.ok && r.value).toMatchObject({ url: "http://127.0.0.1:8372", source: "default" });
    expect(r.ok && r.value.attempts.map((a) => [a.source, a.outcome])).toEqual([
      ["setting", "absent"], ["gc-reported", "absent"], ["supervisor-config", "absent"], ["default", "ok"],
    ]);
    expect(r.ok && r.value.attempts[2]).toEqual({ source: "supervisor-config", outcome: "absent", detail: `${CONFIG_PATH} does not exist` });
  });

  test("a supervisor.toml without bind/port gives gc's defaults, from the file", async () => {
    const { r } = await resolve({ config: ok("[events.export]\n"), replies: { "http://127.0.0.1:8372": "health" } });
    expect(r.ok && r.value).toMatchObject({ url: "http://127.0.0.1:8372", source: "supervisor-config" });
  });

  test("gc that cannot be run (not on PATH, non-zero exit, bad output) is recorded and skipped", async () => {
    const execError: GcError = { kind: "exec", argv: ["gc", "supervisor", "status", "--json"], code: null, stderr: "No such file or directory" };
    const { r } = await resolve({ gcStatus: err(execError), replies: { "http://127.0.0.1:8372": "health" } });
    expect(r.ok && r.value.source).toBe("default");
    expect(r.ok && r.value.attempts[1]).toEqual({ source: "gc-reported", outcome: "unavailable", error: execError });

    const bad = await resolve({ gcStatus: ok("garbage"), replies: { "http://127.0.0.1:8372": "health" } });
    expect(bad.r.ok && bad.r.value.attempts[1]).toMatchObject({ source: "gc-reported", outcome: "unavailable", error: { kind: "decode" } });
  });
});

describe("/health probing and fallback", () => {
  test("an unreachable candidate falls back to the next, and both are recorded", async () => {
    const { r, fetched } = await resolve({
      settings: { apiUrl: "http://127.0.0.1:9443" },
      replies: { "http://127.0.0.1:8372": "health" },
    });
    expect(r.ok && r.value.source).toBe("default");
    expect(r.ok && r.value.attempts[0]).toEqual({
      source: "setting", outcome: "unreachable", url: "http://127.0.0.1:9443",
      error: { kind: "unreachable", url: "http://127.0.0.1:9443/health", cause: "error sending request: Connection refused (os error 111)" },
    });
    expect(fetched).toEqual(["http://127.0.0.1:9443/health", "http://127.0.0.1:8372/health"]);
  });

  test("a probe that does not answer within 5 s is a timeout, and the next candidate is tried", async () => {
    const { r, sleeps, drops } = await resolve({
      settings: { apiUrl: "http://127.0.0.1:9443" },
      replies: { "http://127.0.0.1:9443": "hang", "http://127.0.0.1:8372": "health" },
      deadlinesPass: true,
    });
    expect(sleeps).toContain(5_000);
    // the lost probe's request was sent (it left the queue): there is nothing to drop; it stays in flight until herdr settles it
    expect(drops()).toBe(0);
    expect(r.ok && r.value.attempts[0]).toEqual({
      source: "setting", outcome: "unreachable", url: "http://127.0.0.1:9443",
      error: { kind: "timeout", url: "http://127.0.0.1:9443/health", ms: 5_000 },
    });
  });

  test("something on the port that is not gc's /health is not an endpoint", async () => {
    const { r } = await resolve({
      settings: { apiUrl: "http://127.0.0.1:3000" },
      replies: { "http://127.0.0.1:3000": { status: 200, body: "<html>vite</html>" }, "http://127.0.0.1:8372": "health" },
    });
    expect(r.ok && r.value.attempts[0]).toMatchObject({ source: "setting", outcome: "unreachable", error: { kind: "decode", operationId: "get-health" } });
    expect(r.ok && r.value.source).toBe("default");
  });

  test("a gc too old for /health is recorded as api-missing", async () => {
    const { r } = await resolve({ replies: { "http://127.0.0.1:8372": { status: 404, body: "404 page not found" } } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.attempts.at(-1)).toMatchObject({ source: "default", outcome: "unreachable", error: { kind: "api-missing", operationId: "get-health" } });
  });

  test("nothing answers: none-reachable, with every attempt", async () => {
    const { r } = await resolve({ settings: { apiUrl: "http://127.0.0.1:9443" }, config: ok("[supervisor]\nport = 9100\n") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.reason).toBe("none-reachable");
    expect(r.error.attempts.map((a) => [a.source, a.outcome])).toEqual([
      ["setting", "unreachable"], ["gc-reported", "absent"], ["supervisor-config", "unreachable"], ["default", "unreachable"],
    ]);
  });

  test("a candidate equal to one already probed is not probed twice", async () => {
    const { r, fetched } = await resolve({ settings: { apiUrl: "http://127.0.0.1:8372" } });
    expect(fetched).toEqual(["http://127.0.0.1:8372/health"]);
    expect(!r.ok && r.error.attempts.at(-1)).toEqual({ source: "default", outcome: "absent", detail: "same URL as the apiUrl setting, already tried" });
  });
});

describe("loopback only, and nothing guessed past a source that cannot be read", () => {
  test("a non-loopback apiUrl setting is refused, not probed, and resolution stops", async () => {
    const { r, fetched } = await resolve({ settings: { apiUrl: "http://10.0.0.5:8372" }, replies: { "http://127.0.0.1:8372": "health" } });
    expect(fetched).toEqual([]);
    expect(r).toEqual({
      ok: false,
      error: {
        reason: "refused", source: "setting", error: { kind: "not-loopback", url: "http://10.0.0.5:8372" },
        attempts: [{ source: "setting", outcome: "refused", url: "http://10.0.0.5:8372", error: { kind: "not-loopback", url: "http://10.0.0.5:8372" } }],
      },
    });
  });

  test("a non-loopback URL reported by gc is refused", async () => {
    const { r, fetched } = await resolve({ gcStatus: ok('{"api_url":"http://192.168.1.4:8372"}') });
    expect(fetched).toEqual([]);
    expect(!r.ok && r.error).toMatchObject({ reason: "refused", source: "gc-reported", error: { kind: "not-loopback", url: "http://192.168.1.4:8372" } });
  });

  test("a supervisor.toml bound to a LAN address is refused (gc serves it read-only, and it is not this host's loopback)", async () => {
    const { r } = await resolve({ config: ok('[supervisor]\nbind = "192.168.1.4"\n'), replies: { "http://127.0.0.1:8372": "health" } });
    expect(!r.ok && r.error).toMatchObject({ reason: "refused", source: "supervisor-config", error: { kind: "not-loopback", url: "http://192.168.1.4:8372" } });
  });

  test("a malformed supervisor.toml stops resolution with the parse error: the default is not tried", async () => {
    const { r, fetched } = await resolve({ config: ok("[supervisor]\nport = \"9100\"\n"), replies: { "http://127.0.0.1:8372": "health" } });
    expect(fetched).toEqual([]);
    expect(!r.ok && r.error).toMatchObject({ reason: "invalid", source: "supervisor-config", error: { kind: "supervisor-config", path: CONFIG_PATH, line: 2 } });
  });

  test("a supervisor.toml that cannot be read stops resolution", async () => {
    const readError: GcError = { kind: "host-call", api: "readTextFile", cause: "permission denied" };
    const { r } = await resolve({ config: err(readError), replies: { "http://127.0.0.1:8372": "health" } });
    expect(!r.ok && r.error).toMatchObject({ reason: "invalid", source: "supervisor-config", error: readError });
  });

  test("malformed settings stop resolution before anything runs", async () => {
    const { r, execs, fetched } = await resolve({ settings: { gcBin: "/usr/bin/hc" }, replies: { "http://127.0.0.1:8372": "health" } });
    expect(execs).toEqual([]);
    expect(fetched).toEqual([]);
    expect(!r.ok && r.error).toMatchObject({ reason: "invalid", source: "setting", error: { kind: "host-decode", path: "gcBin" } });
  });
});

/**
 * A host whose /health requests wait in a fetch queue until the test sends
 * them: `send(i)` takes request i out of the queue, `answer(i)` answers it,
 * `drop` rejects the queued ones as the budget does. Sleeps follow a fake clock.
 */
function queuedHost(settings: unknown = { apiUrl: "http://127.0.0.1:9443" }) {
  const clock = new FakeClock();
  const requests: { url: string; sent: () => void; answer: () => void; cancel: () => void; queued: boolean }[] = [];
  let drops = 0;
  const h: ResolveHost = {
    settings: () => settings,
    gcStatus: () => Promise.resolve(ok("{}")),
    readSupervisorConfig: () => Promise.resolve(ok({ path: CONFIG_PATH, text: null })),
    fetch: () => Promise.reject(new Error("not used")),
    probeFetch: () => {
      let markSent!: () => void;
      const sent = new Promise<void>((r) => { markSent = r; });
      const mine: number[] = [];
      return {
        sent,
        fetch: (url) => new Promise((resolve, reject) => {
          mine.push(requests.length);
          const req = {
            url,
            queued: true,
            sent: () => { req.queued = false; markSent(); },
            answer: () => resolve({ status: 200, ok: true, url, text: () => Promise.resolve(JSON.stringify(HEALTH)) }),
            cancel: () => reject(Object.assign(new Error("dropped before it was sent"), { hostElapsedMs: 0, cancelled: "abandoned" })),
          };
          requests.push(req);
        }),
        drop: () => {
          let n = 0;
          for (const i of mine) {
            const r = requests[i]!;
            if (r.queued) {
              r.queued = false;
              r.cancel();
              n++;
            }
          }
          drops += n;
          return n;
        },
      };
    },
    sleep: (ms) => clock.after(ms),
  };
  return { h, clock, requests, drops: () => drops };
}

describe("the /health race runs from when the request is sent, not while it waits in the fetch queue", () => {
  test("a probe that waited 8 s behind other requests and then answers at once is reachable", async () => {
    const q = queuedHost();
    const result = resolveEndpoint(q.h);
    await q.clock.advance(8_000);
    expect(q.requests.length).toBe(1);
    q.requests[0]!.sent();
    await q.clock.advance(100);
    q.requests[0]!.answer();
    const r = await result;
    expect(r.ok && r.value).toMatchObject({ url: "http://127.0.0.1:9443", source: "setting" });
  });

  test("a sent probe still gets only 5 s", async () => {
    const q = queuedHost();
    const result = resolveEndpoint(q.h);
    await flush();
    q.requests[0]!.sent();
    await q.clock.advance(HEALTH_PROBE_MS);
    await flush();
    // the setting's candidate timed out; the default's probe is the next request
    expect(q.requests.length).toBe(2);
    q.requests[1]!.sent();
    q.requests[1]!.answer();
    const r = await result;
    expect(r.ok && r.value.attempts[0]).toMatchObject({ source: "setting", outcome: "unreachable", error: { kind: "timeout", ms: HEALTH_PROBE_MS } });
  });

  test("a probe still queued at the queue deadline is dropped and tried again, not called unreachable", async () => {
    const q = queuedHost();
    const result = resolveEndpoint(q.h);
    await q.clock.advance(HEALTH_QUEUE_MS);
    expect(q.drops()).toBe(1);
    await flush();
    expect(q.requests.map((r) => r.url)).toEqual(["http://127.0.0.1:9443/health", "http://127.0.0.1:9443/health"]);
    q.requests[1]!.sent();
    q.requests[1]!.answer();
    const r = await result;
    expect(r.ok && r.value).toMatchObject({ source: "setting", attempts: [{ source: "setting", outcome: "ok" }] });
  });

  test("a probe cancelled twice is recorded with the cancellation, and the next candidate is tried", async () => {
    const q = queuedHost();
    const result = resolveEndpoint(q.h);
    await q.clock.advance(HEALTH_QUEUE_MS);
    await q.clock.advance(HEALTH_QUEUE_MS);
    await flush();
    expect(q.requests.length).toBe(3);
    q.requests[2]!.sent();
    q.requests[2]!.answer();
    const r = await result;
    expect(r.ok && r.value.attempts[0]).toMatchObject({ source: "setting", outcome: "unreachable", error: { kind: "cancelled", reason: "abandoned" } });
    expect(r.ok && r.value.source).toBe("default");
  });
});
