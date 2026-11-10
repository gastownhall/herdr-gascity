// The work region: the infrastructure filter chip, the Ready, In progress and
// Recently closed columns (each with its data age, error line, notices,
// unreadable rows and cards; stale data greyed, never hidden), and the
// selected bead's detail. Clicking a card opens its detail; clicking the
// selected card or Close closes it. The work actions: + New bead (the form),
// and on the open bead Sling… (pick an agent) and Close… (with a reason), or
// Reopen for a closed bead; an action under way on it shows as waiting.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as work from "../actions/work.ts";
import type { ThemeRead } from "../host.ts";
import { isBusy, type ActivityModel } from "../vm/activity.ts";
import type { BeadCard, BeadDetailModel, BoardModel, ClosedCard, ColumnBase } from "../vm/board.ts";
import { button, waiting } from "./dialogs.ts";
import { greyedIf, label, muted, shrinkIf } from "./text.ts";
import type { PanelLayout } from "../vm/layout.ts";

export interface BoardActions {
  /** Opens a bead's detail; null closes it. */
  selectBead(id: string | null, cx: GpuiContext): void;
  /** Opens the new-bead form. */
  openNewBead(cx: GpuiContext): void;
  /** Sling… on the open bead: asks which agent. */
  requestSling(cx: GpuiContext): void;
  /** Close… on the open bead: opens the close form. */
  requestCloseBead(cx: GpuiContext): void;
  /** Reopens the open bead. */
  reopenBead(cx: GpuiContext): void;
}

/** One line per card: id, priority, title, state, type, assignee, labels, close reason. */
export function cardText(c: BeadCard | ClosedCard): string {
  const parts = [c.id];
  if (c.priority !== null) parts.push(c.priority);
  parts.push(`"${c.title}"`, c.state, c.type);
  if (c.assignee !== null) parts.push(`→ ${c.assignee}`);
  if (c.labels.length > 0) parts.push(`[${c.labels.join(", ")}]`);
  if ("closeReason" in c && c.closeReason !== null) parts.push(`reason: ${c.closeReason}`);
  return `${c.selected ? "▸ " : ""}${parts.join(" · ")}`;
}

function card(c: BeadCard, id: string, theme: ThemeRead, actions: BoardActions): GpuiElement {
  const el = label(id, cardText(c)).on_click((_, cx) => actions.selectBead(c.selected ? null : c.id, cx));
  return c.selected ? el : muted(el, theme);
}

/** A column's heading and state lines, and its body (greyed when stale). */
function column(key: string, m: ColumnBase, body: GpuiElement[], theme: ThemeRead, inRow: boolean): GpuiElement {
  const id = `gascity-col-${key}`;
  let el = shrinkIf(v_flex().id(id), inRow).gap(4).child(label(`${id}-title`, `${m.title} (${m.count})`));
  const state = m.region;
  if (state.kind === "loading") el = el.child(muted(label(`${id}-loading`, "loading…"), theme));
  if (state.age !== null) el = el.child(muted(label(`${id}-age`, state.stale ? `${state.age} (may be out of date)` : state.age), theme));
  if (state.error !== null) el = el.child(label(`${id}-error`, state.error));
  m.banners.forEach((b, i) => {
    el = el.child(label(`${id}-banner-${i}`, b));
  });
  let data = v_flex().id(`${id}-data`).gap(2).children(body);
  m.unreadable.forEach((u, i) => {
    data = data.child(label(`${id}-unreadable-${i}`, u));
  });
  if (m.empty !== null) data = data.child(muted(label(`${id}-empty`, m.empty), theme));
  return el.child(greyedIf(data, state.stale, theme));
}

/** The open bead's actions, each waiting while one like it is under way. */
function beadActions(m: Extract<BeadDetailModel, { kind: "bead" }>, activity: ActivityModel | null, theme: ThemeRead, actions: BoardActions): GpuiElement {
  const one = (key: string, text: string, busy: boolean, onClick: (cx: GpuiContext) => void) => busy
    ? waiting(`gascity-bead-action-${key}`, text, "under way", theme)
    : button(`gascity-bead-action-${key}`, `${text}${key === "reopen" ? "" : "…"}`, onClick);
  // The busy check matches by action kind and bead (whatever the agent or reason).
  const buttons = m.closed
    ? [one("reopen", "Reopen", isBusy(activity, work.beadReopen(m.ref)), (cx) => actions.reopenBead(cx))]
    : [
      one("sling", "Sling", isBusy(activity, work.beadSling(m.ref, "")), (cx) => actions.requestSling(cx)),
      one("close", "Close", isBusy(activity, work.beadClose(m.ref, "")), (cx) => actions.requestCloseBead(cx)),
    ];
  return h_flex().id("gascity-bead-actions").gap(8).children(buttons);
}

function beadDetail(m: BeadDetailModel, theme: ThemeRead, actions: BoardActions, activity: ActivityModel | null): GpuiElement | null {
  if (m.kind === "none") return null;
  const close = div().id("gascity-bead-close").on_click((_, cx) => actions.selectBead(null, cx)).child("Close");
  if (m.kind === "missing") return v_flex().id("gascity-bead-detail").gap(4).child(label("gascity-bead-missing", m.text)).child(close);
  let el = v_flex().id("gascity-bead-detail").gap(4)
    .child(h_flex().id("gascity-bead-head").gap(8).child(label("gascity-bead-title", `Bead ${m.id}: "${m.title}"`)).child(close))
    .child(beadActions(m, activity, theme, actions))
    .child(muted(label("gascity-bead-facts", m.facts.map(([k, v]) => `${k}: ${v}`).join(" · ")), theme));
  if (m.closeReason !== null) el = el.child(label("gascity-bead-reason", `Close reason: ${m.closeReason}`));
  if (m.region.age !== null) el = el.child(muted(label("gascity-bead-age", m.region.stale ? `${m.region.age} (may be out of date)` : m.region.age), theme));
  if (m.region.error !== null) el = el.child(label("gascity-bead-error", m.region.error));
  let description = v_flex().id("gascity-bead-description").gap(0);
  if (m.description === null) description = description.child(muted(label("gascity-bead-description-note", m.descriptionNote ?? ""), theme));
  // One element per line: the text is shown as is, never interpreted.
  else description = description.children(m.description.split("\n").map((line, i) => label(`gascity-bead-line-${i}`, line)));
  return el.child(greyedIf(description, m.region.stale, theme));
}

/**
 * The work region for one board and the selected bead's detail. `layout`
 * places it: beside the agents (side-by-side) it shares the width; its
 * columns are in a row unless the panel is narrow.
 */
export function renderBoard(
  m: BoardModel, detail: BeadDetailModel, theme: ThemeRead, actions: BoardActions, activity: ActivityModel | null, layout: PanelLayout,
): GpuiElement {
  const inRow = layout !== "narrow";
  const filter = m.hidden > 0 ? `${m.filter} · ${m.hidden} hidden` : m.filter;
  const ready = column("ready", m.ready, m.ready.cards.map((c, i) => card(c, `gascity-card-ready-${i}`, theme, actions)), theme, inRow);
  const inProgress = column("inprogress", m.inProgress, m.inProgress.cards.map((c, i) => card(c, `gascity-card-inprogress-${i}`, theme, actions)), theme, inRow);
  const closedBody = m.closed.recent.map((c, i) => card(c, `gascity-card-closed-${i}`, theme, actions));
  if (m.closed.earlier.length > 0) {
    closedBody.push(muted(label("gascity-col-closed-divider", m.closed.divider), theme));
    closedBody.push(...m.closed.earlier.map((c, i) => card(c, `gascity-card-earlier-${i}`, theme, actions)));
  }
  const closed = column("closed", m.closed, closedBody, theme, inRow);
  let el = shrinkIf(v_flex().id("gascity-work"), layout === "side-by-side").gap(6)
    .child(h_flex().id("gascity-work-head").gap(8).child(label("gascity-work-title", "Work"))
      .child(button("gascity-work-new", "+ New bead", (cx) => actions.openNewBead(cx))))
    .child(muted(label("gascity-work-filter", filter), theme))
    .child((inRow ? h_flex().items_start() : v_flex()).id("gascity-columns").gap(12).child(ready).child(inProgress).child(closed));
  const d = beadDetail(detail, theme, actions, activity);
  if (d !== null) el = el.child(d);
  return el;
}
