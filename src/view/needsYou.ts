// The "needs you" window: the copy herdr opens for mod.open (a toast's click,
// or the ctrl-alt-g key fragment). It shows the session the newest toast was
// about — its pending prompt with one answer button per gc option, the send
// box and its actions (the same detail pane as the tab) — the city's other
// sessions that need you, "Show Gas City tab" for each tab holding a Gas City
// pane, and Close. While a text box holds a draft, a newer toast's session is
// offered ("needs you too", Show) instead of replacing the one being
// answered. Render only: clicks call the actions.

import { div } from "gpui-kit";
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
  /** Shows the session a newer toast named, held back while a draft was typed. */
  showNext(cx: GpuiContext): void;
}

/** The window's own rows, above the detail pane. `runShown`: the run view below has its own heading. */
export function renderWindowHead(m: WindowModel, theme: ThemeRead, actions: WindowActions, runShown = false): GpuiElement {
  const t = m.target;
  const text = t === null
    ? "No toast to follow: pick a session below."
    : t.run !== undefined
    ? `Run ${t.ref ?? t.run} in city ${t.city}`
    : t.bead !== undefined
    ? `Needs a decision: bead ${t.bead} in city ${t.city}`
    : `Needs you: session ${t.session ?? ""} in city ${t.city}`;
  const target = muted(label("gascity-window-target", text), theme).flex_1().min_w_0().text_size(12)
    .overflow_hidden().whitespace_nowrap().text_ellipsis();
  const tabs = m.tabs.length === 1
    ? [button("gascity-window-tab-0", "Show Gas City tab", (cx) => actions.showTab(m.tabs[0] ?? "", cx))]
    : m.tabs.map((t, i) => button(`gascity-window-tab-${i}`, `Gas City tab ${i + 1}`, (cx) => actions.showTab(t, cx)));
  const close = m.closable ? [button("gascity-window-close", "Close tab", (cx) => actions.closeWindow(cx))] : [];
  // One row: what this tab follows, then its buttons. A run says what it is in its own heading below.
  let bar = h_flex().id("gascity-window-bar").gap(8).items_center().min_w_0();
  // Nothing followed and nothing waiting: one line below says so; the row keeps only its buttons.
  const quiet = t === null && m.pending.length === 0;
  bar = (runShown && t?.run !== undefined) || quiet ? bar.child(div().flex_1()) : bar.child(target);
  bar = bar.children([...tabs, ...close]);
  let el = v_flex().id("gascity-window").gap(6).child(bar);
  // A newer toast while a reply is typed: offered, never switched to under the person's typing.
  if (m.next !== null) {
    el = el.child(h_flex().id("gascity-window-next").gap(8).items_center()
      .child(label("gascity-window-next-text", m.next.run !== undefined
        ? `Run ${m.next.ref ?? m.next.run} in city ${m.next.city} was opened.`
        : m.next.bead !== undefined
        ? `Bead ${m.next.bead} in city ${m.next.city} needs a decision too.`
        : `Session ${m.next.session ?? ""} in city ${m.next.city} needs you too.`))
      .child(button("gascity-window-next-show", "Show", (cx) => actions.showNext(cx))));
  }
  if (m.pending.length > 0) {
    const rows = m.pending.map((p, i) => h_flex().id(`gascity-window-pending-${i}-row`).gap(8).items_center().min_w_0()
      .child(label(`gascity-window-pending-${i}`, `${p.label} (session ${p.session}): ${p.kind}`).flex_1().min_w_0()
        .overflow_hidden().whitespace_nowrap().text_ellipsis())
      .child(button(`gascity-window-pending-${i}-open`, "Open", (cx) => actions.selectSession(p.session, cx))));
    el = el.child(v_flex().id("gascity-window-pending").gap(2)
      .child(muted(label("gascity-window-pending-h", "Sessions waiting on you"), theme).text_size(12))
      .children(rows));
  } else if (t === null) {
    el = el.child(muted(label("gascity-window-none", "Nothing needs you right now. Open a question, approval or decision from the sidebar or Needs a human."), theme));
  }
  return el;
}
