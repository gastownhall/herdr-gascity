// A run's stage strip: one small box per stage (the run-views design's one
// encoding). Done: green, faint; the agent working: green; waiting on a
// person: amber; the next stage, unconfirmed: amber outline; pending: grey
// outline. Colour is never alone: rows print the stage name beside it.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { StatusColors } from "../host.ts";
import type { StageCell } from "../sync/runs.ts";

function cell(id: string, c: StageCell, colors: StatusColors, w: number | null, h: number): GpuiElement {
  const el = w === null ? div().id(id).h(h).rounded(2) : div().id(id).w(w).h(h).flex_none().rounded(2);
  const fill = (color: GpuiColor | undefined, alpha = "") => (color === undefined ? el.border_1() : el.bg(`${color}${alpha}` as GpuiColor));
  const outline = (color: GpuiColor | undefined) => (color === undefined ? el.border_1() : el.border_1().border_color(color));
  switch (c) {
    case "done":
      return fill(colors.ok, "73");
    case "active":
      return fill(colors.ok);
    case "gate":
      return fill(colors.warn);
    case "frontier":
      return outline(colors.warn);
    default:
      return outline(colors.dim);
  }
}

/** The strip; `small` for the sidebar (5 px cells), else 9 × 7 px. */
export function stageStrip(id: string, cells: readonly StageCell[], colors: StatusColors, small = false): GpuiElement {
  const [w, h] = small ? [5, 5] : [9, 7];
  return h_flex().id(id).gap(2).items_center().flex_none().children(cells.map((c, i) => cell(`${id}-${i}`, c, colors, w, h)));
}

/** One stage as a bar as wide as its parent (the run view's wide strip). */
export function stageBar(id: string, c: StageCell, colors: StatusColors): GpuiElement {
  return cell(id, c, colors, null, 8);
}
