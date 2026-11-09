// The panel's action surfaces that are not tied to one row: the dialog (a
// confirmation before a destructive action, or the new-session form), the
// notice saying why an action was not sent, and the activity log with each
// action's state and its retry / refresh buttons. Render functions only:
// clicks call the actions they are given.

import { Input, h_flex, v_flex, type InputState } from "gpui-base";
import type { DialogModel } from "../copy.ts";
import type { ThemeRead } from "../host.ts";
import type { ActivityModel, ActivityRow } from "../vm/activity.ts";
import { label, muted } from "./text.ts";

export interface DialogActions {
  confirm(choice: number, cx: GpuiContext): void;
  cancelDialog(cx: GpuiContext): void;
  createSession(cx: GpuiContext): void;
  retryAction(id: number, cx: GpuiContext): void;
  refreshAction(id: number, cx: GpuiContext): void;
}

/** A clickable word; the text is cleaned like every label. */
export function button(id: string, text: string, onClick: (cx: GpuiContext) => void): GpuiElement {
  return label(id, `[${text}]`).on_click((_, cx) => onClick(cx));
}

/** A button that cannot be pressed now, with why. */
export function waiting(id: string, text: string, why: string, theme: ThemeRead): GpuiElement {
  return muted(label(id, `[${text}: ${why}]`), theme);
}

/** The open dialog, or null. */
export function renderDialog(d: DialogModel | null, theme: ThemeRead, actions: DialogActions, alias: InputState | null): GpuiElement | null {
  if (d === null) return null;
  const cancel = button("gascity-dialog-cancel", "Cancel", (cx) => actions.cancelDialog(cx));
  if (d.kind === "new-session") {
    let form = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", `New session of agent ${d.agent}`));
    if (alias !== null) form = form.child(h_flex().id("gascity-dialog-alias").gap(4).child(label("gascity-dialog-alias-label", "Alias (optional):")).child(Input.new(alias)));
    return form.child(h_flex().id("gascity-dialog-buttons").gap(8)
      .child(button("gascity-dialog-create", "Start session", (cx) => actions.createSession(cx))).child(cancel));
  }
  let el = v_flex().id("gascity-dialog").gap(4).child(label("gascity-dialog-question", d.question));
  d.choices.forEach((c, i) => {
    el = el.child(muted(label(`gascity-dialog-detail-${i}`, d.choices.length > 1 ? `${c.label}: ${c.detail}` : c.detail), theme));
  });
  const buttons = d.choices.map((c, i) => button(`gascity-dialog-confirm-${i}`, c.label, (cx) => actions.confirm(i, cx)));
  return el.child(h_flex().id("gascity-dialog-buttons").gap(8).children([...buttons, cancel]));
}

/** Why the last action was not sent, or null. */
export function renderNotice(notice: string | null): GpuiElement | null {
  return notice === null ? null : label("gascity-notice", notice);
}

const TONES: Readonly<Record<ActivityRow["tone"], string>> = {
  pending: "pending", done: "done", failed: "failed", unknown: "outcome unknown", "not-sent": "not sent",
};

function activityRow(r: ActivityRow, theme: ThemeRead, actions: DialogActions): GpuiElement {
  const id = `gascity-activity-${r.id}`;
  const attempt = r.attempt > 1 ? ` (attempt ${r.attempt})` : "";
  const request = r.requestId === null ? "" : ` · request ${r.requestId}`;
  let el = h_flex().id(id).gap(8).child(label(`${id}-text`, `${r.title}${attempt} → ${TONES[r.tone]}: ${r.detail}${request}`));
  if (r.refresh) el = el.child(button(`${id}-refresh`, "Refresh state", (cx) => actions.refreshAction(r.id, cx)));
  if (r.retry.kind === "retry") el = el.child(button(`${id}-retry`, r.retry.label, (cx) => actions.retryAction(r.id, cx)));
  if (r.retry.kind === "wait") el = el.child(waiting(`${id}-retry`, "Retry", r.retry.reason, theme));
  return r.tone === "done" ? muted(el, theme) : el;
}

/** The city's activity log, newest first; null while it is empty. */
export function renderActivity(m: ActivityModel | null, theme: ThemeRead, actions: DialogActions): GpuiElement | null {
  if (m === null || m.rows.length === 0) return null;
  return v_flex().id("gascity-activity").gap(2).child(label("gascity-activity-title", "Activity"))
    .children(m.rows.map((r) => activityRow(r, theme, actions)));
}
