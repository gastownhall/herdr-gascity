// A copy's work actions (src/copy.ts) against the shared registry, under
// herdr's ownership rule (sync/fakes.ts FakeHost): the selected bead's Sling…
// lists the city's agents and says a retry may route twice; Close… asks with
// a reason; Reopen is sent at once; the new-bead form checks what the person
// typed, then creates (and, with an agent chosen, slings) the bead. Every
// string from gc in a dialog is drawn without control characters.

import { afterEach, describe, expect, test } from "bun:test";
import { SLING_MAY_ROUTE_TWICE } from "../../src/actions/work.ts";
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
    setProbe: () => {},
    settings: () => null,
    setGcBin: () => ok(undefined),
    keyboard: () => false,
    focusTarget: () => null,
    terminal: { scene: () => ok({ spaces: [], panes: [], terminals: [] }), openTab: () => ok(null), selectTab: () => ok(null) },
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

const AGENTS = ["core.control-dispatcher", "frontend/core.control-dispatcher", "worker", "worker-adhoc-88210e2896", "frontend/builder"];
const CREATED = { status: 201, body: fixtureBody("create-bead", "ok") };
const SLUNG = { status: 200, body: fixtureBody("post-v0-city-by-city-name-sling", "ok") };
const json = (b: string | undefined): unknown => JSON.parse(b ?? "null");

/** A copy with the city loaded and bead `id` selected. */
async function withBead(id = "sc-74") {
  const t = setup();
  const a = await t.open();
  await t.host.advance(3000);
  a.copy.selectBead(id);
  await t.host.advance(1000);
  return { ...t, a };
}

describe("sling the selected bead", () => {
  test("Sling… lists the city's agents and says a retry may route twice; picking one sends it, without an Idempotency-Key", async () => {
    const { host, gc, a, click, posts } = await withBead();
    gc.override = (req) => (req.method === "POST" ? SLUNG : undefined);
    await click(a, (c) => c.requestSling());
    expect(a.copy.view(host.now()).dialog).toEqual({
      kind: "pick",
      question: "Sling bead sc-74 to which agent?",
      detail: `gc routes the bead to the agent you pick (and applies the agent's default formula, if it has one). ${SLING_MAY_ROUTE_TWICE}`,
      choices: AGENTS,
    });
    expect(posts("/sling")).toHaveLength(0);
    await click(a, (c) => c.confirm(2));
    expect(posts("/sling").map((r) => json(r.init.body))).toEqual([{ target: "worker", bead: "sc-74" }]);
    expect(posts("/sling")[0]?.init.headers["Idempotency-Key"]).toBeUndefined();
    expect(a.copy.view(host.now()).dialog).toBeNull();
    await host.advance(500);
    expect(a.copy.view(host.now()).activity?.rows[0]).toMatchObject({ title: "Sling to worker · bead sc-74", tone: "done" });
  });

  test("Cancel sends nothing; a sling under way is not sent twice", async () => {
    const { host, gc, a, click, posts } = await withBead();
    await click(a, (c) => c.requestSling());
    await click(a, (c) => c.cancelDialog());
    expect(a.copy.view(host.now()).dialog).toBeNull();
    gc.override = (req) => (req.method === "POST" ? { hold: true } : undefined);
    await click(a, (c) => c.requestSling());
    await click(a, (c) => c.confirm(2));
    await click(a, (c) => c.requestSling());
    await click(a, (c) => c.confirm(4));
    expect(posts("/sling")).toHaveLength(1);
    expect(a.copy.view(host.now()).notice).toBe("Sling to frontend/builder is already under way");
  });

  test("retrying a sling asks again, with the may-route-twice warning", async () => {
    const { host, gc, a, click, posts } = await withBead();
    gc.override = (req) => (req.method === "POST" ? { reject: "error sending request: connection reset by peer" } : undefined);
    await click(a, (c) => c.requestSling());
    await click(a, (c) => c.confirm(2));
    await host.advance(6000);
    const row = a.copy.view(host.now()).activity?.rows[0];
    expect(row?.retry).toEqual({ kind: "retry", label: "Retry (gc cannot deduplicate this: it may happen twice)" });
    await click(a, (c) => c.retryAction(row?.id ?? -1));
    expect(a.copy.view(host.now()).dialog).toEqual({
      kind: "confirm", question: "Retry: Sling bead sc-74 to worker?",
      choices: [{ label: "Sling to worker", detail: expect.stringContaining(SLING_MAY_ROUTE_TWICE) }],
    });
    expect(posts("/sling")).toHaveLength(1);
    gc.override = (req) => (req.method === "POST" ? SLUNG : undefined);
    await click(a, (c) => c.confirm(0));
    expect(posts("/sling")).toHaveLength(2);
  });

  test("no bead selected, or a bead gc does not know: nothing to sling, and the copy says why", async () => {
    const { host, gc, open, click } = setup();
    const a = await open();
    await host.advance(3000);
    await click(a, (c) => c.requestSling());
    expect(a.copy.view(host.now()).notice).toBe("open a bead first");
    gc.override = (req) => (req.path.endsWith("/bead/gone-1") ? { status: 404, body: { title: "Not Found", status: 404, detail: "bead gone-1 not found" } } : undefined);
    a.copy.selectBead("gone-1");
    await host.advance(1000);
    await click(a, (c) => c.requestSling());
    expect(a.copy.view(host.now()).dialog).toBeNull();
    expect(a.copy.view(host.now()).notice).toBe("bead gone-1 is not on the board or known to gc");
  });

  test("agent names and bead ids from gc are drawn without control characters, and sent as gc listed them", async () => {
    const t = setup();
    const a = await t.open();
    t.gc.override = (req) => {
      if (req.path.endsWith("/agents")) {
        const body = fixtureBody("get-v0-city-by-city-name-agents", "ok") as { items: { name: string }[] };
        return { status: 200, body: { ...body, items: [{ ...body.items[2], name: "wor\u001b[31mker\u202e" }] } };
      }
      if (req.method === "POST") return SLUNG;
      return undefined;
    };
    await t.host.advance(3000);
    a.copy.selectBead("sc-\u00077");
    await t.host.advance(1000);
    await t.click(a, (c) => c.requestSling());
    const d = a.copy.view(t.host.now()).dialog;
    expect(d).toMatchObject({ kind: "pick", question: "Sling bead sc-7 to which agent?", choices: ["worker"] });
    await t.click(a, (c) => c.confirm(0));
    expect(t.posts("/sling").map((r) => json(r.init.body))).toEqual([{ target: "wor\u001b[31mker\u202e", bead: "sc-\u00077" }]);
  });
});

describe("close and reopen the selected bead", () => {
  test("Close… asks, with a reason; the reason goes to gc; a blank reason sends none", async () => {
    const { host, gc, a, click, posts } = await withBead();
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "closed" } } : undefined);
    await click(a, (c) => c.requestCloseBead());
    expect(a.copy.view(host.now()).dialog).toEqual({
      kind: "close-bead", question: "Close bead sc-74?",
      detail: "gc closes the bead with the reason below as its close reason (blank: none). Reopen brings it back.",
    });
    expect(posts("/close")).toHaveLength(0);
    let sent = false;
    await click(a, (c) => {
      sent = c.closeBead("  done in the panel ");
    });
    expect(sent).toBe(true);
    expect(posts("/bead/sc-74/close").map((r) => json(r.init.body))).toEqual([{ reason: "done in the panel" }]);
    expect(a.copy.view(host.now()).dialog).toBeNull();
    await host.advance(500);
    await click(a, (c) => c.requestCloseBead());
    await click(a, (c) => c.closeBead(""));
    expect(posts("/bead/sc-74/close").map((r) => r.init.body)).toEqual(['{"reason":"done in the panel"}', undefined]);
  });

  test("closeBead without the dialog open sends nothing", async () => {
    const { a, click, posts } = await withBead();
    let sent = true;
    await click(a, (c) => {
      sent = c.closeBead("x");
    });
    expect(sent).toBe(false);
    expect(posts("/close")).toHaveLength(0);
  });

  test("Reopen is sent at once, without an Idempotency-Key", async () => {
    const { host, gc, a, click, posts } = await withBead();
    gc.override = (req) => (req.method === "POST" ? { status: 200, body: { status: "reopened" } } : undefined);
    await click(a, (c) => c.reopenBead());
    const [reopen] = posts("/bead/sc-74/reopen");
    expect(reopen?.init.body).toBeUndefined();
    expect(reopen?.init.headers["Idempotency-Key"]).toBeUndefined();
    await host.advance(500);
    expect(a.copy.view(host.now()).activity?.rows[0]).toMatchObject({ title: "Reopen · bead sc-74", tone: "done", detail: "gc: reopened" });
  });
});

describe("the new-bead form", () => {
  const form = (title: string, more: Partial<{ description: string; priority: string; labels: string }> = {}) =>
    ({ title, description: more.description ?? "", priority: more.priority ?? "", labels: more.labels ?? "" });

  test("creates the bead with what was typed, and an Idempotency-Key", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(3000);
    t.gc.override = (req) => (req.method === "POST" ? CREATED : undefined);
    await t.click(a, (c) => c.openNewBead());
    expect(a.copy.view(t.host.now()).dialog).toEqual({ kind: "new-bead", agents: AGENTS, slingTo: null, slingToIndex: null, note: null });
    let sent = false;
    await t.click(a, (c) => {
      sent = c.createBead(form(" fix login ", { description: "line 1\nline 2", priority: " 1 ", labels: "ui, p1,, " }));
    });
    expect(sent).toBe(true);
    const [create] = t.posts("/v0/city/scratch/beads");
    expect(json(create?.init.body)).toEqual({ title: "fix login", description: "line 1\nline 2", priority: 1, labels: ["ui", "p1"] });
    expect(create?.init.headers["Idempotency-Key"]).toBe("key-1");
    expect(a.copy.view(t.host.now()).dialog).toBeNull();
    expect(t.posts("/sling")).toHaveLength(0);
  });

  test("with an agent chosen: create, then sling the created bead; the form says a retry of the sling may route twice", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(3000);
    t.gc.override = (req) => (req.method === "POST" ? (req.path.endsWith("/beads") ? CREATED : SLUNG) : undefined);
    await t.click(a, (c) => c.openNewBead());
    await t.click(a, (c) => c.chooseSlingTarget(4));
    expect(a.copy.view(t.host.now()).dialog).toEqual({
      kind: "new-bead", agents: AGENTS, slingTo: "frontend/builder", slingToIndex: 4,
      note: `Two gc calls: create the bead, then sling it to frontend/builder. A retry of the create reuses its key: gc deduplicates it within 30 min, not across a gc restart, and not after a gc-side error (gc then drops the key). ${SLING_MAY_ROUTE_TWICE}`,
    });
    await t.click(a, (c) => c.createBead(form("fix login")));
    await t.host.advance(500);
    expect(t.posts("/beads")).toHaveLength(1);
    expect(t.posts("/sling").map((r) => json(r.init.body))).toEqual([{ target: "frontend/builder", bead: "sc-74" }]);
    expect(a.copy.view(t.host.now()).activity?.rows.map((r) => [r.title, r.tone])).toEqual([
      ["Sling to frontend/builder · bead sc-74", "done"],
      ['New bead · new bead "fix login"', "done"],
    ]);
    // Choosing no agent again clears the target.
    await t.click(a, (c) => c.openNewBead());
    await t.click(a, (c) => c.chooseSlingTarget(4));
    await t.click(a, (c) => c.chooseSlingTarget(null));
    expect(a.copy.view(t.host.now()).dialog).toMatchObject({ slingTo: null, slingToIndex: null, note: null });
  });

  test("refuses a blank title or a priority that is not a whole number, and keeps the form open", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(3000);
    await t.click(a, (c) => c.openNewBead());
    const results: boolean[] = [];
    await t.click(a, (c) => {
      results.push(c.createBead(form("   ")));
    });
    expect(a.copy.view(t.host.now()).notice).toBe("a new bead needs a title");
    await t.click(a, (c) => {
      results.push(c.createBead(form("x", { priority: "high" })), c.createBead(form("x", { priority: "-1" })), c.createBead(form("x", { priority: "1.5" })));
    });
    expect(results).toEqual([false, false, false, false]);
    expect(a.copy.view(t.host.now()).notice).toBe("priority must be a whole number, like 2 (or blank)");
    expect(a.copy.view(t.host.now()).dialog?.kind).toBe("new-bead");
    expect(t.posts("/beads")).toHaveLength(0);
  });

  test("createBead without the form open sends nothing", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(3000);
    let sent = true;
    await t.click(a, (c) => {
      sent = c.createBead(form("x"));
    });
    expect(sent).toBe(false);
    expect(t.posts("/beads")).toHaveLength(0);
  });
});
