// Render functions for the panel. They read only the model they are given:
// no host calls, no I/O (design §4).

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import type { PanelColors } from "../host.ts";

/** What the panel shows. */
export type PanelModel =
  | { kind: "placeholder"; colors: PanelColors }
  | { kind: "host-incompatible"; missing: readonly string[] };

export const TITLE = "Gas City";
export const PLACEHOLDER_TEXT = "No city data yet: this build of the mod does not connect to gc.";

/** The banner text for a herdr-app that lacks host exports this build calls. */
export function hostIncompatibleText(missing: readonly string[]): string {
  return `This herdr-app is too old for the Gas City mod: it lacks ${missing.join(", ")}.`;
}

function tinted(el: GpuiElement, color: string | undefined, apply: (el: GpuiElement, color: string) => GpuiElement): GpuiElement {
  return color === undefined ? el : apply(el, color);
}

/** The whole panel for one model. */
export function renderPanel(model: PanelModel): GpuiElement {
  const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
  const title = div().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    return root.child(title).child(div().id("gascity-host-incompatible").child(hostIncompatibleText(model.missing)));
  }
  const { background, foreground, muted } = model.colors;
  const placeholder = tinted(div().id("gascity-placeholder"), muted, (el, c) => el.text_color(c)).child(PLACEHOLDER_TEXT);
  const themed = tinted(tinted(root, background, (el, c) => el.bg(c)), foreground, (el, c) => el.text_color(c));
  return themed.child(title).child(placeholder);
}
