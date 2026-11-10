// Shared drawing helpers. Every string the view draws passes `label`, which
// cleans it once more (the view-models already clean what gc sends): the one
// place no unclean text can slip past.

import { div } from "gpui-kit";
import type { ThemeRead } from "../host.ts";
import { cleanLine } from "../vm/sanitize.ts";

/** A text element with a stable id; the text is cleaned. */
export function label(id: string, text: string): GpuiElement {
  return div().id(id).child(cleanLine(text));
}

function tinted(el: GpuiElement, color: GpuiColor | undefined, apply: (el: GpuiElement, color: GpuiColor) => GpuiElement): GpuiElement {
  return color === undefined ? el : apply(el, color);
}

/** Secondary text: the theme's muted colour. */
export function muted(el: GpuiElement, theme: ThemeRead): GpuiElement {
  return tinted(el, theme.colors.muted, (e, c) => e.text_color(c));
}

/** Greyed when the data may be out of date. */
export function greyedIf(el: GpuiElement, stale: boolean, theme: ThemeRead): GpuiElement {
  return stale ? muted(el, theme) : el;
}

/** The panel's root with the theme's background and foreground. */
export function themedRoot(theme: ThemeRead, el: GpuiElement): GpuiElement {
  const { colors } = theme;
  return tinted(tinted(el, colors.background, (e, c) => e.bg(c)), colors.foreground, (e, c) => e.text_color(c));
}

/**
 * In a row, an element that takes an equal share of the width and may shrink
 * below its content, so its text wraps instead of running off the edge; in a
 * column (`inRow` false) it keeps its natural height.
 */
export function shrinkIf(el: GpuiElement, inRow: boolean): GpuiElement {
  return inRow ? el.flex_1().min_w_0() : el;
}
