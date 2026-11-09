// Per-endpoint read backoff: 1 s doubling to a 60 s cap, full jitter within
// [1 s, ceiling], reset on success; only transport failures and 5xx back off.

import { describe, expect, test } from "bun:test";
import {
  BACKOFF_BASE_MS, BACKOFF_CAP_MS, backoffCeiling, backoffDelay, failBackoff, backsOff, retryBackoffNow,
} from "../../../src/sync/backoff.ts";
import type { GcError } from "../../../src/gc/errors.ts";

const down: GcError = { kind: "unreachable", url: "http://127.0.0.1:8372/health", cause: "connection refused" };

describe("schedule", () => {
  test("the ceiling doubles from 1 s and stops at 60 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(backoffCeiling)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(BACKOFF_BASE_MS).toBe(1000);
    expect(BACKOFF_CAP_MS).toBe(60000);
  });

  test("full jitter spans [1 s, ceiling]", () => {
    expect(backoffDelay(1, () => 0)).toBe(1000);
    expect(backoffDelay(1, () => 0.999)).toBe(1000);
    expect(backoffDelay(4, () => 0)).toBe(1000);
    expect(backoffDelay(4, () => 0.5)).toBe(4500);
    expect(backoffDelay(30, () => 0.999999)).toBeLessThanOrEqual(60000);
    expect(backoffDelay(30, () => 0.999999)).toBeGreaterThan(59000);
  });

  test("a huge attempt count does not overflow", () => {
    expect(backoffCeiling(5000)).toBe(60000);
  });
});

describe("state", () => {
  test("each failure raises the attempt and sets the retry time from the injected clock", () => {
    let s = failBackoff(null, 10_000, down, () => 0.5);
    expect(s).toEqual({ attempt: 1, retryAt: 11_000, cause: down });
    s = failBackoff(s, 11_000, down, () => 0.5);
    expect(s).toEqual({ attempt: 2, retryAt: 12_500, cause: down });
    for (let i = 0; i < 10; i++) s = failBackoff(s, 20_000, down, () => 1 - Number.EPSILON);
    expect(s.attempt).toBe(12);
    expect(s.retryAt - 20_000).toBeLessThanOrEqual(BACKOFF_CAP_MS);
  });

  test("retry now keeps the attempt count but makes the retry due", () => {
    const s = failBackoff(failBackoff(null, 0, down, () => 0), 1000, down, () => 0);
    expect(retryBackoffNow(s, 1500)).toEqual({ attempt: 2, retryAt: 1500, cause: down });
  });
});

describe("which read failures back off", () => {
  const cases: [GcError, boolean][] = [
    [down, true],
    [{ kind: "timeout", url: "u", ms: 30000 }, true],
    [{ kind: "http", status: 502, problem: null, raw: "bad gateway" }, true],
    [{ kind: "http", status: 500, problem: null }, true],
    [{ kind: "http", status: 409, problem: null }, false],
    [{ kind: "city-not-running", city: "c" }, false],
    [{ kind: "api-missing", operationId: "get-health" }, false],
    [{ kind: "decode", operationId: "get-health", path: "", issues: [] }, false],
    [{ kind: "too-large", url: "u", direction: "response", limitBytes: 1 }, false],
    [{ kind: "read-only", detail: "read_only: x" }, false],
    [{ kind: "read-grant-required", status: 401, detail: "missing X-GC-City-Read grant" }, false],
    // herdr's fetch followed a redirect off the loopback origin: whatever answered is not gc
    [{ kind: "not-loopback", url: "http://10.0.0.5:8372/v0/city/c/events" }, true],
  ];
  for (const [e, want] of cases) {
    test(`${e.kind}${e.kind === "http" ? ` ${e.status}` : ""} → ${want ? "back off" : "hold until the sweep"}`, () => {
      expect(backsOff(e)).toBe(want);
    });
  }
});
