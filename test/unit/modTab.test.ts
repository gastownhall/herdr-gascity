import { describe, expect, test } from "bun:test";
import { modTabPlan } from "../../src/notify/modTab.ts";
import type { HostScene } from "../../src/host.schemas.ts";

function scene(parts: Partial<HostScene>): HostScene {
  return { spaces: [], panes: [], terminals: [], ...parts };
}

describe("where a cross-city view opens", () => {
  test("an open tab of that name holding a Gas City pane, in a space on this computer, is selected", () => {
    const s = scene({
      spaces: [
        { id: "remote", machine: "cherry", active: true, tabs: [{ id: "r1", active: true, name: "Needs a human" }] },
        { id: "local", machine: null, active: false, tabs: [{ id: "l1", active: true, name: "1" }, { id: "l2", active: false, name: "Needs a human" }] },
      ],
      panes: [{ pane: "p", tab: "l2", mod: "gascity" }, { pane: "q", tab: "r1", mod: "gascity" }],
    });
    expect(modTabPlan(s, "inbox", "gascity")).toEqual({ kind: "select", tab: "l2" });
  });

  test("a tab with that name but no Gas City pane is not ours: a new tab opens in the local space", () => {
    const s = scene({
      spaces: [
        { id: "remote", machine: "cherry", active: true, tabs: [] },
        { id: "local", machine: null, active: false, tabs: [{ id: "l2", active: true, name: "Needs you" }] },
      ],
      panes: [{ pane: "p", tab: "l2", terminal: "t1" }],
    });
    expect(modTabPlan(s, "follow", "gascity")).toEqual({ kind: "open", space: "local", name: "Needs you", view: "follow" });
  });

  test("no local space: herdr picks", () => {
    expect(modTabPlan(scene({ spaces: [{ id: "r", machine: "cherry", active: true, tabs: [] }] }), "inbox", "gascity"))
      .toEqual({ kind: "open", space: null, name: "Needs a human", view: "inbox" });
  });
});
