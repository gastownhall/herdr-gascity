// Render tests of the cross-city views in the built bundle: the sidebar
// block (props {view: "sidebar"}) and the Needs a human pane ({view: "inbox"}).

import { describe, expect, test } from "bun:test";
import { findById } from "../harness.ts";
import { FOCUS_KEY } from "../../src/notify/focus.ts";
import { gc, running, text } from "./panel-fixture.ts";

const pending = { items: [{ session_id: "sc-20", request_id: "r-1", kind: "question" }], total: 1 };
const prompt = { supported: true, pending: { request_id: "r-1", kind: "question", prompt: "Ship the release?\nDetails follow.", options: ["yes", "no"] } };

function route() {
  return gc({
    "/v0/city/scratch/pending": { status: 200, body: pending },
    "/v0/city/scratch/session/sc-20/pending": { status: 200, body: prompt },
  });
}

describe("the sidebar block", () => {
  test("lists the city with its question and decisions, without loading its agents or sessions", async () => {
    const mod = await running({ route: route(), props: { view: "sidebar" } }, 8);
    const root = mod.render();
    expect(text(root, "gascity-side-title")).toBe("Cities");
    expect(text(root, "gascity-side-total")).toBe("3 need you");
    expect(text(root, "gascity-side-city-0-name")).toBe("scratch");
    expect(text(root, "gascity-side-city-0-q")).toBe("1 ?");
    expect(text(root, "gascity-side-city-0-meta")).toBe("6 running");
    expect(text(root, "gascity-side-city-0-row-0-body")).toBe("Ship the release?");
    expect(text(root, "gascity-side-city-0-row-1-body")).toBe("Approve the release checklist");
    expect(text(root, "gascity-side-city-0-row-2-body")).toBe("Pick a canary channel");
    const paths = mod.fetched.map((f) => new URL(f.url).pathname);
    expect(paths.some((p) => p.endsWith("/agents") || p.endsWith("/sessions") || p.endsWith("/work/ready"))).toBe(false);
  });

  test("a question opens the Needs you tab on its session; a decision on its bead", async () => {
    const mod = await running({ route: route(), props: { view: "sidebar" } }, 8);
    mod.click("gascity-side-city-0-row-0");
    expect(mod.shared.get(FOCUS_KEY)).toMatchObject({ city: "scratch", session: "sc-20", attach: true });
    const tabNew = mod.herdrCalls.filter((c) => c.name === "run" && c.args[0] === "tab.new").map((c) => c.args[1]);
    expect(tabNew).toEqual([{ space: "s1", name: "Needs you", mod: "gascity", props: { view: "follow" } }]);
    mod.click("gascity-side-city-0-row-1");
    expect(mod.shared.get(FOCUS_KEY)).toMatchObject({ city: "scratch", bead: "sc-90" });
  });

  test("an open Needs you tab is selected, not opened again", async () => {
    const mod = await running({
      route: route(), props: { view: "sidebar" },
      spaces: [{ id: "s1", machine: null, active: true, tabs: [{ id: "t1", active: true, name: "1" }, { id: "t9", active: false, name: "Needs you" }] }],
      panes: [{ pane: "p1", tab: "t1", mod: "gascity", title: "gascity", focused: true }, { pane: "p9", tab: "t9", mod: "gascity", title: "gascity", focused: false }],
    }, 8);
    mod.click("gascity-side-city-0-row-0");
    const runs = mod.herdrCalls.filter((c) => c.name === "run").map((c) => [c.args[0], c.args[1]]);
    expect(runs).toEqual([["tab.select", { id: "t9" }]]);
  });

  test("clicking a city unfolds its counts; the badge opens the Needs a human pane", async () => {
    const mod = await running({ route: route(), props: { view: "sidebar" } }, 8);
    mod.click("gascity-side-city-0");
    await mod.tick();
    const root = mod.render();
    expect(text(root, "gascity-side-city-0-detail-0")).toBe("Agents: 6 of 9 running · 1 suspended");
    expect(text(root, "gascity-side-city-0-detail-2")).toBe("Work: 2 in progress · 26 ready");
    mod.click("gascity-side-total");
    const tabNew = mod.herdrCalls.filter((c) => c.name === "run" && c.args[0] === "tab.new").map((c) => c.args[1]);
    expect(tabNew).toEqual([{ space: "s1", name: "Needs a human", mod: "gascity", props: { view: "inbox" } }]);
  });
});

describe("the Needs a human pane", () => {
  test("questions, then decisions, with filters; Resolve… opens the Needs you tab on the bead", async () => {
    const mod = await running({ route: route(), props: { view: "inbox", overlay: "o-7" } }, 8);
    let root = mod.render();
    expect(text(root, "gascity-inbox-all")).toBe("All 3");
    expect(text(root, "gascity-inbox-group-0")).toBe("Blocking a live session");
    expect(text(root, "gascity-inbox-0-0-title")).toMatch(/: Ship the release\?$/);
    expect(text(root, "gascity-inbox-group-1")).toBe("Waiting on a decision");
    expect(text(root, "gascity-inbox-1-0-title")).toBe("Approve the release checklist");
    mod.click("gascity-inbox-decisions");
    await mod.tick();
    root = mod.render();
    expect(text(root, "gascity-inbox-group-0")).toBe("Waiting on a decision");
    expect(findById(root, "gascity-inbox-group-1")).toBeUndefined();
    mod.click("gascity-inbox-0-0-open");
    expect(mod.shared.get(FOCUS_KEY)).toMatchObject({ city: "scratch", bead: "sc-90" });
    mod.click("gascity-inbox-close");
    expect(mod.herdrCalls.some((c) => c.name === "closeOverlay" && c.args[0] === "o-7")).toBe(true);
    // A pane opened as a window is not the "needs you" window.
    expect(mod.shared.get("gascity.window")).toBeFalsy();
  });
});

describe("the Needs you tab", () => {
  test("follows the shared focus target like the window, with no Close (herdr closes tabs)", async () => {
    const mod = await running({ route: route(), props: { view: "follow" } }, 4);
    mod.shared.set(FOCUS_KEY, { city: "scratch", bead: "fe-1", seq: 3, at: mod.clock.t });
    for (let i = 0; i < 6; i++) await mod.tick();
    const root = mod.render();
    expect(text(root, "gascity-window-target")).toBe("Needs a decision: bead fe-1 in city scratch");
    expect(text(root, "gascity-bead-title")).toMatch(/^Bead fe-1: /);
    expect(findById(root, "gascity-window-close")).toBeUndefined();
    expect(findById(root, "gascity-agents")).toBeUndefined();
  });
});

describe("links to the web dashboard", () => {
  test("none without a dashboardUrl; with one, decisions and the pane link into it", async () => {
    const none = await running({ route: route(), props: { view: "inbox" } }, 8);
    expect(findById(none.render(), "gascity-inbox-1-0-mdash")).toBeUndefined();
    const mod = await running({ route: route(), props: { view: "inbox" }, shared: { "gascity.settings": { dashboardUrl: "https://mdash.example.com" } } }, 8);
    const root = mod.render();
    expect(text(root, "gascity-inbox-mdash")).toBe("Open mdash ↗");
    expect(text(root, "gascity-inbox-1-0-sub")).toContain("human");
    mod.click("gascity-inbox-1-0-mdash");
    await mod.settle();
    const opened = mod.herdrCalls.filter((c) => c.name === "exec").map((c) => c.args.slice(0, 2));
    expect(opened.at(-1)).toEqual([expect.stringMatching(/^(open|xdg-open)$/), ["https://mdash.example.com/city/scratch/beads?bead=sc-90"]]);
  });
});

describe("Answer", () => {
  test("opens the waiting session's terminal: the Needs you tab runs Open terminal (gc session attach) for it", async () => {
    const mod = await running({ route: route(), props: { view: "follow" } }, 4);
    mod.shared.set(FOCUS_KEY, { city: "scratch", session: "sc-6", attach: true, seq: 5, at: mod.clock.t });
    for (let i = 0; i < 8; i++) await mod.tick();
    const tabNew = mod.herdrCalls.filter((c) => c.name === "run" && c.args[0] === "tab.new").map((c) => (c.args[1] as { argv?: string[] }).argv);
    expect(tabNew).toEqual([["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", "gc", "--city", "/scratch/city", "session", "attach", "sc-6"]]);
    // A later tick does not open it again.
    for (let i = 0; i < 4; i++) await mod.tick();
    expect(mod.herdrCalls.filter((c) => c.name === "run" && c.args[0] === "tab.new")).toHaveLength(1);
  });
});

describe("Resolve… on a decision", () => {
  const ATTACH = ["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET", "gc", "--city", "/scratch/city", "session", "attach", "sc-6"];
  const tabNews = (mod: Awaited<ReturnType<typeof running>>) =>
    mod.herdrCalls.filter((c) => c.name === "run" && c.args[0] === "tab.new").map((c) => (c.args[1] as { argv?: string[] }).argv);

  test("a decision whose assignee is one of the city's sessions opens that session's terminal", async () => {
    const assigned = { items: [{ id: "sc-90", title: "Approve the release checklist", status: "open", issue_type: "decision", labels: [], created_at: "2026-11-09T06:24:47Z", assignee: "sc-6" }], total: 1 };
    const mod = await running({ route: gc({ "/v0/city/scratch/beads": { status: 200, body: assigned } }), props: { view: "follow" } }, 4);
    mod.shared.set(FOCUS_KEY, { city: "scratch", bead: "sc-90", attach: true, seq: 6, at: mod.clock.t });
    for (let i = 0; i < 8; i++) await mod.tick();
    expect(tabNews(mod)).toEqual([ATTACH]);
  });

  test("an unassigned decision shows the bead, with Close… and Sling…", async () => {
    const mod = await running({ route: route(), props: { view: "follow" } }, 4);
    mod.shared.set(FOCUS_KEY, { city: "scratch", bead: "sc-90", attach: true, seq: 6, at: mod.clock.t });
    for (let i = 0; i < 8; i++) await mod.tick();
    expect(tabNews(mod)).toEqual([]);
    const root = mod.render();
    expect(text(root, "gascity-window-target")).toBe("Needs a decision: bead sc-90 in city scratch");
    expect(findById(root, "gascity-bead-actions")).toBeDefined();
  });
});
