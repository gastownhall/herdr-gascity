// Render tests of the actions in the built bundle (gascity/main.js), through
// the fake herdr / gpui-kit modules: every button sends one gc API call with
// X-GC-Request (and Idempotency-Key where gc declares it); destructive ones
// ask first; each action shows pending → done / failed / unknown in the
// activity log; an unknown outcome offers a retry only after the state was
// refetched; the copy that started an action closing leaves it unknown in the
// other copy, never pending and never re-sent.

import { describe, expect, test } from "bun:test";
import { findById, loadMod, textOf, type FakeReply, type RecordedNode } from "../harness.ts";
import { fixtureBody } from "./sync/fakes.ts";

const BASE = "http://127.0.0.1:8372";
const SUBMIT = fixtureBody("submit-session", "accepted") as { request_id: string; event_cursor: string };

type Req = { method: string; headers: Record<string, string>; body?: string };
type Gc = {
  /** Answers mutations; default 200 {status: ok}. */
  post?: (path: string, req: Req) => FakeReply;
  /** Answers outcome polls; default the recorded submit success. */
  outcome?: () => FakeReply;
  /** A session's pending prompt; default none. */
  pending?: unknown;
};

/** gc at the default URL serving the recorded fixtures, with mutations and outcomes as `g` says (mutable). */
function gcRoute(g: Gc) {
  const events = [{ seq: 1, type: "order.fired", ts: "t", actor: "a", subject: "gate-sweep", payload: {} }];
  return (url: string, req: Req): FakeReply | undefined => {
    const u = new URL(url);
    if (u.origin !== BASE) return undefined;
    const p = u.pathname;
    if (req.method === "POST") return g.post?.(p, req) ?? { status: 200, body: { status: "ok" } };
    if (p === "/health") return { status: 200, body: fixtureBody("get-health", "ok") };
    if (p === "/v0/cities") return { status: 200, body: fixtureBody("get-v0-cities", "ok") };
    if (p.includes("/request/")) return g.outcome?.() ?? { status: 200, body: fixtureBody("get-request-outcome", "session-submit") };
    if (p.endsWith("/events")) return { status: 200, body: { items: events, total: 1 } };
    if (p.endsWith("/sessions")) {
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-sessions", u.searchParams.get("wake_reasons") === "true" ? "wake-reasons" : "ok") };
    }
    if (/\/session\/[^/]+\/pending$/.test(p)) return { status: 200, body: g.pending ?? fixtureBody("get-v0-city-by-city-name-session-by-id-pending", "none") };
    if (/\/session\/[^/]+$/.test(p)) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-session-by-id", "peek") };
    if (p.endsWith("/pending")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-pending", "ok") };
    if (p.endsWith("/rigs")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-rigs", "ok") };
    if (p.endsWith("/agents")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-agents", "ok") };
    if (p.endsWith("/work/ready")) {
      const status = u.searchParams.get("status");
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-work-ready", status === "closed" ? "closed-seed" : status === "in_progress" ? "in-progress" : "ready") };
    }
    return { status: 404, body: { title: "Not Found", status: 404, detail: `no route ${p}` } };
  };
}

const text = (root: RecordedNode, id: string) => {
  const node = findById(root, id);
  return node ? textOf(node) : undefined;
};

type Mod = Awaited<ReturnType<typeof loadMod>>;

/** A copy with the city loaded; `g` can be changed by the test as it goes. */
async function running(g: Gc = {}) {
  const mod = await loadMod({ route: gcRoute(g) });
  mod.init();
  await mod.settle();
  for (let i = 0; i < 4; i++) await mod.tick();
  return mod;
}

/** The mutations the copy sent to paths ending with `suffix`. */
const posts = (mod: Mod, suffix: string): (Req & { query: string })[] => mod.fetched
  .filter((f) => (f.init as Req).method === "POST" && new URL(f.url).pathname.endsWith(suffix))
  .map((f) => ({ ...(f.init as Req), query: new URL(f.url).search }));

/** Opens the detail of frontend/builder's session (sc-6). */
async function openDetail(mod: Mod) {
  mod.click("gascity-agent-0-1-session-0");
  await mod.tick();
  await mod.tick();
}

const activityText = (mod: Mod) => text(mod.render(), "gascity-activity") ?? "";

describe("session actions in the detail pane", () => {
  test("the action bar: one button per action; close and kill ask first", async () => {
    const mod = await running();
    await openDetail(mod);
    expect(text(mod.render(), "gascity-detail-actions")).toBe("[Wake] [Suspend] [Stop turn] [Pin] [Unpin] [Close…] [Kill…]");
  });

  test("Wake: one POST with X-GC-Request and an Idempotency-Key; the log shows it pending, then done", async () => {
    const g: Gc = { post: () => "hang" };
    const mod = await running(g);
    await openDetail(mod);
    mod.click("gascity-action-wake");
    const [wake, ...more] = posts(mod, "/session/sc-6/wake");
    expect(more).toEqual([]);
    expect(wake?.headers["X-GC-Request"]).toMatch(/^herdr-gascity\//);
    expect(wake?.headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(activityText(mod)).toContain("Wake · session sc-6 → pending: sending");
    // While it is under way the button waits instead of sending again.
    expect(text(mod.render(), "gascity-action-wake")).toBe("[Wake: under way]");
    expect(() => mod.click("gascity-action-wake")).toThrow();

    g.post = () => ({ status: 200, body: { status: "ok", id: "sc-6" } });
    mod.click("gascity-action-stop");
    await mod.tick();
    expect(activityText(mod)).toContain("Stop turn · session sc-6 → done: gc: ok");
  });

  test("Pin carries no Idempotency-Key: gc does not declare one there", async () => {
    const mod = await running({ post: () => ({ status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok") }) });
    await openDetail(mod);
    mod.click("gascity-action-pin");
    const [pin] = posts(mod, "/session/sc-6/pin");
    expect(pin?.headers["X-GC-Request"]).toMatch(/^herdr-gascity\//);
    expect(pin?.headers["Idempotency-Key"]).toBeUndefined();
  });

  test("Close… asks first: nothing is sent until Close is clicked; Cancel sends nothing", async () => {
    const mod = await running();
    await openDetail(mod);
    mod.click("gascity-action-close");
    let root = mod.render();
    expect(text(root, "gascity-dialog-question")).toBe("Close session sc-6?");
    expect(text(root, "gascity-dialog-detail-0")).toContain("permanently");
    expect(posts(mod, "/close")).toEqual([]);
    mod.click("gascity-dialog-cancel");
    expect(findById(mod.render(), "gascity-dialog")).toBeUndefined();
    expect(posts(mod, "/close")).toEqual([]);
    mod.click("gascity-action-close");
    mod.click("gascity-dialog-confirm-0");
    expect(posts(mod, "/session/sc-6/close")).toHaveLength(1);
    root = mod.render();
    expect(findById(root, "gascity-dialog")).toBeUndefined();
  });

  test("Kill… offers Kill and Force kill; Force kill sends force=true", async () => {
    const mod = await running();
    await openDetail(mod);
    mod.click("gascity-action-kill");
    const root = mod.render();
    expect(text(root, "gascity-dialog-buttons")).toBe("[Kill] [Force kill] [Cancel]");
    mod.click("gascity-dialog-confirm-1");
    expect(posts(mod, "/session/sc-6/kill").map((p) => p.query)).toEqual(["?force=true"]);
  });

  test("Send: the typed text is submitted, the box cleared; a 202 is followed to 'delivered'; Enter sends too", async () => {
    let polls = 0;
    const mod = await running({
      post: () => ({ status: 202, body: SUBMIT }),
      outcome: () => (++polls < 3
        ? { status: 200, body: { request_id: SUBMIT.request_id, operation: "session.submit", state: "pending" } }
        : { status: 200, body: fixtureBody("get-request-outcome", "session-submit") }),
    });
    await openDetail(mod);
    const message = mod.inputs[0]!;
    expect(message.placeholder).toBe("Message to the session");
    expect(findById(mod.render(), "gascity-send")?.calls.some((c) => c.method === "child" && (c.args[0] as { node?: RecordedNode })?.node?.calls.some((x) => x.method === "input"))).toBe(true);
    message.type("close fe-12");
    mod.click("gascity-send-default");
    expect(message.value()).toBe("");
    const [submit] = posts(mod, "/session/sc-6/submit");
    expect(JSON.parse(submit?.body ?? "{}")).toEqual({ message: "close fe-12", intent: "default" });
    expect(submit?.headers["Idempotency-Key"]).toBeDefined();
    await mod.tick(0);
    expect(activityText(mod)).toContain(`accepted, waiting for gc's outcome of request ${SUBMIT.request_id}`);
    for (let i = 0; i < 16; i++) await mod.tick();
    expect(activityText(mod)).toContain("Send · session sc-6 → done: delivered");
    expect(mod.fetched.filter((f) => f.url.includes("/request/")).every((f) => f.url.endsWith(`after_seq=${SUBMIT.event_cursor}`))).toBe(true);

    message.type("second");
    message.submit(mod.cx);
    expect(posts(mod, "/session/sc-6/submit").map((p) => JSON.parse(p.body ?? "{}").message)).toEqual(["close fe-12", "second"]);
  });

  test("an empty send box is refused with a notice, nothing sent", async () => {
    const mod = await running();
    await openDetail(mod);
    mod.click("gascity-send-default");
    expect(text(mod.render(), "gascity-notice")).toBe("type a message first");
    expect(posts(mod, "/submit")).toEqual([]);
  });

  test("Interrupt and send is offered only when gc says the session supports it", async () => {
    const mod = await running();
    await openDetail(mod);
    // The recorded sc-6 supports interrupt_now.
    expect(text(mod.render(), "gascity-send-interrupt")).toBe("[Interrupt and send]");
  });

  test("a pending prompt: one button per gc option, sending the option and request id as gc listed them", async () => {
    const mod = await running({
      pending: { supported: true, pending: { request_id: "perm-1", kind: "permission", prompt: "Run tests?", options: ["approve", "deny", "select:always"] } },
      post: () => ({ status: 202, body: fixtureBody("respond-session", "accepted") }),
    });
    await openDetail(mod);
    expect(text(mod.render(), "gascity-detail-answers")).toBe("[approve] [deny] [select:always]");
    mod.click("gascity-answer-2");
    const [respond] = posts(mod, "/session/sc-6/respond");
    expect(JSON.parse(respond?.body ?? "{}")).toEqual({ action: "select:always", request_id: "perm-1" });
    await mod.tick();
    expect(activityText(mod)).toContain("select:always · session sc-6 → done: gc: accepted");
  });
});

describe("agent and rig actions", () => {
  test("New session… opens a form with an alias box; Start session creates it", async () => {
    const mod = await running({ post: () => ({ status: 202, body: fixtureBody("create-session", "accepted") }), outcome: () => ({ status: 200, body: fixtureBody("get-request-outcome", "session-create") }) });
    mod.click("gascity-agent-0-1-new");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("New session of agent frontend/builder");
    const alias = mod.inputs[1]!;
    alias.type("fix-login");
    mod.click("gascity-dialog-create");
    expect(posts(mod, "/v0/city/scratch/sessions").map((p) => JSON.parse(p.body ?? "{}"))).toEqual([{ kind: "agent", name: "frontend/builder", alias: "fix-login" }]);
    for (let i = 0; i < 6; i++) await mod.tick();
    expect(activityText(mod)).toContain("New session · agent frontend/builder → done: created session sc-76 (rec-mw8vmef1)");
  });

  test("agent Suspend… asks first and uses gc's rig-scoped agent route; rig Suspend… asks first", async () => {
    const mod = await running();
    expect(text(mod.render(), "gascity-agent-0-1-suspend")).toBe("[Suspend agent…]");
    mod.click("gascity-agent-0-1-suspend");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("Suspend agent frontend/builder?");
    mod.click("gascity-dialog-confirm-0");
    const [agent] = posts(mod, "/agent/frontend/builder/suspend");
    expect(agent?.headers["Idempotency-Key"]).toBeUndefined();

    expect(text(mod.render(), "gascity-group-0-suspend")).toBe("[Suspend rig…]");
    mod.click("gascity-group-0-suspend");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("Suspend rig frontend?");
    mod.click("gascity-dialog-confirm-0");
    expect(posts(mod, "/rig/frontend/suspend")).toHaveLength(1);
  });
});

describe("unknown outcomes and the copy that closes", () => {
  test("a lost connection: outcome unknown, no retry until the state was refetched, then a retry with the same key", async () => {
    const g: Gc = { post: () => ({ rejects: "error sending request: connection reset by peer" }) };
    const mod = await running(g);
    await openDetail(mod);
    mod.click("gascity-action-wake");
    await mod.tick(0);
    const rows = findById(mod.render(), "gascity-activity")!;
    expect(textOf(rows)).toContain("→ outcome unknown:");
    const id = /gascity-activity-(\d+)-retry/.exec(JSON.stringify(rows))?.[1];
    expect(text(mod.render(), `gascity-activity-${id}-retry`)).toBe("[Retry: refreshing sessions before a retry]");
    for (let i = 0; i < 4; i++) await mod.tick(1000);
    expect(text(mod.render(), `gascity-activity-${id}-retry`)).toBe("[Retry (gc deduplicates it)]");
    expect(posts(mod, "/wake")).toHaveLength(1);
    g.post = () => ({ status: 200, body: { status: "ok", id: "sc-6" } });
    mod.click(`gascity-activity-${id}-retry`);
    const keys = posts(mod, "/wake").map((p) => p.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await mod.tick();
    expect(activityText(mod)).toContain("Wake · session sc-6 (attempt 2) → done: gc: ok");
  });

  test("the copy that started an action closes: the other copy shows it unknown at once, and it is never re-sent", async () => {
    const mod = await running({ post: () => "hang" });
    const b = mod.copy();
    b.init();
    await b.settle();
    await b.tick();
    await openDetail(mod);
    mod.click("gascity-action-wake");
    expect(textOf(findById(b.render(), "gascity-activity")!)).toContain("→ pending: sending");
    await mod.close();
    expect(textOf(findById(b.render(), "gascity-activity")!)).toContain("→ outcome unknown:");
    for (let i = 0; i < 10; i++) await b.tick(1000);
    expect(posts(mod, "/wake")).toHaveLength(1);
    expect(textOf(findById(b.render(), "gascity-activity")!)).toContain("the Gas City view that started it closed");
  });
});
