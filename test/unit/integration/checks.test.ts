// The integration run's checks over recorded requests: wake before attach and the degraded budget.

import { describe, expect, test } from "bun:test";
import { overBudget, wakeBeforeAttach, type AttachMoment } from "../../integration/checks.ts";
import type { FetchRecord } from "../../integration/herdr.ts";

const API = "http://127.0.0.1:9";
function req(method: string, path: string, startedAt: number, endedAt: number | null, status: number | null, concurrent = 1): FetchRecord {
  return { method, url: `${API}${path}`, startedAt, endedAt, status, error: status === null ? "failed" : null, concurrent };
}

describe("wakeBeforeAttach", () => {
  const moment: AttachMoment = { sessionId: "ca-5", at: 1000, wasRunning: false, runningAtTabNew: true };
  const wake = req("POST", "/v0/city/c/session/ca-5/wake", 100, 200, 200);

  test("a woken session opened once gc reports it running: nothing broken", () => {
    expect(wakeBeforeAttach(moment, [req("GET", "/v0/city/c/session/ca-5", 50, 60, 200), wake])).toEqual([]);
  });

  test("a session that was running needs no wake", () => {
    expect(wakeBeforeAttach({ ...moment, wasRunning: true }, [])).toEqual([]);
  });

  test("a mod that skips the wake breaks both rules", () => {
    const broken = wakeBeforeAttach({ ...moment, runningAtTabNew: false }, [req("GET", "/v0/city/c/session/ca-5", 50, 60, 200)]);
    expect(broken).toHaveLength(2);
    expect(broken[1]).toContain("did not wake it");
  });

  test("a wake that gc refused, that answered after the tab opened, or for another session does not count", () => {
    for (const r of [
      req("POST", "/v0/city/c/session/ca-5/wake", 100, 200, 409),
      req("POST", "/v0/city/c/session/ca-5/wake", 100, 1500, 200),
      req("POST", "/v0/city/c/session/ca-6/wake", 100, 200, 200),
      req("GET", "/v0/city/c/session/ca-5/wake", 100, 200, 200),
    ]) {
      expect(wakeBeforeAttach(moment, [r]).some((b) => b.includes("did not wake it"))).toBe(true);
    }
  });
});

describe("overBudget", () => {
  test("requests started in the window with more in flight than allowed", () => {
    const log = [req("GET", "/a", 10, 20, 200, 2), req("GET", "/b", 50, 60, null, 1), req("GET", "/c", 70, 80, null, 2), req("GET", "/d", 200, 210, 200, 2)];
    expect(overBudget(log, 40, 100, 1).map((r) => r.url)).toEqual([`${API}/c`]);
    expect(overBudget(log, 40, 100, 2)).toEqual([]);
  });
});
