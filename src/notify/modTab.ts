// Where the cross-city views open: a tab whose only pane is this mod.
//
//   - "inbox": the Needs a human pane (props {view: "inbox"});
//   - "follow": the answer view, which follows the shared focus target as the
//     "needs you" window does (props {view: "follow"}).
//
// An open tab of that name in a space on this computer, holding a Gas City
// pane, is selected; otherwise a new one opens in a local space (the active
// one when it is on this computer, as open terminal chooses). Pure: host.ts
// reads the scene and runs the plan.

import type { HostScene } from "../host.schemas.ts";
import { localSpace } from "../terminal/attach.ts";

export type ModTabView = "inbox" | "follow";

/** Each view's tab name: how an open one is found again. */
export const MOD_TAB_NAMES: Readonly<Record<ModTabView, string>> = { inbox: "Needs a human", follow: "Needs you" };

export type ModTabPlan = { kind: "select"; tab: string } | { kind: "open"; space: string | null; name: string; view: ModTabView };

export function modTabPlan(scene: HostScene, view: ModTabView, mod: string): ModTabPlan {
  const name = MOD_TAB_NAMES[view];
  const ours = new Set(scene.panes.filter((p) => p.mod === mod).map((p) => p.tab));
  for (const space of scene.spaces) {
    if (space.machine !== null) continue;
    const tab = space.tabs.find((t) => t.name === name && ours.has(t.id));
    if (tab) return { kind: "select", tab: tab.id };
  }
  return { kind: "open", space: localSpace(scene.spaces)?.id ?? null, name, view };
}
