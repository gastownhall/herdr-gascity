// "May a gascity view be on screen?" — per app and conservative, because a
// copy cannot tell which gascity pane is itself (panes() has no props).

import { describe, expect, test } from "bun:test";
import { mayBeOnScreen, type VisibilityInput } from "../../../src/sync/visibility.ts";
import type { HostPane } from "../../../src/host.schemas.ts";

const term = (pane: string, tab: string): HostPane => ({ pane, tab, terminal: `t-${pane}` });
const mod = (pane: string, tab: string, name = "gascity"): HostPane => ({ pane, tab, terminal: null, mod: name });

function input(over: Partial<VisibilityInput>): VisibilityInput {
  return { windowOpen: false, layoutMods: [], panes: [], focus: { space: "s1", tab: "tab-1" }, ...over };
}

describe("mayBeOnScreen", () => {
  const table: [string, Partial<VisibilityInput>, boolean][] = [
    ["nothing anywhere", {}, false],
    ["gascity pane in the focused tab", { panes: [term("p1", "tab-1"), mod("p2", "tab-1")] }, true],
    ["mod tab hidden: gascity pane only in another tab", { panes: [term("p1", "tab-1"), mod("p2", "tab-2")] }, false],
    ["two gascity panes, one in the focused tab", { panes: [mod("p1", "tab-2"), mod("p2", "tab-1")] }, true],
    ["two gascity panes, both hidden", { panes: [mod("p1", "tab-2"), mod("p2", "tab-3")] }, false],
    ["another mod in the focused tab", { panes: [mod("p1", "tab-1", "notes")] }, false],
    ["the needs-you window is open", { windowOpen: true }, true],
    ["window open while the tab is hidden", { windowOpen: true, panes: [mod("p1", "tab-2")] }, true],
    ["a shown layout block holds gascity", { layoutMods: ["files", "gascity"] }, true],
    ["a shown layout block holds another mod", { layoutMods: ["files"] }, false],
    ["nothing focused", { focus: null, panes: [mod("p1", "tab-1")] }, false],
    ["nothing focused but a layout block shows gascity", { focus: null, layoutMods: ["gascity"] }, true],
  ];
  for (const [name, over, want] of table) {
    test(`${name} → ${want ? "on screen" : "hidden"}`, () => {
      expect(mayBeOnScreen(input(over))).toBe(want);
    });
  }
});
