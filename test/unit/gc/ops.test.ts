// ops.ts: one typed function per used operation (design §4, §13.2). Every
// function is called against a recording fetch; together they must hit every
// operation in api/used-surface.json, with X-GC-Request on every mutation and
// Idempotency-Key exactly where the pinned spec declares it.

import { describe, expect, test } from "bun:test";
import { createGcClient, X_GC_REQUEST, type GcClient, type HostRequest } from "../../../src/gc/client.ts";
import { OPERATIONS, type OperationId } from "../../../src/gc/operations.gen.ts";
import * as ops from "../../../src/gc/ops.ts";
import usedSurface from "../../../api/used-surface.json";

interface Sent {
  url: string;
  init: HostRequest;
}

function recorder(): { c: GcClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const made = createGcClient({
    baseUrl: "http://127.0.0.1:8372",
    fetch: (url, init) => {
      sent.push({ url, init });
      // Every call fails the same way; this test is about what is sent.
      return Promise.resolve({ status: 418, ok: false, url, text: () => Promise.resolve("") });
    },
  });
  if (!made.ok) throw new Error("client");
  return { c: made.value, sent };
}

/** The operation a sent request addresses, from the pinned path templates. */
function operationOf(method: string, url: string): OperationId {
  const path = new URL(url).pathname;
  const hits = (Object.keys(OPERATIONS) as OperationId[]).filter((id) => {
    const op = OPERATIONS[id];
    const re = new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return op.method === method && re.test(path);
  });
  if (hits.length !== 1) throw new Error(`${method} ${path} matches ${hits.join(", ") || "no operation"}`);
  return hits[0]!;
}

const C = "my-city";
const K = "key-1";

/** Every ops function, called once, with the exact request it must send. */
const CASES: [string, (c: GcClient) => Promise<unknown>, string, string][] = [
  ["getHealth", (c) => ops.getHealth(c), "GET", "/health"],
  ["listCities", (c) => ops.listCities(c), "GET", "/v0/cities"],
  ["listRigs", (c) => ops.listRigs(c, C), "GET", "/v0/city/my-city/rigs"],
  ["listAgents", (c) => ops.listAgents(c, C), "GET", "/v0/city/my-city/agents"],
  ["listSessions", (c) => ops.listSessions(c, C, { limit: 500, cursor: "abc" }), "GET", "/v0/city/my-city/sessions?limit=500&cursor=abc"],
  ["listSessions (wake reasons)", (c) => ops.listSessions(c, C, { template: "frontend/worker", wake_reasons: true }), "GET",
    "/v0/city/my-city/sessions?template=frontend%2Fworker&wake_reasons=true"],
  ["getSession", (c) => ops.getSession(c, C, "s-1", { peek: true, peek_lines: 40 }), "GET", "/v0/city/my-city/session/s-1?peek=true&peek_lines=40"],
  ["listPending", (c) => ops.listPending(c, C), "GET", "/v0/city/my-city/pending"],
  ["getSessionPending", (c) => ops.getSessionPending(c, C, "s-1"), "GET", "/v0/city/my-city/session/s-1/pending"],
  ["listWork", (c) => ops.listWork(c, C, { status: "closed", sort: "newest", limit: 20, exclude_type: ["session"] }), "GET",
    "/v0/city/my-city/work/ready?status=closed&sort=newest&limit=20&exclude_type=session"],
  ["getBead", (c) => ops.getBead(c, C, "fe-1"), "GET", "/v0/city/my-city/bead/fe-1"],
  ["pollEvents", (c) => ops.pollEvents(c, C, { limit: 50 }), "GET", "/v0/city/my-city/events?limit=50"],
  ["getRequestOutcome", (c) => ops.getRequestOutcome(c, C, "req-1", "220"), "GET", "/v0/city/my-city/request/req-1?after_seq=220"],
  ["createSession", (c) => ops.createSession(c, C, { kind: "agent", name: "worker" }, K), "POST", "/v0/city/my-city/sessions"],
  ["submitSession", (c) => ops.submitSession(c, C, "s-1", { message: "hi", intent: "default" }, K), "POST", "/v0/city/my-city/session/s-1/submit"],
  ["sendSessionMessage", (c) => ops.sendSessionMessage(c, C, "s-1", { message: "hi" }, K), "POST", "/v0/city/my-city/session/s-1/messages"],
  ["respondSession", (c) => ops.respondSession(c, C, "s-1", { action: "approve", request_id: "p-1" }, K), "POST", "/v0/city/my-city/session/s-1/respond"],
  ["wakeSession", (c) => ops.wakeSession(c, C, "s-1", K), "POST", "/v0/city/my-city/session/s-1/wake"],
  ["suspendSession", (c) => ops.suspendSession(c, C, "s-1", K), "POST", "/v0/city/my-city/session/s-1/suspend"],
  ["stopSession", (c) => ops.stopSession(c, C, "s-1", K), "POST", "/v0/city/my-city/session/s-1/stop"],
  ["closeSession", (c) => ops.closeSession(c, C, "s-1", K), "POST", "/v0/city/my-city/session/s-1/close"],
  ["killSession", (c) => ops.killSession(c, C, "s-1", K, { force: true }), "POST", "/v0/city/my-city/session/s-1/kill?force=true"],
  ["pinSession", (c) => ops.pinSession(c, C, "s-1"), "POST", "/v0/city/my-city/session/s-1/pin"],
  ["unpinSession", (c) => ops.unpinSession(c, C, "s-1"), "POST", "/v0/city/my-city/session/s-1/unpin"],
  ["agentAction (city agent)", (c) => ops.agentAction(c, C, "worker", "suspend"), "POST", "/v0/city/my-city/agent/worker/suspend"],
  ["agentAction (rig agent)", (c) => ops.agentAction(c, C, "frontend/builder", "resume"), "POST", "/v0/city/my-city/agent/frontend/builder/resume"],
  ["rigAction", (c) => ops.rigAction(c, C, "frontend", "restart"), "POST", "/v0/city/my-city/rig/frontend/restart"],
  ["sling", (c) => ops.sling(c, C, { target: "worker", bead: "fe-1" }), "POST", "/v0/city/my-city/sling"],
  ["createBead", (c) => ops.createBead(c, C, { title: "t" }, K), "POST", "/v0/city/my-city/beads"],
  ["closeBead", (c) => ops.closeBead(c, C, "fe-1", { reason: "done" }), "POST", "/v0/city/my-city/bead/fe-1/close"],
  ["reopenBead", (c) => ops.reopenBead(c, C, "fe-1"), "POST", "/v0/city/my-city/bead/fe-1/reopen"],
];

describe("each ops function sends its operation", () => {
  for (const [name, call, method, path] of CASES) {
    test(name, async () => {
      const { c, sent } = recorder();
      await call(c);
      expect(sent).toHaveLength(1);
      const { url, init } = sent[0]!;
      expect([init.method, url.slice("http://127.0.0.1:8372".length)]).toEqual([method, path]);
      const op = OPERATIONS[operationOf(init.method, url)];
      expect(init.headers["X-GC-Request"]).toBe(init.method === "GET" ? undefined : X_GC_REQUEST);
      expect(init.headers["Idempotency-Key"]).toBe(op.idempotencyKey ? K : undefined);
    });
  }
});

describe("the used surface", () => {
  test("ops.ts reaches exactly the operations in api/used-surface.json", async () => {
    const hit = new Set<OperationId>();
    for (const [, call] of CASES) {
      const { c, sent } = recorder();
      await call(c);
      for (const s of sent) hit.add(operationOf(s.init.method, s.url));
    }
    expect([...hit].sort()).toEqual(Object.keys(usedSurface.operations).sort() as OperationId[]);
  });

  test("ops.ts exports nothing but the tested functions", () => {
    const tested = new Set(CASES.map(([name]) => name.split(" ")[0]!));
    const exported = Object.entries(ops).filter(([, v]) => typeof v === "function").map(([k]) => k);
    expect(exported.filter((k) => !tested.has(k))).toEqual([]);
  });

  test("the event poll can never block: pollEvents sends no index or wait", async () => {
    const { c, sent } = recorder();
    // @ts-expect-error index/wait are not part of pollEvents' query type
    await ops.pollEvents(c, C, { limit: 50, index: "9", wait: "24s" });
    expect(sent[0]!.url).toBe("http://127.0.0.1:8372/v0/city/my-city/events?limit=50");
  });
});
