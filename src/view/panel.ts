// Render functions for the panel. They read only the model they are given:
// no host calls, no I/O. Clicks call the actions in the model.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { HeaderModel } from "../vm/header.ts";

/** What a click may do; main.ts supplies them. */
export interface PanelActions {
  /** Rediscover the gc API ("retry now"). */
  retry(cx: GpuiContext): void;
  /** Show this city (unpinned copies). */
  select(city: string, cx: GpuiContext): void;
}

/** What the panel shows. */
export type PanelModel =
  | { kind: "city"; theme: ThemeRead; header: HeaderModel; actions: PanelActions }
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

function tinted(el: GpuiElement, color: GpuiColor | undefined, apply: (el: GpuiElement, color: GpuiColor) => GpuiElement): GpuiElement {
  return color === undefined ? el : apply(el, color);
}

function muted(el: GpuiElement, theme: ThemeRead): GpuiElement {
  return tinted(el, theme.colors.muted, (e, c) => e.text_color(c));
}

function themedRoot(theme: ThemeRead): GpuiElement {
  const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
  const { colors } = theme;
  return tinted(tinted(root, colors.background, (el, c) => el.bg(c)), colors.foreground, (el, c) => el.text_color(c));
}

function themeIssues(el: GpuiElement, theme: ThemeRead): GpuiElement {
  return el.when(theme.issues.length > 0, (e) => e.child(div().id("gascity-host-decode").child(theme.issues.join("; "))));
}

function header(model: Extract<PanelModel, { kind: "city" }>): GpuiElement[] {
  const { header: h, theme, actions } = model;
  const out: GpuiElement[] = [];
  const status = h_flex().id("gascity-status").gap(8).child(div().id("gascity-chip").child(h.chip.text));
  out.push(h.canRetry ? status.child(div().id("gascity-retry").on_click((_, cx) => actions.retry(cx)).child("Retry now")) : status);
  if (h.endpoint !== null) out.push(muted(div().id("gascity-endpoint"), theme).child(h.endpoint));
  if (h.city !== null) out.push(div().id("gascity-city").child(`City: ${h.city}`));
  h.banners.forEach((text, i) => out.push(div().id(`gascity-banner-${i}`).child(text)));
  if (h.others.length > 0) {
    const others = h.others.map((o) => `${o.name} (${o.label})`).join(", ");
    out.push(muted(div().id("gascity-others"), theme).child(`Other cities: ${others}`));
  }
  if (h.choices !== null && h.choices.length > 0) {
    const heading = h.city === null ? "Choose a city:" : "Switch to:";
    const list = v_flex().id("gascity-choices").gap(4).child(div().id("gascity-choices-heading").child(heading));
    out.push(list.children(h.choices.map((c, i) =>
      div().id(`gascity-choose-${i}`).on_click((_, cx) => actions.select(c.name, cx)).child(`${c.name} (${c.label})`))));
  }
  if (h.diagnostics.length > 0) {
    const lines = h.diagnostics.map((line, i) => muted(div().id(`gascity-diagnostic-${i}`), theme).child(line));
    out.push(v_flex().id("gascity-diagnostics").gap(2).child(div().id("gascity-diagnostics-heading").child("Discovery:")).children(lines));
  }
  return out;
}

/** The whole panel for one model. */
export function renderPanel(model: PanelModel): GpuiElement {
  const title = div().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
    return root.child(title).child(div().id("gascity-host-incompatible").child(hostIncompatibleText(model.missing)));
  }
  const root = themedRoot(model.theme).child(title);
  if (model.kind === "copy-invalid") {
    return themeIssues(root.child(div().id("gascity-copy-invalid").child(copyInvalidText(model.error))), model.theme);
  }
  return themeIssues(root.children(header(model)), model.theme);
}
