// Render tests of the work board in the built bundle (gascity/main.js),
// through the fake herdr / gpui-kit modules: Ready, In progress and Recently
// closed from the shared snapshot, the infrastructure filter chip, a bead's
// detail on click, errors and staleness, plain text only, and the probe.

import { describe, expect, test } from "bun:test";
import { findById, textOf } from "../harness.ts";
import { gc, running, text } from "./panel-fixture.ts";

describe("work board", () => {
  test("three columns from gc's recorded data, the filter chip, and the closed seed under its divider", async () => {
    const mod = await running();
    const root = mod.render();
    expect(text(root, "gascity-work-title")).toBe("Work");
    expect(text(root, "gascity-work-filter")).toBe("hiding infrastructure beads (session, message, molecule, gate) · 1 hidden");
    expect(text(root, "gascity-col-ready-title")).toBe("Ready (4)");
    expect(text(root, "gascity-card-ready-0")).toBe('sc-18 · P2 · "Scratch task one" · open · task');
    expect(text(root, "gascity-card-ready-1")).toBe('fe-1 · "Frontend rig task" · open · task');
    expect(text(root, "gascity-col-ready-age")).toMatch(/^data \d+ s old$/);
    expect(text(root, "gascity-col-inprogress-title")).toBe("In progress (0)");
    expect(text(root, "gascity-col-inprogress-empty")).toBe("nothing in progress");
    expect(text(root, "gascity-col-closed-title")).toBe("Recently closed (18)");
    expect(text(root, "gascity-col-closed-divider")).toBe("earlier (by creation time)");
    expect(text(root, "gascity-card-earlier-0")).toBe('sc-73 · "order:gate-sweep" · closed · task · [order-run:gate-sweep, order-tracking, exec] · reason: order dispatch completed: tracking bead lifecycle finished');
    expect(textOf(findById(root, "gascity-work")!)).not.toContain("sc-60");
  });

  test("clicking a card opens its detail with the description fetched by id; clicking again or Close closes it", async () => {
    const mod = await running();
    mod.click("gascity-card-ready-3");
    for (let i = 0; i < 3; i++) await mod.tick();
    let root = mod.render();
    expect(text(root, "gascity-card-ready-3")).toBe('▸ sc-74 · P2 · "recorder bead mw8vmef1" · open · task');
    expect(text(root, "gascity-bead-title")).toBe('Bead sc-74: "recorder bead mw8vmef1"');
    expect(text(root, "gascity-bead-facts")).toBe("status: open · priority: P2 · type: task · created: 2026-11-09T06:24:47.530735668Z · updated: 2026-11-09T06:24:47.530735668Z");
    expect(text(root, "gascity-bead-line-0")).toBe("recorded for the herdr-gascity contract fixtures");
    expect(mod.fetched.filter((f) => f.url.endsWith("/bead/sc-74")).length).toBe(1);
    mod.click("gascity-bead-close");
    expect(findById(mod.render(), "gascity-bead-detail")).toBeUndefined();
    mod.click("gascity-card-ready-3");
    mod.click("gascity-card-ready-3");
    root = mod.render();
    expect(findById(root, "gascity-bead-detail")).toBeUndefined();
  });

  test("a failing column keeps its last cards, greyed, with the error above them", async () => {
    let fail = false;
    const base = gc();
    const mod = await running({
      route: (url) => {
        const u = new URL(url);
        return fail && u.pathname.endsWith("/work/ready") && !u.searchParams.has("status") ? { status: 503, body: { detail: "store\u001b[31m busy" } } : base(url);
      },
    });
    fail = true;
    for (let i = 0; i < 300; i++) await mod.tick(250);
    const root = mod.render();
    expect(text(root, "gascity-col-ready-error")).toBe("ready: gc answered 503: store busy");
    expect(text(root, "gascity-card-ready-0")).toContain("sc-18");
  });

  test("a column whose first read failed says so instead of 'nothing ready'", async () => {
    const base = gc();
    const mod = await running({
      route: (url) => (new URL(url).pathname.endsWith("/work/ready") ? { status: 400, body: { detail: "bad limit" } } : base(url)),
    });
    const root = mod.render();
    expect(text(root, "gascity-col-ready-error")).toBe("ready: gc answered 400: bad limit");
    expect(findById(root, "gascity-col-ready-empty")).toBeUndefined();
  });

  test("gc-supplied bead text is drawn without escapes or control characters", async () => {
    const base = gc();
    const mod = await running({
      route: (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/work/ready") && !u.searchParams.has("status")) {
          return { status: 200, body: { items: [{ id: "x-\u001b]8;;http://evil\u00071", title: "pay\u202e now\r\nplease", status: "open", issue_type: "task", labels: ["a\u0000b"], created_at: "t", assignee: "w\u001b[2J1" }] } };
        }
        return base(url);
      },
    });
    expect(text(mod.render(), "gascity-card-ready-0")).toBe('x-1 · "pay now please" · open · task · → w1 · [ab]');
  });

  test("the probe carries the board and the selected bead with its close reason", async () => {
    const written = new Map<string, string>();
    const mod = await running({ shared: { "gascity.probe": true }, written });
    mod.click("gascity-card-earlier-0");
    for (let i = 0; i < 3; i++) await mod.tick();
    const doc = JSON.parse(written.get("/home/person/.config/herdr-app/data/gascity-probe/probe.json") ?? "null");
    expect(doc.board.ready.cards.map((c: { id: string }) => c.id)).toEqual(["sc-18", "fe-1", "sc-58", "sc-74"]);
    expect(doc.board.closed.earlier[0]).toEqual({ id: "sc-73", title: "order:gate-sweep", close_reason: "order dispatch completed: tracking bead lifecycle finished", assignee: null });
    expect(doc.bead_detail).toMatchObject({ id: "sc-73", close_reason: "order dispatch completed: tracking bead lifecycle finished" });
  });
});
