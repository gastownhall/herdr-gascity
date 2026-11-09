// The action specs (src/actions/session.ts, agent.ts, rig.ts, work.ts): each one is a
// single gc API call. These tests pin the exact request every action sends —
// method, path, query, body, X-GC-Request, and Idempotency-Key exactly where
// the pinned spec declares it — and how its answer reads, from the recorded
// fixtures.

import { describe, expect, test } from "bun:test";
import { agentResume, agentSuspend } from "../../../src/actions/agent.ts";
import type { ActionSpec } from "../../../src/actions/activity.ts";
import { rigResume, rigSuspend } from "../../../src/actions/rig.ts";
import * as session from "../../../src/actions/session.ts";
import * as work from "../../../src/actions/work.ts";
import { createGcClient, X_GC_REQUEST, type HostRequest } from "../../../src/gc/client.ts";
import { OPERATIONS } from "../../../src/gc/operations.gen.ts";
import { fixtureBody } from "../sync/fakes.ts";

const CITY = "scratch";
const KEY = "key-1";

interface Seen {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Sends one spec against a fake gc answering `reply`; returns what went out and the result. */
async function run(spec: ActionSpec, reply: { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const made = createGcClient({
    baseUrl: "http://127.0.0.1:8372",
    fetch: (url, init: HostRequest) => {
      const u = new URL(url);
      seen.push({ method: init.method, path: u.pathname, query: u.search, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const text = JSON.stringify(reply.body);
      return Promise.resolve({ status: reply.status, ok: reply.status < 300, url, text: () => Promise.resolve(text) });
    },
  });
  if (!made.ok) throw new Error("client");
  const result = await spec.send(made.value, CITY, KEY);
  expect(seen).toHaveLength(1);
  return { req: seen[0] as Seen, result };
}

const ACCEPTED = new Set(["create-session", "submit-session", "send-session-message", "respond-session"]);
const fixture = (op: string, name = "ok") => ({ status: ACCEPTED.has(op) ? 202 : op === "create-bead" ? 201 : 200, body: fixtureBody(op, name) });

type Case = [name: string, spec: ActionSpec, method: string, path: string, body: unknown, reply: { status: number; body: unknown }, sent: unknown];

const CASES: Case[] = [
  ["session new", session.sessionNew("frontend/builder", "fix-login"), "POST", "/v0/city/scratch/sessions",
    { kind: "agent", name: "frontend/builder", alias: "fix-login" }, fixture("create-session", "accepted"),
    { kind: "accepted", requestId: "req-dcf538ab3205375e2178c0d1", afterSeq: "239" }],
  ["session new without alias", session.sessionNew("worker", null), "POST", "/v0/city/scratch/sessions",
    { kind: "agent", name: "worker" }, fixture("create-session", "accepted"),
    { kind: "accepted", requestId: "req-dcf538ab3205375e2178c0d1", afterSeq: "239" }],
  ["wake", session.sessionWake("sc-20"), "POST", "/v0/city/scratch/session/sc-20/wake", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-wake"), { kind: "done", detail: "gc: ok" }],
  ["suspend", session.sessionSuspend("sc-20"), "POST", "/v0/city/scratch/session/sc-20/suspend", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-suspend"), { kind: "done", detail: expect.stringMatching(/^gc: /) }],
  ["stop turn", session.sessionStop("sc-20"), "POST", "/v0/city/scratch/session/sc-20/stop", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-stop"), { kind: "done", detail: expect.stringMatching(/^gc: /) }],
  ["close", session.sessionClose("sc-20"), "POST", "/v0/city/scratch/session/sc-20/close", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-close"), { kind: "done", detail: expect.stringMatching(/^gc: /) }],
  ["kill", session.sessionKill("sc-20", false), "POST", "/v0/city/scratch/session/sc-20/kill", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-kill"), { kind: "done", detail: expect.stringMatching(/^gc: /) }],
  ["force kill", session.sessionKill("sc-20", true), "POST", "/v0/city/scratch/session/sc-20/kill?force=true", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-kill"), { kind: "done", detail: expect.stringMatching(/^gc: /) }],
  ["pin", session.sessionPin("sc-20"), "POST", "/v0/city/scratch/session/sc-20/pin", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-pin"), { kind: "done", detail: expect.stringMatching(/^gc: session /) }],
  ["unpin", session.sessionUnpin("sc-20"), "POST", "/v0/city/scratch/session/sc-20/unpin", undefined,
    fixture("post-v0-city-by-city-name-session-by-id-unpin"), { kind: "done", detail: expect.stringMatching(/^gc: session /) }],
  ["submit", session.sessionSubmit("sc-20", "close fe-12", "default"), "POST", "/v0/city/scratch/session/sc-20/submit",
    { message: "close fe-12", intent: "default" }, fixture("submit-session", "accepted"),
    { kind: "accepted", requestId: expect.any(String), afterSeq: expect.any(String) }],
  ["interrupt and send", session.sessionSubmit("sc-20", "stop that", "interrupt_now"), "POST", "/v0/city/scratch/session/sc-20/submit",
    { message: "stop that", intent: "interrupt_now" }, fixture("submit-session", "accepted"),
    { kind: "accepted", requestId: expect.any(String), afterSeq: expect.any(String) }],
  ["message", session.sessionMessage("sc-20", "when you can"), "POST", "/v0/city/scratch/session/sc-20/messages",
    { message: "when you can" }, fixture("send-session-message", "accepted"),
    { kind: "accepted", requestId: expect.any(String), afterSeq: expect.any(String) }],
  ["respond", session.sessionRespond("sc-20", "perm-1", "approve"), "POST", "/v0/city/scratch/session/sc-20/respond",
    { action: "approve", request_id: "perm-1" }, fixture("respond-session", "accepted"), { kind: "done", detail: "gc: accepted" }],
  ["city agent suspend", agentSuspend("worker"), "POST", "/v0/city/scratch/agent/worker/suspend", undefined,
    fixture("post-v0-city-by-city-name-agent-by-base-by-action", "suspend"), { kind: "done", detail: "gc: ok" }],
  ["rig agent resume", agentResume("frontend/builder"), "POST", "/v0/city/scratch/agent/frontend/builder/resume", undefined,
    fixture("post-v0-city-by-city-name-agent-by-dir-by-base-by-action", "resume"), { kind: "done", detail: "gc: ok" }],
  ["rig suspend", rigSuspend("frontend"), "POST", "/v0/city/scratch/rig/frontend/suspend", undefined,
    fixture("post-v0-city-by-city-name-rig-by-name-by-action", "suspend"), { kind: "done", detail: "gc: ok" }],
  ["rig resume", rigResume("frontend"), "POST", "/v0/city/scratch/rig/frontend/resume", undefined,
    fixture("post-v0-city-by-city-name-rig-by-name-by-action", "resume"), { kind: "done", detail: "gc: ok" }],
  ["new bead", work.beadCreate({ title: "recorder bead mw8vmef1", description: "recorded for the herdr-gascity contract fixtures", priority: 2, labels: [] }, null),
    "POST", "/v0/city/scratch/beads", { title: "recorder bead mw8vmef1", description: "recorded for the herdr-gascity contract fixtures", priority: 2 },
    fixture("create-bead"), { kind: "done", detail: "gc: created bead sc-74", created: "sc-74" }],
  ["new bead, title only, with labels", work.beadCreate({ title: "t", description: "", priority: null, labels: ["ui", "p1"] }, null),
    "POST", "/v0/city/scratch/beads", { title: "t", labels: ["ui", "p1"] },
    fixture("create-bead"), { kind: "done", detail: "gc: created bead sc-74", created: "sc-74" }],
  ["sling", work.beadSling("sc-74", "worker"), "POST", "/v0/city/scratch/sling", { target: "worker", bead: "sc-74" },
    fixture("post-v0-city-by-city-name-sling"), { kind: "done", detail: "gc: slung bead sc-74 to worker; convoy sc-75" }],
  ["close bead with a reason", work.beadClose("sc-74", "recorded mw8vmef1"), "POST", "/v0/city/scratch/bead/sc-74/close", { reason: "recorded mw8vmef1" },
    fixture("post-v0-city-by-city-name-bead-by-id-close"), { kind: "done", detail: "gc: closed" }],
  ["close bead without a reason", work.beadClose("sc-74", "  "), "POST", "/v0/city/scratch/bead/sc-74/close", undefined,
    fixture("post-v0-city-by-city-name-bead-by-id-close"), { kind: "done", detail: "gc: closed" }],
  ["reopen bead", work.beadReopen("sc-74"), "POST", "/v0/city/scratch/bead/sc-74/reopen", undefined,
    fixture("post-v0-city-by-city-name-bead-by-id-reopen"), { kind: "done", detail: "gc: reopened" }],
];

describe("every action is one gc API call", () => {
  for (const [name, spec, method, path, body, reply, sent] of CASES) {
    test(`${name}: ${method} ${path}`, async () => {
      const { req, result } = await run(spec, reply);
      expect(`${req.method} ${req.path}${req.query}`).toBe(`${method} ${path}`);
      expect(req.body).toEqual(body);
      expect(req.headers["X-GC-Request"]).toBe(X_GC_REQUEST);
      const declared = OPERATIONS[spec.operationId].idempotencyKey;
      expect(spec.idempotent).toBe(declared);
      if (declared) expect(req.headers["Idempotency-Key"]).toBe(KEY);
      else expect(req.headers["Idempotency-Key"]).toBeUndefined();
      expect(result as unknown).toEqual({ ok: true, value: sent });
    });
  }

  test("Idempotency-Key goes exactly on the operations gc declares it on", () => {
    const keyed = CASES.filter(([, s]) => s.idempotent).map(([, s]) => s.operationId);
    const unkeyed = CASES.filter(([, s]) => !s.idempotent).map(([, s]) => s.operationId);
    expect(new Set(keyed)).toEqual(new Set([
      "create-session", "post-v0-city-by-city-name-session-by-id-wake", "post-v0-city-by-city-name-session-by-id-suspend",
      "post-v0-city-by-city-name-session-by-id-stop", "post-v0-city-by-city-name-session-by-id-close",
      "post-v0-city-by-city-name-session-by-id-kill", "submit-session", "send-session-message", "respond-session", "create-bead",
    ]));
    expect(new Set(unkeyed)).toEqual(new Set([
      "post-v0-city-by-city-name-session-by-id-pin", "post-v0-city-by-city-name-session-by-id-unpin",
      "post-v0-city-by-city-name-agent-by-base-by-action", "post-v0-city-by-city-name-agent-by-dir-by-base-by-action",
      "post-v0-city-by-city-name-rig-by-name-by-action", "post-v0-city-by-city-name-sling",
      "post-v0-city-by-city-name-bead-by-id-close", "post-v0-city-by-city-name-bead-by-id-reopen",
    ]));
  });

  test("a bead id or agent name is sent as gc listed it: path-escaped, never interpreted", async () => {
    const { req } = await run(work.beadClose("rig/x 1", "r"), fixture("post-v0-city-by-city-name-bead-by-id-close"));
    expect(req.path).toBe("/v0/city/scratch/bead/rig%2Fx%201/close");
    const sling = await run(work.beadSling("a;b", "frontend/builder"), fixture("post-v0-city-by-city-name-sling"));
    expect(sling.req.body).toEqual({ target: "frontend/builder", bead: "a;b" });
  });

  test("a sling that gc answers partial, with warnings, says so", async () => {
    const { result } = await run(work.beadSling("sc-74", "worker"), {
      status: 200, body: { status: "partial", target: "worker", bead: "sc-74", workflow_id: "wf-1", warnings: ["bead already routed to worker"] },
    });
    expect(result).toEqual({ ok: true, value: { kind: "done", detail: "gc: partial bead sc-74 to worker; workflow wf-1; warnings: bead already routed to worker" } });
  });

  test("gc's validation refusal of a new bead is the action's error, verbatim", async () => {
    const { result } = await run(work.beadCreate({ title: "x", description: "", priority: null, labels: [] }, null), {
      status: 422, body: fixtureBody("create-bead", "validation-failed"),
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "http", status: 422, problem: { detail: "validation failed" } } });
  });

  test("a rig action that could not stop every session says which", async () => {
    const { result } = await run(rigSuspend("frontend"), {
      status: 200, body: { rig: "frontend", action: "suspend", status: "partial", failed: ["sc-6"], killed: ["sc-7"] },
    });
    expect(result).toEqual({ ok: true, value: { kind: "done", detail: "gc: partial; stopped sc-7; failed sc-6" } });
  });

  test("gc's refusal is the action's error, verbatim", async () => {
    const body = fixtureBody("post-v0-city-by-city-name-session-by-id-wake", "closed-session-conflict");
    const { result } = await run(session.sessionWake("sc-20"), { status: 409, body });
    expect(result).toEqual({ ok: false, error: { kind: "http", status: 409, problem: expect.objectContaining({ detail: "session sc-76 is closed" }) } });
  });
});

describe("what each action is", () => {
  test("destructive actions ask first: close, kill, force kill, agent suspend, rig suspend", () => {
    const all = [
      session.sessionNew("w", null), session.sessionWake("s"), session.sessionSuspend("s"), session.sessionStop("s"),
      session.sessionClose("s"), session.sessionKill("s", false), session.sessionKill("s", true), session.sessionPin("s"),
      session.sessionUnpin("s"), session.sessionSubmit("s", "m", "default"), session.sessionMessage("s", "m"),
      session.sessionRespond("s", "r", "approve"), agentSuspend("a"), agentResume("a"), rigSuspend("r"), rigResume("r"),
      work.beadCreate({ title: "t", description: "", priority: null, labels: [] }, null), work.beadSling("b", "a"), work.beadClose("b", ""),
      work.beadReopen("b"),
    ];
    expect(all.filter((s) => s.confirm !== null).map((s) => s.kind)).toEqual([
      "session.close", "session.kill", "session.kill-force", "agent.suspend", "rig.suspend", "bead.sling", "bead.close",
    ]);
    for (const s of all) if (s.confirm) expect(s.confirm.detail.length).toBeGreaterThan(20);
  });

  test("each action names what to refetch after it, and before a retry of an unknown outcome", () => {
    expect(session.sessionWake("s").refresh).toEqual(["sessions", "agents"]);
    expect(session.sessionSubmit("s", "m", "default").refresh).toEqual(["sessions"]);
    expect(session.sessionRespond("s", "r", "deny").refresh).toEqual(["pending", "sessions"]);
    expect(agentSuspend("a").refresh).toEqual(["agents", "sessions"]);
    expect(rigSuspend("r").refresh).toEqual(["rigs", "agents", "sessions"]);
    expect(work.beadCreate({ title: "t", description: "", priority: null, labels: [] }, null).refresh).toEqual(["ready"]);
    expect(work.beadSling("b", "a").refresh).toEqual(["ready", "inProgress", "sessions"]);
    expect(work.beadClose("b", "").refresh).toEqual(["ready", "inProgress"]);
    expect(work.beadReopen("b").refresh).toEqual(["ready", "inProgress"]);
  });

  test("sling asks first and says a retry may route the bead twice: gc declares no Idempotency-Key on it", () => {
    const s = work.beadSling("sc-74", "worker");
    expect(OPERATIONS[s.operationId].idempotencyKey).toBe(false);
    expect(s.confirm).toEqual({
      question: "Sling bead sc-74 to worker?",
      detail: `gc routes the bead to worker (and applies the agent's default formula, if it has one). ${work.SLING_MAY_ROUTE_TWICE}`,
    });
    expect(work.SLING_MAY_ROUTE_TWICE).toBe(
      "gc cannot deduplicate a sling: if its outcome is unknown, a retry may route the bead twice. Check the board first.",
    );
  });

  test("close asks first; its reason is kept for a retry; reopen does not ask", () => {
    const c = work.beadClose("sc-74", "done here");
    expect(c.confirm?.question).toBe("Close bead sc-74?");
    expect(c.confirm?.detail).toBe('gc closes the bead with the reason "done here". Reopen brings it back.');
    expect(work.beadClose("sc-74", "").confirm?.detail).toBe("gc closes the bead, with no reason. Reopen brings it back.");
    expect(work.beadReopen("sc-74").confirm).toBeNull();
  });

  test("a new bead with a sling target carries the sling as its follow-up, built from the created id", () => {
    const create = work.beadCreate({ title: "fix login", description: "", priority: 1, labels: [] }, "frontend/builder");
    expect(create.target).toEqual({ kind: "new-bead", title: "fix login" });
    expect(create.then?.verb).toBe("Sling to frontend/builder");
    const sling = create.then?.spec("sc-80");
    expect(sling?.kind).toBe("bead.sling");
    expect(sling?.target).toEqual({ kind: "bead", id: "sc-80" });
    expect(work.beadCreate({ title: "x", description: "", priority: null, labels: [] }, null).then).toBeUndefined();
  });

  test("the targets are what the activity log shows", () => {
    expect(session.sessionKill("sc-20", true).target).toEqual({ kind: "session", id: "sc-20" });
    expect(agentResume("frontend/builder").target).toEqual({ kind: "agent", name: "frontend/builder" });
    expect(rigResume("frontend").target).toEqual({ kind: "rig", name: "frontend" });
    expect(session.sessionNew("frontend/builder", "x").target).toEqual({ kind: "agent", name: "frontend/builder" });
    expect(work.beadSling("sc-74", "worker").target).toEqual({ kind: "bead", id: "sc-74" });
    expect(work.beadSling("sc-74", "worker").verb).toBe("Sling to worker");
  });

  test("a respond option is gc's verb as given, never translated", () => {
    expect(session.sessionRespond("s", "r", "select: Option B").verb).toBe("select: Option B");
  });
});
