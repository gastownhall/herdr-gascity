// The detail pane of the selected session: title and status, its actions
// (each one gc API call; close and kill ask first), facts, wake reasons, the
// pending prompt with one answer button per option gc lists, the send box,
// and its output as plain text, one element per line (no markdown, no links).
// An action already under way shows as waiting instead of a button.

import { div } from "gpui-kit";
import { Input, h_flex, v_flex, type InputState } from "gpui-base";
import type { ActionSpec } from "../actions/activity.ts";
import * as session from "../actions/session.ts";
import type { InputMode } from "../copy.ts";
import type { ThemeRead } from "../host.ts";
import { isBusy, type ActivityModel } from "../vm/activity.ts";
import type { DetailModel, PendingView } from "../vm/detail.ts";
import { button, waiting } from "./dialogs.ts";
import { greyedIf, label, muted } from "./text.ts";

export interface DetailActions {
  close(cx: GpuiContext): void;
  /** Asks for an action (destructive ones ask first). */
  act(spec: ActionSpec, cx: GpuiContext): void;
  /** Kill asks first, offering a plain and a forced kill. */
  requestKill(sessionId: string, cx: GpuiContext): void;
  /** Sends the send box's text to `sessionId`, the session whose detail drew the box. */
  send(sessionId: string, mode: InputMode, cx: GpuiContext): void;
  /** Answers the open session's pending prompt `requestId` with `option`, exactly as the button was drawn. */
  answer(requestId: string, option: string, cx: GpuiContext): void;
}

/** What the detail pane draws besides its model. */
export interface DetailContext {
  activity: ActivityModel | null;
  /** The send box's state (created in init), or null before init. */
  message: InputState | null;
}

function pendingText(p: PendingView): string[] {
  switch (p.kind) {
    case "loading":
      return ["Pending prompt: loading"];
    case "failed":
      return [`Pending prompt: unavailable: ${p.error}`];
    case "unsupported":
      return ["Pending prompt: this session's provider has none"];
    case "none":
      return ["Pending prompt: none"];
    case "prompt":
      return [
        `Pending ${p.promptKind} (request ${p.requestId}): ${p.prompt ?? "(no prompt text)"}`,
        p.options.length > 0 ? "Answer with one of gc's options:" : "gc lists no options for this prompt",
      ];
  }
}

/** One button per session action, or why it waits. */
function actionBar(id: string, ctx: DetailContext, theme: ThemeRead, actions: DetailActions): GpuiElement {
  const specs: [string, ActionSpec][] = [
    ["wake", session.sessionWake(id)],
    ["suspend", session.sessionSuspend(id)],
    ["stop", session.sessionStop(id)],
    ["pin", session.sessionPin(id)],
    ["unpin", session.sessionUnpin(id)],
    ["close", session.sessionClose(id)],
  ];
  const buttons = specs.map(([key, spec]) => isBusy(ctx.activity, spec)
    ? waiting(`gascity-action-${key}`, spec.verb, "under way", theme)
    : button(`gascity-action-${key}`, spec.confirm ? `${spec.verb}…` : spec.verb, (cx) => actions.act(spec, cx)));
  const kill = isBusy(ctx.activity, session.sessionKill(id, false)) || isBusy(ctx.activity, session.sessionKill(id, true))
    ? waiting("gascity-action-kill", "Kill", "under way", theme)
    : button("gascity-action-kill", "Kill…", (cx) => actions.requestKill(id, cx));
  return h_flex().id("gascity-detail-actions").gap(8).children([...buttons, kill]);
}

function answers(p: PendingView, actions: DetailActions): GpuiElement | null {
  if (p.kind !== "prompt" || p.options.length === 0) return null;
  // Each button carries the prompt and the option it was drawn with, so a
  // click answers what the person saw (gc refuses an answer to a resolved
  // prompt; the copy refuses one when the prompt has changed since).
  const { requestId, options } = p.answer;
  return h_flex().id("gascity-detail-answers").gap(8)
    .children(options.map((raw, i) => button(`gascity-answer-${i}`, p.options[i] ?? "", (cx) => actions.answer(requestId, raw, cx))));
}

function sendBox(sessionId: string, canInterrupt: boolean, ctx: DetailContext, actions: DetailActions): GpuiElement {
  let row = h_flex().id("gascity-send").gap(8);
  if (ctx.message !== null) row = row.child(Input.new(ctx.message));
  row = row.child(button("gascity-send-default", "Send", (cx) => actions.send(sessionId, "default", cx)));
  if (canInterrupt) row = row.child(button("gascity-send-interrupt", "Interrupt and send", (cx) => actions.send(sessionId, "interrupt_now", cx)));
  return row.child(button("gascity-send-message", "Send as message", (cx) => actions.send(sessionId, "message", cx)));
}

/** The detail pane, or null when no session is selected. */
export function renderDetail(m: DetailModel, theme: ThemeRead, actions: DetailActions, ctx: DetailContext): GpuiElement | null {
  if (m.kind === "none") return null;
  const close = div().id("gascity-detail-close").on_click((_, cx) => actions.close(cx)).child("Close");
  if (m.kind === "gone") return v_flex().id("gascity-detail").gap(4).child(label("gascity-detail-gone", m.text)).child(close);
  let el = v_flex().id("gascity-detail").gap(4)
    .child(h_flex().id("gascity-detail-head").gap(8).child(label("gascity-detail-title", `Detail: ${m.title}`)).child(close))
    .child(label("gascity-detail-status", m.status.detail === null ? m.status.label : `${m.status.label} · ${m.status.detail}`))
    .child(actionBar(m.ref, ctx, theme, actions))
    .child(muted(label("gascity-detail-facts", m.facts.map(([k, v]) => `${k}: ${v}`).join(" · ")), theme))
    .child(label("gascity-detail-wake", `Wake reasons: ${m.wakeReasons}`));
  pendingText(m.pending).forEach((t, i) => {
    el = el.child(label(`gascity-detail-pending-${i}`, t));
  });
  const answer = answers(m.pending, actions);
  if (answer !== null) el = el.child(answer);
  el = el.child(sendBox(m.ref, m.canInterrupt, ctx, actions));
  const out = m.output;
  let output = v_flex().id("gascity-detail-output").gap(0);
  if (out.region.age !== null) output = output.child(muted(label("gascity-detail-output-age", `output, ${out.region.age}`), theme));
  if (out.region.error !== null) output = output.child(label("gascity-detail-output-error", out.region.error));
  if (out.text === null) {
    output = output.child(muted(label("gascity-detail-output-loading", out.region.kind === "failed" ? "no output" : "loading output…"), theme));
  } else {
    // One element per line: the text is shown as is, never interpreted.
    output = output.children(out.text.split("\n").map((line, i) => label(`gascity-detail-line-${i}`, line)));
  }
  return el.child(greyedIf(output, out.region.stale, theme));
}
