// Render tests of the agents panel in the built bundle (gascity/main.js),
// through the fake herdr / gpui-kit modules: the copy discovers in its init
// task, starts shared work only from its periodic timer, renders rigs →
// agents → sessions from the shared snapshot, opens a detail, shows errors
// and staleness, writes the probe, and on close starts nothing.

import { describe, expect, spyOn, test } from "bun:test";
import { findById, loadMod, textOf } from "../harness.ts";
import { BASE, gc, running, text } from "./panel-fixture.ts";
import { fixtureBody } from "./sync/fakes.ts";

describe("the copy's lifecycle", () => {
  test("init starts discovery and one periodic timer of 250 ms; no city request before the first tick", async () => {
    const mod = await loadMod({ route: gc() });
    mod.init();
    await mod.settle();
    expect(mod.cx.timerPeriods).toEqual([250]);
    expect(mod.fetched.map((f) => new URL(f.url).pathname)).toEqual(["/health", "/v0/cities"]);
    await mod.tick();
    expect(mod.fetched.some((f) => f.url.includes("/v0/city/scratch/"))).toBe(true);
  });

  test("two copies share one store; closing one starts nothing, and the other keeps polling", async () => {
    const mod = await loadMod({ route: gc() });
    const b = mod.copy();
    mod.init();
    b.init();
    await mod.settle();
    await b.settle();
    await mod.tick();
    await b.tick();
    const cursorReads = mod.fetched.filter((f) => f.url.endsWith("/events?limit=1")).length;
    expect(cursorReads).toBe(1);
    const before = mod.fetched.length;
    await mod.close();
    expect(mod.fetched.length).toBe(before);
    await b.tick(2_000);
    await b.tick(2_000);
    expect(mod.fetched.length).toBeGreaterThan(before);
    expect(text(b.render(), "gascity-chip")).toBe("connected");
  });
});

describe("visibility reads", () => {
  test("herdr's panes(), focused() and layout() are read once per app per window, not by every copy every tick", async () => {
    const mod = await loadMod({ route: gc() });
    const b = mod.copy();
    const c = mod.copy();
    mod.init();
    b.init();
    c.init();
    await mod.settle();
    const before = mod.herdrCalls.filter((x) => x.name === "panes").length;
    for (let i = 0; i < 8; i++) {
      await mod.tick(250);
      await b.tick(0);
      await c.tick(0);
    }
    // 2 s of ticks by three copies (24 ticks): at most one read per second
    const reads = mod.herdrCalls.filter((x) => x.name === "panes").length - before;
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(3);
    for (const name of ["focused", "layout"]) expect(mod.herdrCalls.filter((x) => x.name === name).length).toBeLessThanOrEqual(3);
  });

  test("a render (herdr re-renders on a live-data change) makes the next tick read again", async () => {
    const mod = await loadMod({ route: gc() });
    mod.init();
    await mod.settle();
    await mod.tick(250);
    const before = mod.herdrCalls.filter((x) => x.name === "panes").length;
    await mod.tick(250);
    expect(mod.herdrCalls.filter((x) => x.name === "panes").length).toBe(before);
    mod.render();
    await mod.tick(250);
    expect(mod.herdrCalls.filter((x) => x.name === "panes").length).toBe(before + 1);
  });
});

describe("agents panel", () => {
  test("rigs → agents → sessions, with status, pool, and sessions that match no agent never dropped", async () => {
    const mod = await running();
    const root = mod.render();
    expect(text(root, "gascity-group-0")).toBe("▾ rig: frontend · 2 agents · 1 running");
    expect(text(root, "gascity-group-1")).toBe("▾ city");
    expect(text(root, "gascity-agents-age")).toMatch(/^data \d+ s old$/);
    const all = textOf(findById(root, "gascity-agents-body")!);
    expect(all).toContain("frontend/builder · pool 0–unlimited · unknown");
    expect(all).toContain("session sc-6: frontend/builder · unknown · no active bead");
    expect(all).toContain("session sc-20:");
  });

  test("a rig with more agents than a page lists one page and a Show more button that lists the next", async () => {
    const recorded = fixtureBody("get-v0-city-by-city-name-agents", "ok") as { items: Record<string, unknown>[]; total: number };
    const template = recorded.items[0]!;
    const extra = Array.from({ length: 30 }, (_, i) => ({ ...template, name: `frontend/extra-${i}`, display_name: "", rig: "frontend" }));
    const items = [...recorded.items, ...extra];
    const mod = await running({ route: gc({ "/v0/city/scratch/agents": { status: 200, body: { ...recorded, items, total: items.length } } }) });
    const inFrontend = items.filter((a) => a.rig === "frontend").length;
    expect(findById(mod.render(), "gascity-agent-0-19")).toBeDefined();
    expect(findById(mod.render(), "gascity-agent-0-20")).toBeUndefined();
    expect(text(mod.render(), "gascity-group-0-more")).toBe(`Show ${Math.min(20, inFrontend - 20)} more · ${inFrontend - 20} not shown`);
    mod.click("gascity-group-0-more");
    const root = mod.render();
    expect(findById(root, `gascity-agent-0-${Math.min(40, inFrontend) - 1}`)).toBeDefined();
    if (inFrontend <= 40) expect(findById(root, "gascity-group-0-more")).toBeUndefined();
  });

  test("clicking a group collapses it", async () => {
    const mod = await running();
    mod.click("gascity-group-0");
    expect(findById(mod.render(), "gascity-agent-0-0")).toBeUndefined();
    mod.click("gascity-group-0");
    expect(findById(mod.render(), "gascity-agent-0-0")).toBeDefined();
  });

  test("clicking a session opens its detail: output as plain lines, wake reasons, pending prompt; Close closes it", async () => {
    const mod = await running();
    const builder = findById(mod.render(), "gascity-agent-0-1-session-0")!;
    builder.handlers.on_click!({}, mod.cx);
    for (let i = 0; i < 3; i++) await mod.tick();
    const root = mod.render();
    expect(text(root, "gascity-detail-title")).toBe("Detail: frontend/builder / frontend/builder");
    expect(text(root, "gascity-detail-line-0")).toBe("CANARY READY");
    expect(text(root, "gascity-detail-line-1")).toBe("second line");
    expect(text(root, "gascity-detail-wake")).toBe("Wake reasons: gc did not list this session under its template");
    expect(text(root, "gascity-detail-pending-0")).toBe("Pending prompt: this session's provider has none");
    mod.click("gascity-detail-close");
    expect(findById(mod.render(), "gascity-detail")).toBeUndefined();
  });

  test("a session's conversation shows each turn under its role, oldest first, and says when older turns are not shown", async () => {
    const base = gc();
    const conversation = {
      ...(fixtureBody("get-v0-city-by-city-name-session-by-id-transcript", "conversation") as object),
      pagination: { has_older_messages: true, total_message_count: 9, returned_message_count: 2, total_compactions: 1 },
    };
    const mod = await running({ route: (url) => (new URL(url).pathname.endsWith("/transcript") ? { status: 200, body: conversation } : base(url)) });
    findById(mod.render(), "gascity-agent-0-1-session-0")!.handlers.on_click!({}, mod.cx);
    for (let i = 0; i < 3; i++) await mod.tick();
    const root = mod.render();
    expect(text(root, "gascity-detail-older")).toBe("older turns are not shown");
    expect(text(root, "gascity-detail-turn-0")).toBe("user · 2026-11-16T17:20:00Z");
    expect(text(root, "gascity-detail-line-0")).toBe("fix the login test");
    expect(text(root, "gascity-detail-turn-1")).toBe("assistant · 2026-11-16T17:20:04Z");
    expect(text(root, "gascity-detail-line-1")).toBe("Looking at the test first.");
    expect(text(root, "gascity-detail-line-2")).toBe("[Bash]");
  });

  test("a failing read keeps the last data, greyed, with the error above it", async () => {
    let fail = false;
    const base = gc();
    const mod = await running({
      route: (url) => (fail && new URL(url).pathname.endsWith("/sessions") ? { status: 500, body: { title: "boom", status: 500, detail: "db\u0007 down" } } : base(url)),
    });
    fail = true;
    for (let i = 0; i < 3; i++) await mod.tick(2_500);
    const root = mod.render();
    expect(text(root, "gascity-agents-error")).toBe("sessions: gc answered 500: db down");
    expect(text(root, "gascity-agents-body")).toContain("session sc-20:");
  });

  test("gc-supplied text is drawn without control characters", async () => {
    const base = gc();
    const mod = await running({
      route: (url) => (new URL(url).pathname === "/v0/cities"
        ? { status: 200, body: { items: [{ name: "scratch", path: "/c", running: true }, { name: "ev\u001b[2Jil", path: "/e", running: false, status: "stop\u0007ped" }], total: 2 } }
        : base(url)),
    });
    expect(text(mod.render(), "gascity-others")).toBe("Other cities: evil (stopped)");
  });
});

describe("diagnostics and the probe", () => {
  test("recorded failures are listed in the diagnostics drawer", async () => {
    const base = gc();
    const mod = await running({ route: (url) => (new URL(url).pathname.endsWith("/rigs") ? { status: 500, body: { detail: "rigs broke" } } : base(url)) });
    mod.click("gascity-diagnostics-toggle");
    const drawer = text(mod.render(), "gascity-diagnostics-drawer") ?? "";
    expect(drawer).toContain("rigs: gc answered 500: rigs broke");
  });

  test("a failure written to herdr's log is cleaned: no escape or control character from gc's city name or error reaches the log", async () => {
    const base = gc();
    const name = "scr\u001b]0;pwned\u0007at\u202ech";
    const logged: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    try {
      await running({
        route: (url) => {
          const p = new URL(url).pathname;
          if (p === "/v0/cities") return { status: 200, body: { items: [{ name, path: "/c", running: true }], total: 1 } };
          if (p.endsWith("/rigs")) return { status: 500, body: { detail: "rigs\u001b[31m broke\u2028again" } };
          return base(url);
        },
      });
    } finally {
      spy.mockRestore();
    }
    const line = logged.find((l) => l.includes(": rigs: "));
    expect(line).toBe("gascity: scratch: rigs: gc answered 500: rigs broke again");
  });

  test("with shared gascity.probe on, the copy writes the probe under the app home", async () => {
    const written = new Map<string, string>();
    const mod = await running({ shared: { "gascity.probe": true }, written });
    const doc = JSON.parse(written.get("/home/person/.config/herdr-app/data/gascity-probe/probe.json") ?? "null");
    expect(doc).toMatchObject({
      schema: "gascity-herdr-probe/4", herdr_version: "0.1.14", connection: { text: "connected" }, city: "scratch",
      discovery: { source: "default", url: BASE }, visibility: { on_screen: true },
    });
    expect(doc.sessions.map((s: { id: string }) => s.id).sort()).toEqual(["sc-20", "sc-5", "sc-6"]);
    expect(doc.exec_log).toEqual([{ at: expect.any(Number), kind: "exec", argv: ["gc", "supervisor", "status", "--json"] }]);
    void mod;
  });

  test("with the probe off, nothing is written", async () => {
    const written = new Map<string, string>();
    await running({ written });
    expect(written.size).toBe(0);
  });
});

describe("Needs a human", () => {
  test("lists the city's questions, then its human beads, above the agents; a row opens the session's or the bead's detail", async () => {
    const pending = { items: [{ session_id: "sc-20", request_id: "r-1", kind: "question" }], total: 1 };
    const mod = await running({ route: gc({ "/v0/city/scratch/pending": { status: 200, body: pending } }) });
    for (let i = 0; i < 3; i++) await mod.tick();
    let root = mod.render();
    expect(text(root, "gascity-human-title")).toBe("Needs a human · 1 question · 2 decisions");
    expect(text(root, "gascity-human-0")).toMatch(/^\? .+ asks \(question\) · session sc-20$/);
    expect(text(root, "gascity-human-1")).toMatch(/^◆ sc-90 · P1 · "Approve the release checklist" · \d+ (s|min|h|d) · \[release\]$/);
    expect(text(root, "gascity-human-2")).toMatch(/^◆ sc-91 · "Pick a canary channel" · \d+ (s|min|h|d)$/);
    mod.click("gascity-human-1");
    for (let i = 0; i < 3; i++) await mod.tick();
    root = mod.render();
    expect(text(root, "gascity-bead-title")).toMatch(/^Bead sc-90: /);
    expect(text(root, "gascity-human-1")).toMatch(/^▸ ◆ sc-90/);
    mod.click("gascity-human-0");
    for (let i = 0; i < 3; i++) await mod.tick();
    expect(findById(mod.render(), "gascity-detail")).toBeDefined();
  });

  test("a city with nothing waiting on a person shows no region", async () => {
    const mod = await running({ route: gc({ "/v0/city/scratch/beads": { status: 200, body: { items: [], total: 0 } } }) });
    for (let i = 0; i < 3; i++) await mod.tick();
    expect(findById(mod.render(), "gascity-human")).toBeUndefined();
  });
});
