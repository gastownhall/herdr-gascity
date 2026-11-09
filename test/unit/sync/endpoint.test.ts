// Endpoint health: one probe at a time while backing off, and a probe whose
// owner went away (herdr never settles a closed copy's fetch) expires.

import { describe, expect, test } from "bun:test";
import { FetchBudget } from "../../../src/sync/budget.ts";
import { Endpoint, PROBE_DEADLINE_MS } from "../../../src/sync/endpoint.ts";
import { RECLAIM_AFTER_MS } from "../../../src/sync/budget.ts";
import type { GcError } from "../../../src/gc/errors.ts";
import { FakeClock, FakeGc } from "./fakes.ts";

const down: GcError = { kind: "unreachable", url: "u", cause: "refused" };

function make() {
  const clock = new FakeClock();
  const gc = new FakeGc(clock);
  const made = Endpoint.create("http://127.0.0.1:8372", new FetchBudget(gc.fetch, clock), clock, () => 0);
  if (!made.ok) throw new Error("endpoint");
  return { clock, ep: made.value };
}

describe("probe", () => {
  test("open until a failure; then one probe per retry time", () => {
    const { clock, ep } = make();
    expect(ep.gate(clock.now())).toEqual({ kind: "open" });
    ep.failed(down);
    expect(ep.gate(clock.now())).toEqual({ kind: "wait", until: clock.now() + 1000 });
    const p = ep.gate(clock.now() + 1000);
    expect(p.kind).toBe("probe");
    expect(ep.gate(clock.now() + 1000)).toEqual({ kind: "wait", until: clock.now() + 1000 + PROBE_DEADLINE_MS });
    expect(ep.peekGate(clock.now() + 1000).kind).toBe("wait");
  });

  test("a probe that never ends expires at its deadline, and a stale endProbe does not cancel the next one", () => {
    const { clock, ep } = make();
    expect(PROBE_DEADLINE_MS).toBeGreaterThan(RECLAIM_AFTER_MS);
    ep.failed(down);
    const first = ep.gate(clock.now() + 1000);
    if (first.kind !== "probe") throw new Error("probe");
    const later = clock.now() + 1000 + PROBE_DEADLINE_MS;
    const second = ep.gate(later);
    if (second.kind !== "probe") throw new Error("expired probe should be replaced");
    ep.endProbe(first.token);
    expect(ep.gate(later).kind).toBe("wait");
    ep.endProbe(second.token);
    expect(ep.gate(later).kind).toBe("probe");
  });

  test("success clears backoff and probe", () => {
    const { clock, ep } = make();
    ep.failed(down);
    const p = ep.gate(clock.now() + 1000);
    expect(p.kind).toBe("probe");
    ep.succeeded();
    expect(ep.gate(clock.now() + 1000)).toEqual({ kind: "open" });
    expect(ep.connection()).toEqual({ kind: "connected" });
  });
});
