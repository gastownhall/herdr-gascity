// Work actions (src/actions/work.ts) through the shared ledger, as a copy uses
// them, under herdr's ownership rule (sync/fakes.ts FakeHost):
//   - a new bead with a sling target is two gc calls, each its own action in
//     the activity log: create (with its Idempotency-Key), then sling (none:
//     gc declares none) once the create is done, for the bead gc created;
//   - a sling that fails or is unknown after a successful create is shown as
//     such, and nothing ever creates the bead again: a retry resends only
//     the sling;
//   - a create that is not done never slings; a retry of the create that is
//     done slings once;
//   - the copy that started it closing mid-way leaves each step unknown or
//     not sent, never pending, and nothing is resent;
//   - each action refetches the board domains it changes (and a watched
//     bead), and an unknown outcome waits for that refetch before a retry.

import { afterEach, describe, expect, test } from "bun:test";
import type { ActionEntry, ActionSpec } from "../../../src/actions/activity.ts";
import { retryGate } from "../../../src/actions/outcome.ts";
import * as work from "../../../src/actions/work.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../../src/sync/registry.ts";
import { activityModel } from "../../../src/vm/activity.ts";
import { FakeGc, FakeHost, fixtureBody, type FakeReply, type Owner, type SeenRequest } from "../sync/fakes.ts";

const API = "http://127.0.0.1:8372";
const CITY = "scratch";

interface Copy {
  owner: Owner;
  sub: Subscription;
}

let live: Copy[] = [];
afterEach(() => {
  for (const c of live) c.sub.unsubscribe();
  live = [];
});

function setup() {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  let keys = 0;
  const reg = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5, newKey: () => `key-${++keys}` });
  reg.setOnScreen(true);
  let n = 0;
  const open = async (): Promise<Copy> => {
    const owner = `copy-${++n}`;
    let copy: Copy | null = null;
    await host.run(owner, () => {
      const made = reg.subscribe({ apiUrl: API, city: CITY });
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      const c: Copy = { owner, sub: made.value };
      c.sub.tick();
      host.every(TICK_MS, () => c.sub.tick());
      copy = c;
    });
    await host.runTurns();
    if (!copy) throw new Error("open");
    live.push(copy);
    return copy;
  };
  const close = (c: Copy) => host.close(c.owner, () => c.sub.unsubscribe());
  const act = async (c: Copy, spec: ActionSpec): Promise<number> => {
    let id = -1;
    await host.run(c.owner, () => {
      id = c.sub.act(spec);
    });
    return id;
  };
  const retry = async (c: Copy, id: number) => {
    let r: ReturnType<Subscription["retryAction"]> | null = null;
    await host.run(c.owner, () => {
      r = c.sub.retryAction(id);
    });
    return r as unknown as ReturnType<Subscription["retryAction"]>;
  };
  const entries = (c: Copy): readonly ActionEntry[] => c.sub.activity().entries;
  const entry = (c: Copy, id: number): ActionEntry => {
    const e = entries(c).find((x) => x.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  };
  const sent = (method: string, suffix: string, since = 0): SeenRequest[] =>
    gc.seen.slice(since).filter((r) => r.method === method && r.path.endsWith(suffix));
  return { host, gc, reg, open, close, act, retry, entries, entry, sent };
}

const CREATED = { status: 201, body: fixtureBody("create-bead", "ok") } as const;
const SLUNG = { status: 200, body: fixtureBody("post-v0-city-by-city-name-sling", "ok") } as const;
const NEW_BEAD = { title: "recorder bead mw8vmef1", description: "", priority: null, labels: [] };

/** gc answering the create and the sling as given (each a reply or a function of the request count). */
function work2(gc: FakeGc, create: () => FakeReply, sling: () => FakeReply): void {
  gc.override = (req) => {
    if (req.method !== "POST") return undefined;
    if (req.path.endsWith("/beads")) return create();
    if (req.path.endsWith("/sling")) return sling();
    return undefined;
  };
}

const body = (r: SeenRequest | undefined): unknown => JSON.parse(r?.init.body ?? "null");

describe("a new bead slung to an agent: two gc calls, each tracked", () => {
  test("create (with its key), then sling the created bead (no key); two log entries, both done", async () => {
    const { host, gc, open, act, entries, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    work2(gc, () => CREATED, () => SLUNG);
    const id = await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.advance(500);
    const [create] = sent("POST", "/beads");
    expect(body(create)).toEqual({ title: "recorder bead mw8vmef1" });
    expect(create?.init.headers["Idempotency-Key"]).toBe("key-1");
    const [sling, ...more] = sent("POST", "/sling");
    expect(more).toEqual([]);
    expect(body(sling)).toEqual({ target: "worker", bead: "sc-74" });
    expect(sling?.init.headers["Idempotency-Key"]).toBeUndefined();
    expect(sling?.init.headers["X-GC-Request"]).toMatch(/^herdr-gascity\//);
    const log = entries(a);
    expect(log.map((e) => [e.spec.kind, e.state.kind])).toEqual([["bead.create", "done"], ["bead.sling", "done"]]);
    const slingId = (log[1] as ActionEntry).id;
    expect(entry(a, id).followUp).toEqual({ verb: "Sling to worker", state: { kind: "started", id: slingId } });
    expect(entry(a, id).state).toMatchObject({ kind: "done", detail: "gc: created bead sc-74" });
    expect(entry(a, slingId).state).toMatchObject({ kind: "done", detail: "gc: slung bead sc-74 to worker; convoy sc-75" });
    const rows = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows;
    expect(rows.map((r) => [r.title, r.tone])).toEqual([
      ["Sling to worker · bead sc-74", "done"],
      ['New bead · new bead "recorder bead mw8vmef1"', "done"],
    ]);
    expect(rows[1]?.detail).toBe(`gc: created bead sc-74; then Sling to worker: sent (action ${slingId})`);
  });

  test("the sling fails after the create: shown failed; its retry resends only the sling, never the create", async () => {
    const { host, gc, open, act, retry, entries, sent } = setup();
    const a = await open();
    await host.advance(3000);
    work2(gc, () => CREATED, () => ({ status: 409, body: { title: "Conflict", status: 409, detail: "bead sc-74 already routed to worker" } }));
    const id = await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.advance(500);
    const [create, sling] = entries(a);
    expect(create?.state.kind).toBe("done");
    expect(sling?.state).toMatchObject({ kind: "failed", error: { kind: "http", status: 409 } });
    const rows = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows;
    expect(rows[0]).toMatchObject({ title: "Sling to worker · bead sc-74", tone: "failed", detail: expect.stringContaining("already routed") });
    expect(rows[1]).toMatchObject({ tone: "done", retry: { kind: "none" } });
    // The create is done: it offers no retry, and the log refuses one.
    expect((await retry(a, id)).ok).toBe(false);

    work2(gc, () => CREATED, () => SLUNG);
    expect((await retry(a, sling?.id ?? -1)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/beads")).toHaveLength(1);
    expect(sent("POST", "/sling").map(body)).toEqual([{ target: "worker", bead: "sc-74" }, { target: "worker", bead: "sc-74" }]);
    expect(sent("POST", "/sling").every((r) => r.init.headers["Idempotency-Key"] === undefined)).toBe(true);
    expect(entries(a).map((e) => [e.spec.kind, e.state.kind, e.attempt])).toEqual([["bead.create", "done", 1], ["bead.sling", "done", 2]]);
  });

  test("the sling's outcome is unknown after the create: shown unknown with 'may happen twice'; retry waits for the refetch, then resends only the sling", async () => {
    const { host, gc, open, act, retry, entries, sent } = setup();
    const a = await open();
    await host.advance(3000);
    let holdBoard = false;
    gc.override = (req) => {
      if (req.method === "POST" && req.path.endsWith("/beads")) return CREATED;
      if (req.method === "POST" && req.path.endsWith("/sling")) return { reject: "error sending request: connection reset by peer" };
      if (holdBoard && req.method === "GET" && req.path.endsWith("/work/ready")) return { hold: true };
      return undefined;
    };
    holdBoard = true;
    await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.advance(1000);
    const sling = entries(a)[1] as ActionEntry;
    expect(sling.state).toMatchObject({ kind: "unknown", error: { kind: "outcome-unknown", cause: "unreachable" } });
    expect(retryGate(sling, a.sub.snapshot())).toEqual({ allowed: false, reason: "refreshing ready before a retry" });
    expect((await retry(a, sling.id)).ok).toBe(false);
    const row = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows[0];
    expect(row).toMatchObject({ tone: "unknown", refresh: true, retry: { kind: "wait" } });
    // Nothing is retried on its own.
    await host.advance(30_000);
    expect(sent("POST", "/sling")).toHaveLength(1);

    holdBoard = false;
    while (gc.heldCount() > 0) gc.release(200, fixtureBody("get-v0-city-by-city-name-work-ready", "ready"));
    await host.advance(6000);
    const ready = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows[0];
    expect(ready?.retry).toEqual({ kind: "retry", label: "Retry (gc cannot deduplicate this: it may happen twice)" });
    work2(gc, () => CREATED, () => SLUNG);
    expect((await retry(a, sling.id)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/beads")).toHaveLength(1);
    expect(sent("POST", "/sling")).toHaveLength(2);
    expect(entries(a).map((e) => e.state.kind)).toEqual(["done", "done"]);
  });

  test("the create is refused: nothing is slung; the create's row says the sling was not sent", async () => {
    const { host, gc, open, act, entries, sent } = setup();
    const a = await open();
    await host.advance(3000);
    work2(gc, () => ({ status: 422, body: fixtureBody("create-bead", "validation-failed") }), () => SLUNG);
    const id = await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.advance(60_000);
    expect(sent("POST", "/sling")).toHaveLength(0);
    expect(entries(a).map((e) => e.spec.kind)).toEqual(["bead.create"]);
    const row = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows.find((r) => r.id === id);
    expect(row?.tone).toBe("failed");
    expect(row?.detail).toContain("then Sling to worker: not sent, the bead was not created");
  });

  test("the create's outcome is unknown: no sling; a same-key retry of the create that gc answers (replayed) slings once", async () => {
    const { host, gc, open, act, retry, entries, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    work2(gc, () => ({ status: 503, body: { title: "Service Unavailable", status: 503, detail: "write_unconfirmed: not confirmed" } }), () => SLUNG);
    const id = await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.advance(1000);
    expect(entry(a, id).state.kind).toBe("unknown");
    expect(sent("POST", "/sling")).toHaveLength(0);
    const waiting = activityModel(a.sub.activity(), a.sub.snapshot(), host.now()).rows[0];
    expect(waiting?.detail).toContain("then Sling to worker: not sent, the bead may not exist; a retry of the create sends it once gc confirms the bead");
    await host.advance(6000);
    work2(gc, () => CREATED, () => SLUNG);
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(500);
    const creates = sent("POST", "/beads");
    expect(creates.map((r) => r.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
    expect(sent("POST", "/sling").map(body)).toEqual([{ target: "worker", bead: "sc-74" }]);
    expect(entries(a).map((e) => [e.spec.kind, e.state.kind])).toEqual([["bead.create", "done"], ["bead.sling", "done"]]);
  });
});

describe("the copy that started a new bead closes mid-way", () => {
  test("during the create: unknown at once; the late answer slings nothing, ever", async () => {
    const { host, gc, open, close, act, entry, entries, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    work2(gc, () => ({ hold: true }), () => SLUNG);
    const id = await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await close(a);
    expect(entry(b, id).state).toMatchObject({ kind: "unknown", error: { cause: "cancelled" } });
    gc.release(201, fixtureBody("create-bead", "ok"));
    await host.advance(60_000);
    expect(sent("POST", "/sling")).toHaveLength(0);
    expect(entries(b).map((e) => e.spec.kind)).toEqual(["bead.create"]);
    expect(entry(b, id).followUp?.state).toEqual({ kind: "waiting" });
  });

  test("during the sling: the create stays done, the sling is unknown at once, and neither is resent", async () => {
    const { host, gc, open, close, act, entries, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    work2(gc, () => CREATED, () => ({ hold: true }));
    await act(a, work.beadCreate(NEW_BEAD, "worker"));
    await host.runTurns();
    expect(sent("POST", "/sling")).toHaveLength(1);
    await close(a);
    expect(entries(b).map((e) => [e.spec.kind, e.state.kind])).toEqual([["bead.create", "done"], ["bead.sling", "unknown"]]);
    gc.release(200, SLUNG.body);
    await host.advance(60_000);
    expect(sent("POST", "/beads")).toHaveLength(1);
    expect(sent("POST", "/sling")).toHaveLength(1);
    expect(entries(b).map((e) => e.state.kind)).toEqual(["done", "unknown"]);
  });

  test("with the sling still queued in the fetch budget: it is dropped and reported not sent", async () => {
    const { host, gc, reg, open, close, act, entries, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    gc.override = (req) => {
      if (req.method === "GET" || req.path.endsWith("/beads")) return { hold: true };
      return req.path.endsWith("/sling") ? SLUNG : undefined;
    };
    await act(a, work.beadCreate(NEW_BEAD, "worker"));
    // The create and one read fill the budget; a second read waits behind them.
    const probe = reg.probeFetch();
    await host.run(b.owner, () => {
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
    });
    expect(reg.budgetStats().inFlight).toBe(2);
    gc.release(201, fixtureBody("create-bead", "ok"));
    await host.runTurns();
    expect(entries(a).map((e) => [e.spec.kind, e.state.kind])).toEqual([["bead.create", "done"], ["bead.sling", "sending"]]);
    expect(reg.budgetStats().queued).toBeGreaterThan(0);
    await close(a);
    expect(entries(b).map((e) => [e.spec.kind, e.state.kind])).toEqual([["bead.create", "done"], ["bead.sling", "not-sent"]]);
    gc.override = null;
    while (gc.heldCount() > 0) gc.release(200, { items: [], total: 0 });
    await host.advance(5000);
    expect(sent("POST", "/sling")).toHaveLength(0);
    expect(sent("POST", "/beads")).toHaveLength(1);
  });
});

describe("sling, close and reopen an existing bead", () => {
  test("each refetches the board domains it changes, and a watched bead", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    const release = a.sub.watchBead("sc-74");
    await host.advance(3000);
    for (const [spec, reply] of [
      [work.beadClose("sc-74", "done"), { status: 200, body: { status: "closed" } }],
      [work.beadReopen("sc-74"), { status: 200, body: { status: "reopened" } }],
      [work.beadSling("sc-74", "worker"), SLUNG],
    ] as [ActionSpec, FakeReply][]) {
      gc.override = (req) => (req.method === "POST" ? reply : undefined);
      const before = gc.seen.length;
      const id = await act(a, spec);
      await host.advance(1500);
      expect(entry(a, id).state.kind).toBe("done");
      const after = gc.seen.slice(before);
      const posted = after.findIndex((r) => r.method === "POST");
      const reads = after.slice(posted + 1).filter((r) => r.method === "GET");
      expect(reads.some((r) => r.path.endsWith("/work/ready") && r.query.get("status") === null)).toBe(true);
      expect(reads.some((r) => r.path.endsWith("/work/ready") && r.query.get("status") === "in_progress")).toBe(true);
      expect(reads.some((r) => r.path.endsWith("/bead/sc-74"))).toBe(true);
      if (spec.kind === "bead.sling") expect(reads.some((r) => r.path.endsWith("/sessions"))).toBe(true);
    }
    release();
    expect(sent("POST", "/close").map(body)).toEqual([{ reason: "done" }]);
    expect(sent("POST", "/reopen").map((r) => r.init.body)).toEqual([undefined]);
    expect(sent("POST", "/").every((r) => r.init.headers["Idempotency-Key"] === undefined)).toBe(true);
  });

  test("a close whose outcome is unknown: retry waits for the board refetch, then sends a new request (gc cannot deduplicate it)", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 500, body: { title: "Internal", status: 500, detail: "store write failed" } } : undefined);
    const id = await act(a, work.beadClose("sc-74", "r"));
    await host.runTurns();
    expect(entry(a, id).state.kind).toBe("unknown");
    expect(retryGate(entry(a, id), a.sub.snapshot()).allowed).toBe(false);
    await host.advance(6000);
    expect(retryGate(entry(a, id), a.sub.snapshot())).toEqual({ allowed: true });
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "closed" } } : undefined);
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/bead/sc-74/close").map(body)).toEqual([{ reason: "r" }, { reason: "r" }]);
    expect(entry(a, id).state.kind).toBe("done");
  });
});
