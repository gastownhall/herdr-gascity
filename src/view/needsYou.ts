// The "needs you" window: the copy herdr opens for mod.open (a toast's click,
// or the ctrl-alt-g key fragment). It shows the session the newest toast was
// about — its pending prompt with one answer button per gc option, the send
// box and its actions (the same detail pane as the tab) — the city's other
// sessions that need you, "Show Gas City tab" for each tab holding a Gas City
// pane, and Close. Render only: clicks call the actions.

import { h_flex, v_flex } from "gpui-base";
import type { WindowModel } from "../copy.ts";
import type { ThemeRead } from "../host.ts";
import { button } from "./dialogs.ts";
import { label, muted } from "./text.ts";

export interface WindowActions {
  /** Opens a session's detail in this window. */
  selectSession(id: string | null, cx: GpuiContext): void;
  /** Selects a tab holding a Gas City pane. */
  showTab(tab: string, cx: GpuiContext): void;
  /** Closes this window. */
  closeWindow(cx: GpuiContext): void;
}

/** The window's own rows, above the detail pane. */
export function renderWindowHead(m: WindowModel, theme: ThemeRead, actions: WindowActions): GpuiElement {
  const target = m.target === null
    ? muted(label("gascity-window-target", "No toast to follow: pick a session below."), theme)
    : label("gascity-window-target", `Needs you: session ${m.target.session} in city ${m.target.city}`);
  const tabs = m.tabs.length === 1
    ? [button("gascity-window-tab-0", "Show Gas City tab", (cx) => actions.showTab(m.tabs[0] ?? "", cx))]
    : m.tabs.map((t, i) => button(`gascity-window-tab-${i}`, `Show Gas City tab ${t}`, (cx) => actions.showTab(t, cx)));
  const bar = h_flex().id("gascity-window-bar").gap(8).children([...tabs, button("gascity-window-close", "Close", (cx) => actions.closeWindow(cx))]);
  const list = m.pending.length === 0
    ? muted(label("gascity-window-none", "No session needs you right now."), theme)
    : v_flex().id("gascity-window-pending").gap(2).children(m.pending.map((p, i) =>
      label(`gascity-window-pending-${i}`, `${p.label} (session ${p.session}): ${p.kind}`).on_click((_, cx) => actions.selectSession(p.session, cx))));
  return v_flex().id("gascity-window").gap(6).child(target).child(bar).child(list);
}
