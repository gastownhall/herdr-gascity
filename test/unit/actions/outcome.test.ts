// The outcome machinery (src/actions/outcome.ts) through the registry, as a
// copy uses it, under herdr's task-ownership rule (sync/fakes.ts FakeHost):
// an action is sent in the turn of the copy that started it; a 202 is
// followed to its outcome by that copy's own ticks; nothing is ever retried
// automatically; an outcome that cannot be known is "unknown" and the
// affected state is refetched before a retry is offered; an action whose copy
// closes before its outcome is known becomes "unknown" at once and never hangs.

import { afterEach, describe, expect, test } from "bun:test";
import type { ActionEntry, ActionSpec } from "../../../src/actions/activity.ts";
import { agentSuspend } from "../../../src/actions/agent.ts";
import {
  ACTIVITY_LIMIT, OUTCOME_POLL_LIMIT_MS, SEND_DEADLINE_MS, newIdempotencyKey, retryGate, successDetail,
} from "../../../src/actions/outcome.ts";
import * as session from "../../../src/actions/session.ts";
import type { RequestOutcome } from "../../../src/gc/types.gen.ts";
import { decodeValue } from "../../../src/gc/decode.ts";
import { RequestOutcomeSchema } from "../../../src/gc/schemas.gen.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../../src/sync/registry.ts";
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
  /** A click in the copy's own turn: starts the action, returns its id. */
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
  const entry = (c: Copy, id: number): ActionEntry => {
    const e = c.sub.activity().entries.find((x) => x.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  };
  /** Requests to `path` with `method`. */
  const sent = (method: string, suffix: string, since = 0): SeenRequest[] =>
    gc.seen.slice(since).filter((r) => r.method === method && r.path.endsWith(suffix));
  return { host, gc, reg, open, close, act, retry, entry, sent };
}

const ACCEPTED_SUBMIT = fixtureBody("submit-session", "accepted") as { request_id: string; event_cursor: string };
const OUTCOME_PATH = `/v0/city/scratch/request/${ACCEPTED_SUBMIT.request_id}`;
const pendingOutcome = { request_id: ACCEPTED_SUBMIT.request_id, operation: "session.submit", state: "pending" };

/** gc answering the submit with 202, then `outcomes` in turn for each outcome poll (the last one repeats). */
function submitFlow(gc: FakeGc, outcomes: FakeReply[]): void {
  let polls = 0;
  gc.override = (req) => {
    if (req.method === "POST" && req.path.endsWith("/submit")) return { status: 202, body: ACCEPTED_SUBMIT };
    if (req.path === OUTCOME_PATH) return outcomes[Math.min(polls++, outcomes.length - 1)];
    return undefined;
  };
}

describe("a 202 action is followed to its outcome", () => {
  test("submit: sending → polling at 0.5 s, 1 s, 2 s, then every 2 s → done, delivered", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    submitFlow(gc, [
      { status: 200, body: pendingOutcome }, { status: 200, body: pendingOutcome }, { status: 200, body: pendingOutcome },
      { status: 200, body: pendingOutcome }, { status: 200, body: fixtureBody("get-request-outcome", "session-submit") },
    ]);
    const id = await act(a, session.sessionSubmit("sc-20", "close fe-12", "default"));
    expect(entry(a, id).state.kind).toBe("sending");
    await host.runTurns();
    const accepted = entry(a, id).state;
    expect(accepted).toMatchObject({ kind: "polling", requestId: ACCEPTED_SUBMIT.request_id, afterSeq: ACCEPTED_SUBMIT.event_cursor });
    const t0 = host.now();
    await host.advance(12_000);
    const polls = sent("GET", OUTCOME_PATH);
    expect(polls).toHaveLength(5);
    expect(polls.map((p) => p.query.get("after_seq"))).toEqual(Array(5).fill(ACCEPTED_SUBMIT.event_cursor));
    const gaps = polls.map((p, i) => p.at - (i === 0 ? t0 : (polls[i - 1] as SeenRequest).at));
    // Each delay is measured from the previous answer and rounded up to the next 250 ms tick.
    expect(gaps).toEqual([500, 1000, 2000, 2000, 2000]);
    const done = entry(a, id).state;
    expect(done).toMatchObject({ kind: "done", detail: "delivered", requestId: ACCEPTED_SUBMIT.request_id });
    // One POST: nothing was re-sent.
    expect(sent("POST", "/submit")).toHaveLength(1);
    expect(host.starts.filter((s) => s.path === OUTCOME_PATH).every((s) => s.owner === a.owner)).toBe(true);
  });

  test("a failed outcome is failed, with gc's code and message", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    submitFlow(gc, [{ status: 200, body: { ...(fixtureBody("get-request-outcome", "session-create-failed") as object), request_id: ACCEPTED_SUBMIT.request_id } }]);
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(2000);
    const s = entry(a, id).state;
    expect(s.kind).toBe("failed");
    if (s.kind === "failed") {
      expect(s.error).toMatchObject({ kind: "outcome-failed", payload: { error_code: "create_failed" } });
    }
  });

  test("gc's own outcome_unknown is unknown, never success", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    submitFlow(gc, [{ status: 200, body: { ...pendingOutcome, state: "outcome_unknown" } }]);
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(2000);
    expect(entry(a, id).state).toMatchObject({ kind: "unknown", error: { cause: "reported-by-gc", requestId: ACCEPTED_SUBMIT.request_id } });
  });

  test("no outcome within 120 s: unknown (outcome-poll-expired) with the request id, and polling stops", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    submitFlow(gc, [{ status: 200, body: pendingOutcome }]);
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(OUTCOME_POLL_LIMIT_MS - 1000);
    expect(entry(a, id).state.kind).toBe("polling");
    await host.advance(2000);
    expect(entry(a, id).state).toMatchObject({ kind: "unknown", error: { cause: "outcome-poll-expired", requestId: ACCEPTED_SUBMIT.request_id } });
    const n = sent("GET", OUTCOME_PATH).length;
    await host.advance(30_000);
    expect(sent("GET", OUTCOME_PATH)).toHaveLength(n);
    expect(sent("POST", "/submit")).toHaveLength(1);
  });

  test("an outcome poll that fails in transport is tried again on schedule; one that gc refuses makes the outcome unknown", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    submitFlow(gc, [{ reject: "error sending request: connection reset" }, { status: 200, body: fixtureBody("get-request-outcome", "session-submit") }]);
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(5000);
    expect(entry(a, id).state).toMatchObject({ kind: "done", detail: "delivered" });

    submitFlow(gc, [{ status: 404, body: { title: "Not Found", status: 404, detail: "request not found" } }]);
    const id2 = await act(a, session.sessionSubmit("sc-20", "y", "default"));
    await host.advance(2000);
    expect(entry(a, id2).state).toMatchObject({
      kind: "unknown", error: { cause: "outcome-poll-failed", requestId: ACCEPTED_SUBMIT.request_id, issues: ["gc answered 404: request not found"] },
    });
  });

  test("session new: 202 → the created session is named in the outcome", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    const acc = fixtureBody("create-session", "accepted") as { request_id: string };
    gc.override = (req) => {
      if (req.method === "POST" && req.path.endsWith("/sessions")) return { status: 202, body: acc };
      if (req.path.endsWith(`/request/${acc.request_id}`)) return { status: 200, body: fixtureBody("get-request-outcome", "session-create") };
      return undefined;
    };
    const id = await act(a, session.sessionNew("worker", "rec-mw8vmef1"));
    await host.advance(2000);
    expect(entry(a, id).state).toMatchObject({ kind: "done", detail: "created session sc-76 (rec-mw8vmef1)" });
  });
});

describe("synchronous actions", () => {
  test("done with gc's answer, refetching what the action changes", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { status: 200, body: { status: "ok" } } : undefined;
    const before = gc.seen.length;
    const id = await act(a, agentSuspend("frontend/builder"));
    await host.advance(1000);
    expect(entry(a, id).state).toMatchObject({ kind: "done", detail: "gc: ok" });
    expect(sent("GET", "/agents", before).length).toBeGreaterThan(0);
    expect(sent("GET", "/sessions", before).length).toBeGreaterThan(0);
  });

  test("gc's refusal is failed, not retried", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST"
      ? { status: 409, body: fixtureBody("post-v0-city-by-city-name-session-by-id-wake", "closed-session-conflict") }
      : undefined;
    const id = await act(a, session.sessionWake("sc-76"));
    await host.advance(60_000);
    expect(entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "http", status: 409 } });
    expect(sent("POST", "/wake")).toHaveLength(1);
  });
});

describe("outcome unknown: refetch before retry, never retried automatically", () => {
  test("a lost connection: unknown; the retry waits until the state was refetched, then reuses the Idempotency-Key", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    let holdSessions = false;
    gc.override = (req) => {
      if (req.method === "POST" && req.path.endsWith("/wake")) return { reject: "error sending request: connection reset by peer" };
      if (holdSessions && req.method === "GET" && req.path.endsWith("/sessions")) return { hold: true };
      return undefined;
    };
    holdSessions = true;
    const id = await act(a, session.sessionWake("sc-20"));
    await host.advance(1000);
    const s = entry(a, id).state;
    expect(s).toMatchObject({ kind: "unknown", error: { kind: "outcome-unknown", cause: "unreachable", requestId: null } });
    // The session list refetch is held: no retry yet.
    expect(retryGate(entry(a, id), a.sub.snapshot())).toEqual({ allowed: false, reason: "refreshing sessions before a retry" });
    expect((await retry(a, id)).ok).toBe(false);
    expect(sent("POST", "/wake")).toHaveLength(1);
    // Nothing retries on its own, however long it waits.
    await host.advance(30_000);
    expect(sent("POST", "/wake")).toHaveLength(1);

    holdSessions = false;
    while (gc.heldCount() > 0) gc.release(200, fixtureBody("get-v0-city-by-city-name-sessions", "ok"));
    await host.advance(6000);
    expect(retryGate(entry(a, id), a.sub.snapshot())).toEqual({ allowed: true });
    gc.override = (req) => req.method === "POST" ? { status: 200, body: { status: "ok", id: "sc-20" } } : undefined;
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(1000);
    const posts = sent("POST", "/wake");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.init.headers["Idempotency-Key"]).toBe(posts[0]?.init.headers["Idempotency-Key"]);
    expect(entry(a, id)).toMatchObject({ attempt: 2, state: { kind: "done" } });
  });

  test("an operation without Idempotency-Key: a retry after an unknown outcome is a new request with no key", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { reject: "error sending request: connection reset" } : undefined;
    const id = await act(a, session.sessionPin("sc-20"));
    await host.advance(6000);
    expect(entry(a, id).state.kind).toBe("unknown");
    gc.override = (req) => req.method === "POST" ? { status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok") } : undefined;
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(1000);
    const posts = sent("POST", "/pin");
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.init.headers["Idempotency-Key"] === undefined)).toBe(true);
  });

  test("a retry after gc refused (a definite 4xx) uses a new key: the refusal is known, not a lost request", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST"
      ? { status: 409, body: { title: "Session State Conflict", status: 409, code: "session-conflict", detail: "pending_interaction: answer first" } }
      : undefined;
    const id = await act(a, session.sessionStop("sc-20"));
    await host.advance(1000);
    expect(entry(a, id).state.kind).toBe("failed");
    expect(retryGate(entry(a, id), a.sub.snapshot())).toEqual({ allowed: true });
    gc.override = (req) => req.method === "POST" ? { status: 200, body: { status: "ok", id: "sc-20" } } : undefined;
    await retry(a, id);
    await host.advance(1000);
    const keys = sent("POST", "/stop").map((p) => p.init.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("a done or pending action cannot be retried", async () => {
    const { host, gc, open, act, retry } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { hold: true } : undefined;
    const id = await act(a, session.sessionWake("sc-20"));
    expect(await retry(a, id)).toEqual({ ok: false, error: "the action is still under way" });
    gc.release(200, { status: "ok" });
    await host.advance(1000);
    expect(await retry(a, id)).toEqual({ ok: false, error: "the action is done" });
  });

  test("a request that never answers is unknown by the deadline, never left pending", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { hold: true } : undefined;
    const id = await act(a, session.sessionWake("sc-20"));
    await host.advance(SEND_DEADLINE_MS + 1000);
    expect(entry(a, id).state.kind).toBe("unknown");
  });
});

describe("answers that do not prove a failure are unknown, and a retry keeps the key", () => {
  const IN_FLIGHT = {
    type: "about:blank", title: "Idempotency Key In Flight", status: 409, code: "idempotency-in-flight",
    detail: "in_flight: request with this Idempotency-Key is already in progress",
  };

  test("A2: lost connection → unknown; the same-key retry answered 409 idempotency-in-flight stays unknown; every retry reuses the key", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    let mode = "reset";
    gc.override = (req) => {
      if (req.method !== "POST") return undefined;
      if (mode === "reset") return { reject: "error sending request: connection reset by peer" };
      if (mode === "inflight") return { status: 409, body: IN_FLIGHT };
      return { status: 202, body: ACCEPTED_SUBMIT };
    };
    const id = await act(a, session.sessionSubmit("sc-20", "deploy now", "default"));
    await host.advance(6000);
    expect(entry(a, id).state.kind).toBe("unknown");
    mode = "inflight";
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(500);
    expect(entry(a, id).state).toMatchObject({ kind: "unknown", error: { cause: "idempotency-in-flight" } });
    await host.advance(6000);
    mode = "accept";
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/submit").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1", "key-1"]);
  });

  test("A3: create-session answered 503 write_unconfirmed ('may have landed') is unknown, and the retry keeps the key", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    let first = true;
    gc.override = (req) => {
      if (req.method !== "POST") return undefined;
      if (first) {
        first = false;
        return { status: 503, body: { title: "Service Unavailable", status: 503, code: "store-unavailable", detail: "write_unconfirmed: session bead write not confirmed" } };
      }
      return { status: 202, body: fixtureBody("create-session", "accepted") };
    };
    const id = await act(a, session.sessionNew("worker", null));
    await host.advance(500);
    const s = entry(a, id).state;
    expect(s).toMatchObject({ kind: "unknown", error: { cause: "server-error" } });
    if (s.kind === "unknown") expect(s.error.issues?.join(" ")).toContain("write_unconfirmed");
    await host.advance(6000);
    expect((await retry(a, id)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/sessions").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
  });

  test("every 5xx is unknown; 501 not-implemented and other 4xx are definite refusals", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    const answers: Record<string, { status: number; body: unknown }> = {
      "sc-1": { status: 500, body: { title: "Internal Server Error", status: 500, detail: "boom" } },
      "sc-2": { status: 502, body: "bad gateway" },
      "sc-3": { status: 501, body: fixtureBody("respond-session", "no-pending") },
      "sc-4": { status: 404, body: { title: "Not Found", status: 404, code: "not-found", detail: "session not found" } },
    };
    gc.override = (req) => (req.method === "POST" ? answers[/session\/([^/]+)\//.exec(req.path)?.[1] ?? ""] : undefined);
    const ids = await Promise.all(["sc-1", "sc-2", "sc-3", "sc-4"].map((x) => act(a, session.sessionStop(x))));
    await host.advance(1000);
    expect(ids.map((i) => entry(a, i).state.kind)).toEqual(["unknown", "unknown", "failed", "failed"]);
  });
});

describe("deadlines and the retry gate", () => {
  test("A6: a request still queued at the send deadline is dropped and reported not sent; nothing is sent after it was reported", async () => {
    const { host, gc, open, act, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { hold: true } : undefined);
    const targets = ["sc-1", "sc-2", "sc-3", "sc-4", "sc-5", "sc-6", "sc-7"];
    const ids = [];
    for (const t of targets) ids.push(await act(a, session.sessionPin(t)));
    const resolvedAt = new Map<number, number>();
    for (let i = 0; i < 160; i++) {
      await host.advance(1000);
      for (const id of ids) if (!resolvedAt.has(id) && !["sending", "polling"].includes(entry(a, id).state.kind)) resolvedAt.set(id, host.now());
    }
    for (const [i, id] of ids.entries()) {
      const at = resolvedAt.get(id);
      expect(at).toBeDefined();
      const late = sent("POST", `/session/${targets[i]}/pin`).filter((p) => p.at >= (at as number));
      expect(late).toEqual([]);
    }
    const notSent = ids.filter((id) => entry(a, id).state.kind === "not-sent");
    expect(notSent.length).toBeGreaterThan(0);
    for (const id of notSent) expect(sent("POST", `/session/${targets[ids.indexOf(id)]}/pin`)).toEqual([]);
  });

  test("the retry gate needs a refetch that STARTED after the outcome became unknown", async () => {
    const { host, gc, open, act, entry } = setup();
    const a = await open();
    await host.advance(3000);
    // A session list read is held open before the action, and answers after it became unknown.
    gc.override = (req) => (req.method === "GET" && req.path.endsWith("/sessions") ? { hold: true } : req.method === "POST" ? { reject: "connection reset" } : undefined);
    a.sub.refresh(["sessions"]);
    await host.advance(300);
    expect(gc.heldCount()).toBe(1);
    // Submit changes only the session list, so that list's refetch alone gates the retry.
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(10);
    expect(entry(a, id).state.kind).toBe("unknown");
    gc.override = (req) => (req.method === "POST" ? { reject: "connection reset" } : undefined);
    gc.release(200, fixtureBody("get-v0-city-by-city-name-sessions", "ok"));
    await host.advance(10);
    expect(retryGate(entry(a, id), a.sub.snapshot()).allowed).toBe(false);
    await host.advance(7000);
    expect(retryGate(entry(a, id), a.sub.snapshot())).toEqual({ allowed: true });
  });
});

describe("once an attempt may have landed, every retry keeps its key", () => {
  test("unknown (key-1) → same-key retry dropped unsent when its copy closes → the next retry still sends key-1", async () => {
    const { host, gc, reg, open, close, act, retry, entry, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    let mode = "reset";
    gc.override = (req) => {
      if (req.method === "POST") return mode === "reset" ? { reject: "error sending request: connection reset by peer" } : { status: 202, body: ACCEPTED_SUBMIT };
      if (mode === "busy" && req.path === "/health") return { hold: true };
      return undefined;
    };
    const id = await act(a, session.sessionSubmit("sc-20", "deploy now", "default"));
    await host.advance(6000);
    expect(entry(a, id).state.kind).toBe("unknown");
    // Both budget slots fill, so the same-key retry queues; then its copy closes.
    mode = "busy";
    const probe = reg.probeFetch();
    await host.run(b.owner, () => {
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
    });
    expect((await retry(a, id)).ok).toBe(true);
    await close(a);
    expect(entry(b, id)).toMatchObject({ state: { kind: "not-sent" }, keyPinned: true });
    mode = "accept";
    while (gc.heldCount() > 0) gc.release(200, fixtureBody("get-health", "ok"));
    await host.advance(1000);
    expect((await retry(b, id)).ok).toBe(true);
    await host.advance(500);
    expect(sent("POST", "/submit").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
  });

  test("a later definite refusal does not release the key: the earlier attempt may still have landed", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    const answers: FakeReply[] = [
      { reject: "connection reset" },
      { status: 409, body: { title: "Session State Conflict", status: 409, code: "session-conflict", detail: "pending_interaction: answer first" } },
      { status: 200, body: { status: "ok", id: "sc-20" } },
    ];
    let n = 0;
    gc.override = (req) => (req.method === "POST" ? answers[n++] : undefined);
    const id = await act(a, session.sessionStop("sc-20"));
    await host.advance(6000);
    await retry(a, id);
    await host.advance(500);
    expect(entry(a, id)).toMatchObject({ state: { kind: "failed" }, keyPinned: true });
    await retry(a, id);
    await host.advance(500);
    expect(sent("POST", "/stop").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1", "key-1"]);
  });

  test("a definite refusal of an action that never was uncertain still gets a new key", async () => {
    const { host, gc, open, act, retry, entry, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 409, body: { title: "Conflict", status: 409, code: "session-conflict", detail: "x" } } : undefined);
    const id = await act(a, session.sessionStop("sc-20"));
    await host.advance(500);
    expect(entry(a, id).keyPinned).toBe(false);
    await retry(a, id);
    await host.advance(500);
    expect(sent("POST", "/stop").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-2"]);
  });
});

describe("herdr ownership: the copy that started an action closes", () => {
  test("while the request is in flight: unknown at once, the late answer is ignored, nothing is re-sent", async () => {
    const { host, gc, open, close, act, entry, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { hold: true } : undefined;
    const id = await act(a, session.sessionWake("sc-20"));
    const starts = host.starts.length;
    await close(a);
    expect(host.starts.slice(starts)).toEqual([]);
    expect(entry(b, id).state).toMatchObject({ kind: "unknown", error: { cause: "cancelled", requestId: null } });
    gc.release(200, { status: "ok", id: "sc-20" });
    await host.advance(60_000);
    expect(entry(b, id).state.kind).toBe("unknown");
    expect(sent("POST", "/wake")).toHaveLength(1);
    // The surviving copy refetched the state, so it can offer the retry.
    expect(retryGate(entry(b, id), b.sub.snapshot())).toEqual({ allowed: true });
  });

  test("while its outcome is being polled: a surviving copy takes over the polling from its own ticks and learns the outcome", async () => {
    const { host, gc, open, close, act, entry, sent } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    let done = false;
    submitFlow(gc, [{ status: 200, body: pendingOutcome }]);
    const base = gc.override;
    gc.override = (req) => (req.path === OUTCOME_PATH && done ? { status: 200, body: fixtureBody("get-request-outcome", "session-submit") } : base?.(req));
    const id = await act(a, session.sessionSubmit("sc-20", "x", "default"));
    await host.advance(1000);
    expect(entry(b, id).state.kind).toBe("polling");
    await close(a);
    expect(entry(b, id).state.kind).toBe("polling");
    const n = sent("GET", OUTCOME_PATH).length;
    done = true;
    await host.advance(3000);
    expect(sent("GET", OUTCOME_PATH).length).toBeGreaterThan(n);
    expect(host.starts.filter((x) => x.path === OUTCOME_PATH).slice(n).every((x) => x.owner === b.owner)).toBe(true);
    expect(entry(b, id).state).toMatchObject({ kind: "done", detail: "delivered" });
    expect(sent("POST", "/submit")).toHaveLength(1);
  });

  test("while the request is still queued in the fetch budget: it is dropped, never sent", async () => {
    const { host, gc, open, close, act, entry, sent, reg } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    // Two reads held open fill the budget, so the action queues.
    gc.override = (req) => req.method === "GET" ? { hold: true } : { status: 200, body: { status: "ok" } };
    const probe = reg.probeFetch();
    await host.run(b.owner, () => {
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
      void probe.fetch(`${API}/health`, { method: "GET", headers: {} }).catch(() => {});
    });
    expect(reg.budgetStats().inFlight).toBe(2);
    const id = await act(a, session.sessionWake("sc-20"));
    expect(reg.budgetStats().queued).toBeGreaterThan(0);
    await close(a);
    // Dropped from the queue before it was sent: known not to have happened.
    expect(entry(b, id).state).toMatchObject({ kind: "not-sent" });
    while (gc.heldCount() > 0) gc.release(200, { items: [], total: 0 });
    await host.advance(5000);
    expect(sent("POST", "/wake")).toHaveLength(0);
  });
});

describe("the activity log", () => {
  test("keeps the newest actions, at most ACTIVITY_LIMIT, and never drops one still under way", async () => {
    const { host, gc, open, act, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => {
      if (req.method !== "POST") return undefined;
      return req.path.endsWith("/sc-held/wake") ? { hold: true } : { status: 200, body: { status: "ok" } };
    };
    const held = await act(a, session.sessionWake("sc-held"));
    for (let i = 0; i < ACTIVITY_LIMIT + 5; i++) await act(a, session.sessionWake(`sc-${i}`));
    await host.advance(1000);
    const entries = a.sub.activity().entries;
    expect(entries.length).toBe(ACTIVITY_LIMIT);
    expect(entries.some((e) => e.id === held)).toBe(true);
    expect(entries.at(-1)?.spec.target).toEqual({ kind: "session", id: `sc-${ACTIVITY_LIMIT + 4}` });
    expect(sent("POST", "/wake").length).toBe(ACTIVITY_LIMIT + 6);
  });

  test("every new action gets a fresh Idempotency-Key", async () => {
    const { host, gc, open, act, sent } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => req.method === "POST" ? { status: 200, body: { status: "ok" } } : undefined;
    await act(a, session.sessionWake("sc-20"));
    await act(a, session.sessionWake("sc-20"));
    await host.advance(1000);
    expect(sent("POST", "/wake").map((p) => p.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-2"]);
  });
});

describe("helpers", () => {
  const outcome = (name: string): RequestOutcome => {
    const d = decodeValue(RequestOutcomeSchema, fixtureBody("get-request-outcome", name), "get-request-outcome");
    if (!d.ok) throw new Error("decode");
    return d.value;
  };

  test("success details read gc's typed payloads", () => {
    expect(successDetail(outcome("session-submit"))).toBe("delivered");
    expect(successDetail(outcome("session-message"))).toBe("delivered");
    expect(successDetail(outcome("session-create"))).toBe("created session sc-76 (rec-mw8vmef1)");
    const queued = outcome("session-message");
    const payload = { ...(queued.event?.payload as object), queued: true };
    expect(successDetail({ ...queued, event: { ...queued.event!, payload } })).toBe("queued: the session gets it when it next runs");
    expect(successDetail({ ...queued, event: { ...queued.event!, payload: { nope: 1 } } }))
      .toMatch(/^succeeded \(gc's result could not be read: /);
  });

  test("idempotency keys are UUID-shaped and distinct", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
