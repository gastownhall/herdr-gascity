// The detail pane of the selected session: title and status, facts, wake
// reasons, the pending prompt with gc's options, and its output as
// plain text, one element per line (no markdown, no links). Actions
// (answer, send, open terminal) arrive in a later change.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { DetailModel, PendingView } from "../vm/detail.ts";
import { greyedIf, label, muted } from "./text.ts";

export interface DetailActions {
  close(cx: GpuiContext): void;
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
        `Options from gc: ${p.options.length > 0 ? p.options.join(", ") : "(none)"}`,
      ];
  }
}

/** The detail pane, or null when no session is selected. */
export function renderDetail(m: DetailModel, theme: ThemeRead, actions: DetailActions): GpuiElement | null {
  if (m.kind === "none") return null;
  const close = div().id("gascity-detail-close").on_click((_, cx) => actions.close(cx)).child("Close");
  if (m.kind === "gone") return v_flex().id("gascity-detail").gap(4).child(label("gascity-detail-gone", m.text)).child(close);
  let el = v_flex().id("gascity-detail").gap(4)
    .child(h_flex().id("gascity-detail-head").gap(8).child(label("gascity-detail-title", `Detail: ${m.title}`)).child(close))
    .child(label("gascity-detail-status", m.status.detail === null ? m.status.label : `${m.status.label} · ${m.status.detail}`))
    .child(muted(label("gascity-detail-facts", m.facts.map(([k, v]) => `${k}: ${v}`).join(" · ")), theme))
    .child(label("gascity-detail-wake", `Wake reasons: ${m.wakeReasons}`));
  pendingText(m.pending).forEach((t, i) => {
    el = el.child(label(`gascity-detail-pending-${i}`, t));
  });
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
