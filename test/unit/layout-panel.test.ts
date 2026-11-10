// Render tests of the panel's layout in the built bundle (gascity/main.js):
// the root reports its laid-out width (herdr's on_size_change), and the panel
// places the agents and the work board, and the board's three columns, so
// that they fit that width. The fake builders do not lay anything out, so
// these tests check the structure the layout rests on: which regions are in
// a row and which are stacked, and that every region in a row may shrink
// (flex_1 + min_w_0) so its text wraps instead of running off the edge.

import { describe, expect, test } from "bun:test";
import { callsTo, findById, type RecordedNode } from "../harness.ts";
import { running, text } from "./panel-fixture.ts";

/** The width herdr gives the mod's pane in a 1280 px window (the preview: sidebar and pane chrome take the rest). */
const PANE_IN_1280_WINDOW = 994;
const COLUMNS = ["gascity-col-ready", "gascity-col-inprogress", "gascity-col-closed"];

function node(root: RecordedNode, id: string): RecordedNode {
  const n = findById(root, id);
  if (!n) throw new Error(`no element ${id}`);
  return n;
}

/** May this element shrink below its content in a row (so its text wraps)? */
function shrinks(n: RecordedNode): boolean {
  return callsTo(n, "flex_1").length > 0 && callsTo(n, "min_w_0").length > 0;
}

describe("layout by width", () => {
  test("at the pane width of a 1280 px window: the board is under the agents, with its three columns side by side, each able to shrink", async () => {
    const mod = await running();
    mod.resize(PANE_IN_1280_WINDOW);
    const root = mod.render();
    const main = node(root, "gascity-main");
    expect(main.kind).toBe("v_flex");
    expect((main.children as RecordedNode[]).map((c) => c.id)).toEqual(["gascity-agents-region", "gascity-work"]);
    const columns = node(root, "gascity-columns");
    expect(columns.kind).toBe("h_flex");
    expect((columns.children as RecordedNode[]).map((c) => c.id)).toEqual(COLUMNS);
    for (const id of COLUMNS) expect(shrinks(node(root, id))).toBe(true);
    expect(text(root, "gascity-col-ready-title")).toBe("Ready (4)");
    expect(text(root, "gascity-col-inprogress-title")).toBe("In progress (0)");
    expect(text(root, "gascity-col-closed-title")).toBe("Recently closed (18)");
  });

  test("wide: agents beside the board, both able to shrink", async () => {
    const mod = await running();
    mod.resize(1800);
    const root = mod.render();
    const main = node(root, "gascity-main");
    expect(main.kind).toBe("h_flex");
    expect(shrinks(node(root, "gascity-agents-region"))).toBe(true);
    expect(shrinks(node(root, "gascity-work"))).toBe(true);
    expect(node(root, "gascity-columns").kind).toBe("h_flex");
  });

  test("narrow: the columns stack too", async () => {
    const mod = await running();
    mod.resize(560);
    const root = mod.render();
    expect(node(root, "gascity-main").kind).toBe("v_flex");
    const columns = node(root, "gascity-columns");
    expect(columns.kind).toBe("v_flex");
    expect((columns.children as RecordedNode[]).map((c) => c.id)).toEqual(COLUMNS);
  });

  test("before herdr reports a size, the panel is stacked (it fits any width)", async () => {
    const mod = await running();
    const root = mod.render();
    expect(node(root, "gascity-main").kind).toBe("v_flex");
    expect(node(root, "gascity-columns").kind).toBe("h_flex");
  });

  test("the root scrolls vertically, and a resize redraws only when the layout changes", async () => {
    const mod = await running();
    const root = mod.render();
    expect(callsTo(root, "overflow_y_scroll")).toHaveLength(1);
    const before = mod.cx.notifies;
    mod.resize(1000);
    expect(mod.cx.notifies).toBe(before);
    mod.resize(1001);
    expect(mod.cx.notifies).toBe(before);
    mod.resize(1800);
    expect(mod.cx.notifies).toBe(before + 1);
    mod.resize(500);
    expect(mod.cx.notifies).toBe(before + 2);
  });
});
