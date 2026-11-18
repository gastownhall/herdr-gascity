// The header: connection chip with "retry now", where gc was found, the
// copy's city, "N need you", data age, banners, the other cities, the city
// switcher of an unpinned copy and the discovery diagnostics. Draws only the
// model; clicks call the actions.

import { h_flex, v_flex } from "gpui-base";
import type { ThemeRead } from "../host.ts";
import type { HeaderModel } from "../vm/header.ts";
import { label, muted, pill } from "./text.ts";

export interface HeaderActions {
  retry(cx: GpuiContext): void;
  select(city: string, cx: GpuiContext): void;
}

/**
 * The header's rows. `compact` (the Needs you tab, which follows what it is
 * shown): one status line with the city, banners and diagnostics; no
 * endpoint, other cities or switcher.
 */
export function renderHeader(h: HeaderModel, theme: ThemeRead, actions: HeaderActions, compact = false): GpuiElement[] {
  const out: GpuiElement[] = [];
  let status = h_flex().id("gascity-status").gap(8).items_center().text_size(compact ? 12 : 14);
  if (compact && h.city !== null) status = status.child(label("gascity-city", h.city).font_semibold());
  status = status.child(compact ? muted(label("gascity-chip", h.chip.text), theme) : label("gascity-chip", h.chip.text));
  if (h.needsYou !== null) status = status.child(label("gascity-needs-you", h.needsYou));
  if (h.age !== null) status = status.child(muted(label("gascity-age", h.age), theme));
  if (h.canRetry) status = status.child(pill("gascity-retry", "Retry now", (cx) => actions.retry(cx)));
  out.push(status);
  if (!compact && h.endpoint !== null) out.push(muted(label("gascity-endpoint", h.endpoint), theme));
  if (!compact && h.city !== null) out.push(label("gascity-city", `City: ${h.city}`));
  h.banners.forEach((text, i) => out.push(label(`gascity-banner-${i}`, text)));
  if (!compact && h.others.length > 0) {
    const others = h.others.map((o) => `${o.name} (${o.label})`).join(", ");
    out.push(muted(label("gascity-others", `Other cities: ${others}`), theme));
  }
  // A compact header still offers the switcher when it has no city to show.
  if (h.choices !== null && h.choices.length > 0 && (!compact || h.city === null)) {
    const heading = h.city === null ? "Choose a city:" : "Switch to:";
    const list = h_flex().id("gascity-choices").gap(6).items_center().child(muted(label("gascity-choices-heading", heading), theme).text_size(12));
    out.push(list.children(h.choices.map((c, i) =>
      pill(`gascity-choose-${i}`, `${c.name} (${c.label})`, (cx) => actions.select(c.name, cx)))));
  }
  if (h.diagnostics.length > 0) {
    const lines = h.diagnostics.map((line, i) => muted(label(`gascity-diagnostic-${i}`, line), theme));
    out.push(v_flex().id("gascity-diagnostics").gap(2).child(label("gascity-diagnostics-heading", "Discovery:")).children(lines));
  }
  return out;
}
