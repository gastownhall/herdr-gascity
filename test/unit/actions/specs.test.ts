// The action specs (src/actions/session.ts, agent.ts, rig.ts): each one is a
// single gc API call. These tests pin the exact request every action sends —
// method, path, query, body, X-GC-Request, and Idempotency-Key exactly where
// the pinned spec declares it — and how its answer reads, from the recorded
// fixtures.

import { describe, expect, test } from "bun:test";
import { agentResume, agentSuspend } from "../../../src/actions/agent.ts";
import type { ActionSpec } from "../../../src/actions/activity.ts";
import { rigResume, rigSuspend } from "../../../src/actions/rig.ts";
import * as session from "../../../src/actions/session.ts";
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

const fixture = (op: string, name = "ok") => ({ status: op === "create-session" || op === "submit-session" || op === "send-session-message" || op === "respond-session" ? 202 : 200, body: fixtureBody(op, name) });

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
      "post-v0-city-by-city-name-session-by-id-kill", "submit-session", "send-session-message", "respond-session",
    ]));
    expect(new Set(unkeyed)).toEqual(new Set([
      "post-v0-city-by-city-name-session-by-id-pin", "post-v0-city-by-city-name-session-by-id-unpin",
      "post-v0-city-by-city-name-agent-by-base-by-action", "post-v0-city-by-city-name-agent-by-dir-by-base-by-action",
      "post-v0-city-by-city-name-rig-by-name-by-action",
    ]));
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
    ];
    expect(all.filter((s) => s.confirm !== null).map((s) => s.kind)).toEqual([
      "session.close", "session.kill", "session.kill-force", "agent.suspend", "rig.suspend",
    ]);
    for (const s of all) if (s.confirm) expect(s.confirm.detail.length).toBeGreaterThan(20);
  });

  test("each action names what to refetch after it, and before a retry of an unknown outcome", () => {
    expect(session.sessionWake("s").refresh).toEqual(["sessions", "agents"]);
    expect(session.sessionSubmit("s", "m", "default").refresh).toEqual(["sessions"]);
    expect(session.sessionRespond("s", "r", "deny").refresh).toEqual(["pending", "sessions"]);
    expect(agentSuspend("a").refresh).toEqual(["agents", "sessions"]);
    expect(rigSuspend("r").refresh).toEqual(["rigs", "agents", "sessions"]);
  });

  test("the targets are what the activity log shows", () => {
    expect(session.sessionKill("sc-20", true).target).toEqual({ kind: "session", id: "sc-20" });
    expect(agentResume("frontend/builder").target).toEqual({ kind: "agent", name: "frontend/builder" });
    expect(rigResume("frontend").target).toEqual({ kind: "rig", name: "frontend" });
    expect(session.sessionNew("frontend/builder", "x").target).toEqual({ kind: "agent", name: "frontend/builder" });
  });

  test("a respond option is gc's verb as given, never translated", () => {
    expect(session.sessionRespond("s", "r", "select: Option B").verb).toBe("select: Option B");
  });
});
