// Staleness is typed state: every region knows how old its data is, whether
// it is stale, and why. Event-driven domains are confirmed by each successful
// event poll that left them clean.

import { describe, expect, test } from "bun:test";
import { freshness, staleAfterMs, STALE_FLOOR_MS } from "../../../src/sync/staleness.ts";
import type { GcError } from "../../../src/gc/errors.ts";

const down: GcError = { kind: "unreachable", url: "u", cause: "refused" };

describe("thresholds", () => {
  test("stale after three intervals, never under the floor", () => {
    expect(STALE_FLOOR_MS).toBe(10_000);
    expect(staleAfterMs(2000)).toBe(10_000);
    expect(staleAfterMs(5000)).toBe(15_000);
    expect(staleAfterMs(60_000)).toBe(180_000);
  });
});

describe("freshness", () => {
  const interval = { intervalMs: 5000, confirmedAt: null };

  test("never fetched", () => {
    expect(freshness({ fetchedAt: null, error: null, dirty: true }, 10, interval)).toEqual({ kind: "never", error: null });
    expect(freshness({ fetchedAt: null, error: down, dirty: true }, 10, interval)).toEqual({ kind: "never", error: down });
  });

  test("fresh until three intervals have passed, then overdue", () => {
    expect(freshness({ fetchedAt: 1000, error: null, dirty: false }, 16_000, interval)).toEqual({ kind: "fresh", ageMs: 15_000 });
    expect(freshness({ fetchedAt: 1000, error: null, dirty: false }, 16_001, interval)).toEqual({
      kind: "stale", ageMs: 15_001, reason: "overdue", error: null,
    });
  });

  test("an error after good data keeps the data and marks it stale with the error", () => {
    expect(freshness({ fetchedAt: 1000, error: down, dirty: true }, 2000, interval)).toEqual({ kind: "stale", ageMs: 1000, reason: "error", error: down });
  });

  test("an event poll confirms a clean event-driven domain", () => {
    const evented = { intervalMs: 60_000, confirmedAt: 299_000 };
    expect(freshness({ fetchedAt: 1000, error: null, dirty: false }, 300_000, evented)).toEqual({ kind: "fresh", ageMs: 1000 });
  });

  test("a dirty domain is not confirmed by the event poll that dirtied it", () => {
    const evented = { intervalMs: 2000, confirmedAt: 299_000 };
    expect(freshness({ fetchedAt: 1000, error: null, dirty: true }, 300_000, evented)).toEqual({
      kind: "stale", ageMs: 299_000, reason: "overdue", error: null,
    });
  });

  test("a confirmation older than the fetch does not age the data", () => {
    expect(freshness({ fetchedAt: 5000, error: null, dirty: false }, 6000, { intervalMs: 2000, confirmedAt: 100 })).toEqual({ kind: "fresh", ageMs: 1000 });
  });
});
