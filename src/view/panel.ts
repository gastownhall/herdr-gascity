// Render functions for the panel. They read only the model they are given:
// no host calls, no I/O. Clicks call the actions in the model.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { CopyView } from "../copy.ts";
import type { ThemeRead } from "../host.ts";
import { renderAgents, type AgentsActions } from "./agents.ts";
import { renderBoard, type BoardActions } from "./board.ts";
import { renderDetail, type DetailActions } from "./detail.ts";
import { renderHeader, type HeaderActions } from "./header.ts";
import { label, muted, themedRoot } from "./text.ts";

/** What a click may do; main.ts supplies them. */
export interface PanelActions extends HeaderActions, AgentsActions, BoardActions, DetailActions {
  toggleDiagnostics(cx: GpuiContext): void;
}

/** What the panel shows. */
export type PanelModel =
  | { kind: "city"; theme: ThemeRead; view: CopyView; actions: PanelActions }
  | { kind: "copy-invalid"; theme: ThemeRead; error: string }
  | { kind: "host-incompatible"; missing: readonly string[] };

export const TITLE = "Gas City";

/** The banner text for a herdr-app that lacks host exports this build calls. */
export function hostIncompatibleText(missing: readonly string[]): string {
  return `This herdr-app is too old for the Gas City mod: it lacks ${missing.join(", ")}.`;
}

/** The text for a copy whose props this build cannot read. */
export function copyInvalidText(error: string): string {
  return `This copy of the Gas City mod was opened with props it cannot read: ${error}`;
}

function themeIssues(el: GpuiElement, theme: ThemeRead): GpuiElement {
  return el.when(theme.issues.length > 0, (e) => e.child(label("gascity-host-decode", theme.issues.join("; "))));
}

function diagnostics(model: Extract<PanelModel, { kind: "city" }>): GpuiElement | null {
  const { view, theme, actions } = model;
  if (view.diagnostics.length === 0) return null;
  const toggle = div().id("gascity-diagnostics-toggle").on_click((_, cx) => actions.toggleDiagnostics(cx))
    .child(`${view.diagnosticsOpen ? "Hide" : "Show"} diagnostics (${view.diagnostics.length})`);
  if (!view.diagnosticsOpen) return toggle;
  const lines = view.diagnostics.map((d, i) => muted(label(`gascity-diag-${i}`, `${d.at ?? ""} ${d.source}: ${d.text}`.trim()), theme));
  return v_flex().id("gascity-diagnostics-drawer").gap(2).child(toggle).children(lines);
}

/** The whole panel for one model. */
export function renderPanel(model: PanelModel): GpuiElement {
  const title = div().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
    return root.child(title).child(label("gascity-host-incompatible", hostIncompatibleText(model.missing)));
  }
  let root = themedRoot(model.theme, v_flex().id("gascity-root").size_full().p(12).gap(8)).child(title);
  if (model.kind === "copy-invalid") {
    return themeIssues(root.child(label("gascity-copy-invalid", copyInvalidText(model.error))), model.theme);
  }
  const { view, theme, actions } = model;
  root = root.children(renderHeader(view.header, theme, actions));
  // Agents beside the work board; the session detail below both.
  const regions: GpuiElement[] = [];
  if (view.agents !== null) regions.push(div().id("gascity-agents-region").flex_1().child(renderAgents(view.agents, theme, actions)));
  if (view.board !== null) regions.push(renderBoard(view.board, view.beadDetail, theme, actions));
  if (regions.length > 0) root = root.child(h_flex().id("gascity-main").gap(12).children(regions));
  const detail = renderDetail(view.detail, theme, actions);
  if (detail !== null) root = root.child(detail);
  const diag = diagnostics(model);
  if (diag !== null) root = root.child(diag);
  return themeIssues(root, theme);
}
