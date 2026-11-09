// The header: connection chip with "retry now", where gc was found, the
// copy's city, "N need you", data age, banners, the other cities, the city
// switcher of an unpinned copy and the discovery diagnostics. Draws only the
// model; clicks call the actions.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { HeaderModel } from "../vm/header.ts";
import { label, muted } from "./text.ts";

export interface HeaderActions {
  retry(cx: GpuiContext): void;
  select(city: string, cx: GpuiContext): void;
}

/** The header's rows. */
export function renderHeader(h: HeaderModel, theme: ThemeRead, actions: HeaderActions): GpuiElement[] {
  const out: GpuiElement[] = [];
  let status = h_flex().id("gascity-status").gap(8).child(label("gascity-chip", h.chip.text));
  if (h.needsYou !== null) status = status.child(label("gascity-needs-you", h.needsYou));
  if (h.age !== null) status = status.child(muted(label("gascity-age", h.age), theme));
  if (h.canRetry) status = status.child(div().id("gascity-retry").on_click((_, cx) => actions.retry(cx)).child("Retry now"));
  out.push(status);
  if (h.endpoint !== null) out.push(muted(label("gascity-endpoint", h.endpoint), theme));
  if (h.city !== null) out.push(label("gascity-city", `City: ${h.city}`));
  h.banners.forEach((text, i) => out.push(label(`gascity-banner-${i}`, text)));
  if (h.others.length > 0) {
    const others = h.others.map((o) => `${o.name} (${o.label})`).join(", ");
    out.push(muted(label("gascity-others", `Other cities: ${others}`), theme));
  }
  if (h.choices !== null && h.choices.length > 0) {
    const heading = h.city === null ? "Choose a city:" : "Switch to:";
    const list = v_flex().id("gascity-choices").gap(4).child(label("gascity-choices-heading", heading));
    out.push(list.children(h.choices.map((c, i) =>
      label(`gascity-choose-${i}`, `${c.name} (${c.label})`).on_click((_, cx) => actions.select(c.name, cx)))));
  }
  if (h.diagnostics.length > 0) {
    const lines = h.diagnostics.map((line, i) => muted(label(`gascity-diagnostic-${i}`, line), theme));
    out.push(v_flex().id("gascity-diagnostics").gap(2).child(label("gascity-diagnostics-heading", "Discovery:")).children(lines));
  }
  return out;
}
