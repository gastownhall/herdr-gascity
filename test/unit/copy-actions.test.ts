// A copy's actions (src/copy.ts) against the shared registry, under herdr's
// ownership rule (sync/fakes.ts FakeHost): a click sends its action in the
// copy's own turn; a destructive action asks first; an action under way is
// not sent twice; the activity log is the city's, so a second copy sees the
// outcome of an action whose copy closed — as unknown, never pending.

import { afterEach, describe, expect, test } from "bun:test";
import { agentSuspend } from "../../src/actions/agent.ts";
import { sessionClose, sessionWake } from "../../src/actions/session.ts";
import { CopyController, type CopyHost } from "../../src/copy.ts";
import { DiscoveryController } from "../../src/discovery/controller.ts";
import { ProbeWriter } from "../../src/probe.ts";
import { ok } from "../../src/result.ts";
import { SyncRegistry, TICK_MS } from "../../src/sync/registry.ts";
import { FakeGc, FakeHost, fixtureBody, type Owner } from "./sync/fakes.ts";

interface Opened {
  owner: Owner;
  copy: CopyController;
}

let opened: Opened[] = [];
afterEach(() => {
  for (const o of opened) o.copy.close();
  opened = [];
});

function setup() {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  let keys = 0;
  const registry = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5, newKey: () => `key-${++keys}` });
  const probe = new ProbeWriter({ path: () => "/p", read: () => Promise.resolve(ok(null)), write: () => Promise.resolve(ok(null)) });
  const copyHost: CopyHost = {
    visibility: () => ok({ windowOpen: false, layoutMods: [], panes: [{ pane: "p1", tab: "t1", mod: "gascity" }], focus: { space: "s", tab: "t1" } }),
    probeEnabled: () => false,
    herdrVersion: () => ok("0.1.14"),
    execLog: () => [],
  };
  let n = 0;
  const open = async (): Promise<Opened> => {
    const owner = `copy-${++n}`;
    const discovery = new DiscoveryController({
      settings: () => null,
      gcStatus: () => Promise.resolve(ok("{}")),
      readSupervisorConfig: () => Promise.resolve(ok({ path: "/h/.gc/supervisor.toml", text: null })),
      fetch: registry.probeFetch().fetch,
      probeFetch: () => registry.probeFetch(),
      rememberCity: () => ok(null),
    }, { pinned: null, lastSelection: null });
    const copy = new CopyController({ registry, discovery, host: copyHost, clock: host, probe });
    await host.run(owner, () => {
      void copy.discover({ notify: () => {}, sleep: (ms) => host.sleep(ms) });
      host.every(TICK_MS, () => copy.tick());
    });
    await host.runTurns();
    const o = { owner, copy };
    opened.push(o);
    return o;
  };
  /** A click: runs in the copy's own turn. */
  const click = (o: Opened, fn: (c: CopyController) => void) => host.run(o.owner, () => fn(o.copy));
  const close = (o: Opened) => host.close(o.owner, () => o.copy.close());
  const posts = (suffix: string) => gc.seen.filter((r) => r.method === "POST" && r.path.endsWith(suffix));
  return { host, gc, open, click, close, posts };
}

describe("a copy's actions", () => {
  test("a plain action is sent at once and its row goes pending → done", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "ok", id: "sc-20" } } : undefined);
    await click(a, (c) => c.request(sessionWake("sc-20")));
    expect(posts("/session/sc-20/wake")).toHaveLength(1);
    await host.advance(500);
    const rows = a.copy.view(host.now()).activity?.rows ?? [];
    expect(rows.map((r) => [r.title, r.tone, r.detail])).toEqual([["Wake · session sc-20", "done", "gc: ok"]]);
  });

  test("a destructive action asks first: nothing is sent until confirmed, and cancel sends nothing", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "ok" } } : undefined);
    await click(a, (c) => c.request(sessionClose("sc-20")));
    expect(a.copy.view(host.now()).dialog).toEqual({
      kind: "confirm", question: "Close session sc-20?",
      choices: [{ label: "Close", detail: expect.stringContaining("permanently") }],
    });
    await click(a, (c) => c.cancelDialog());
    expect(a.copy.view(host.now()).dialog).toBeNull();
    expect(posts("/close")).toHaveLength(0);

    await click(a, (c) => c.request(agentSuspend("frontend/builder")));
    await click(a, (c) => c.confirm(0));
    expect(posts("/agent/frontend/builder/suspend")).toHaveLength(1);
  });

  test("kill offers a plain and a forced kill", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "ok" } } : undefined);
    await click(a, (c) => c.requestKill("sc-20"));
    const d = a.copy.view(host.now()).dialog;
    expect(d?.kind === "confirm" ? d.choices.map((x) => x.label) : []).toEqual(["Kill", "Force kill"]);
    await click(a, (c) => c.confirm(1));
    expect(posts("/session/sc-20/kill").map((r) => r.query.get("force"))).toEqual(["true"]);
  });

  test("an action under way is not sent twice; the copy says why", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { hold: true } : undefined);
    await click(a, (c) => c.request(sessionWake("sc-20")));
    await click(a, (c) => c.request(sessionWake("sc-20")));
    expect(posts("/wake")).toHaveLength(1);
    expect(a.copy.view(host.now()).notice).toBe("Wake is already under way");
  });

  test("input goes to the open session: Send, Interrupt and send, Send as message; empty input is refused", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    a.copy.selectSession("sc-20");
    await host.advance(1000);
    gc.override = (req) => (req.method === "POST" ? { status: 202, body: fixtureBody("submit-session", "accepted") } : undefined);
    let sent: boolean[] = [];
    await click(a, (c) => {
      sent = [c.sendInput("  ", "default"), c.sendInput("close fe-12", "default"), c.sendInput("stop", "interrupt_now"), c.sendInput("later", "message")];
    });
    expect(sent).toEqual([false, true, true, true]);
    await host.runTurns();
    expect(posts("/session/sc-20/submit").map((r) => JSON.parse(r.init.body ?? "{}"))).toEqual([
      { message: "close fe-12", intent: "default" }, { message: "stop", intent: "interrupt_now" },
    ]);
    expect(posts("/session/sc-20/messages").map((r) => JSON.parse(r.init.body ?? "{}"))).toEqual([{ message: "later" }]);
  });

  test("an answer sends gc's option and request id for the open session's prompt", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => {
      if (req.path.endsWith("/session/sc-20/pending")) {
        return { status: 200, body: { supported: true, pending: { request_id: "perm-1", kind: "permission", prompt: "Run?", options: ["approve", "deny"] } } };
      }
      if (req.method === "POST") return { status: 202, body: fixtureBody("respond-session", "accepted") };
      return undefined;
    };
    a.copy.selectSession("sc-20");
    await host.advance(1000);
    await click(a, (c) => c.answer("perm-1", "deny"));
    expect(posts("/respond").map((r) => JSON.parse(r.init.body ?? "{}"))).toEqual([{ action: "deny", request_id: "perm-1" }]);
  });

  test("A1: the prompt changed between drawing and the click: nothing is sent, and the copy says to review it", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    let prompt = { request_id: "perm-A", kind: "permission", prompt: "Delete the build cache?", options: ["approve", "deny"] };
    gc.override = (req) => {
      if (req.path.endsWith("/session/sc-20/pending")) return { status: 200, body: { supported: true, pending: prompt } };
      if (req.path === "/v0/city/scratch/pending") {
        return { status: 200, body: { items: [{ session_id: "sc-20", request_id: prompt.request_id, kind: "permission" }], total: 1 } };
      }
      if (req.method === "POST") return { status: 202, body: fixtureBody("respond-session", "accepted") };
      return undefined;
    };
    a.copy.selectSession("sc-20");
    await host.advance(1000);
    const shown = a.copy.view(host.now()).detail;
    if (shown.kind !== "session" || shown.pending.kind !== "prompt") throw new Error("no prompt shown");
    const drawn = { requestId: shown.pending.answer.requestId, option: shown.pending.answer.options[1] as string };
    expect(drawn).toEqual({ requestId: "perm-A", option: "deny" });
    // gc resolved A elsewhere and the agent raised B, with its options in another order.
    prompt = { request_id: "perm-B", kind: "permission", prompt: "Push to main?", options: ["deny", "approve"] };
    await host.advance(5500);
    await click(a, (c) => c.answer(drawn.requestId, drawn.option));
    await host.runTurns();
    expect(posts("/respond")).toEqual([]);
    expect(a.copy.view(host.now()).notice).toBe("the prompt changed: review it before answering");
  });

  test("new session: the form names the agent, and create sends its alias", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 202, body: fixtureBody("create-session", "accepted") } : undefined);
    await click(a, (c) => c.openNewSession("frontend/builder"));
    expect(a.copy.view(host.now()).dialog).toEqual({ kind: "new-session", agent: "frontend/builder" });
    await click(a, (c) => c.createSession(" fix-login "));
    expect(posts("/sessions").map((r) => JSON.parse(r.init.body ?? "{}"))).toEqual([{ kind: "agent", name: "frontend/builder", alias: "fix-login" }]);
    expect(a.copy.view(host.now()).dialog).toBeNull();
  });

  test("the copy that started an action closes: the other copy shows it unknown, and may retry once the state is refetched", async () => {
    const { host, gc, open, click, close, posts } = setup();
    const a = await open();
    const b = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { hold: true } : undefined);
    await click(a, (c) => c.request(sessionWake("sc-20")));
    await close(a);
    const row = b.copy.view(host.now()).activity?.rows[0];
    expect(row?.tone).toBe("unknown");
    await host.advance(6000);
    const ready = b.copy.view(host.now()).activity?.rows[0];
    expect(ready?.retry).toEqual({ kind: "retry", label: "Retry (same key: gc deduplicates it within 30 min, not across a gc restart)" });
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "ok" } } : undefined);
    await click(b, (c) => c.retryAction(ready?.id ?? -1));
    expect(posts("/wake")).toHaveLength(2);
    expect(posts("/wake").map((r) => r.init.headers["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
  });

  test("retrying a destructive action asks again", async () => {
    const { host, gc, open, click, posts } = setup();
    const a = await open();
    await host.advance(3000);
    gc.override = (req) => (req.method === "POST" ? { status: 500, body: { title: "x", status: 500, detail: "boom" } } : undefined);
    await click(a, (c) => c.request(sessionClose("sc-20")));
    await click(a, (c) => c.confirm(0));
    await host.advance(500);
    const id = a.copy.view(host.now()).activity?.rows[0]?.id ?? -1;
    await click(a, (c) => c.retryAction(id));
    expect(posts("/close")).toHaveLength(1);
    expect(a.copy.view(host.now()).dialog).toMatchObject({ kind: "confirm", question: "Retry: Close session sc-20?" });
    await click(a, (c) => c.confirm(0));
    expect(posts("/close")).toHaveLength(2);
  });
});
