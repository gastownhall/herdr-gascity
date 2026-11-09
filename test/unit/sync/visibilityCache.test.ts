// The app-wide visibility read: herdr's guide asks mods not to poll panes(),
// focused() and layout(), and every copy ticks every 250 ms, so the answer is
// read at most once per tick window for the whole app, at least once a
// second, and again at the next tick after herdr re-rendered a copy (its live
// data changed).

import { describe, expect, test } from "bun:test";
import { TICK_MS } from "../../../src/sync/registry.ts";
import { VISIBILITY_MAX_AGE_MS, VisibilityCache } from "../../../src/sync/visibilityCache.ts";

function counted() {
  let reads = 0;
  let value = "a";
  const cache = new VisibilityCache(() => {
    reads++;
    return value;
  });
  return { cache, reads: () => reads, set: (v: string) => { value = v; } };
}

describe("VisibilityCache", () => {
  test("several copies ticking in one window share one read", () => {
    const c = counted();
    for (let copy = 0; copy < 5; copy++) expect(c.cache.get(1000 + copy)).toBe("a");
    expect(c.reads()).toBe(1);
  });

  test("without a change, the answer is read again once it is a second old", () => {
    const c = counted();
    c.cache.get(1000);
    c.set("b");
    expect(c.cache.get(1000 + VISIBILITY_MAX_AGE_MS - 1)).toBe("a");
    expect(c.cache.get(1000 + VISIBILITY_MAX_AGE_MS)).toBe("b");
    expect(c.reads()).toBe(2);
  });

  test("after a re-render (herdr's live data changed) the next tick window reads again, never twice in one window", () => {
    const c = counted();
    c.cache.get(1000);
    c.set("b");
    c.cache.invalidate();
    expect(c.cache.get(1000 + TICK_MS - 1)).toBe("a");
    expect(c.cache.get(1000 + TICK_MS)).toBe("b");
    expect(c.cache.get(1000 + TICK_MS + 1)).toBe("b");
    expect(c.reads()).toBe(2);
  });

  test("a clock that went backwards reads again rather than trusting an answer from the future", () => {
    const c = counted();
    c.cache.get(5000);
    c.set("b");
    expect(c.cache.get(1000)).toBe("b");
  });
});
