// How the panel arranges its regions for the width herdr laid it out at
// (the root's on_size_change, in logical px). Pure.
//
//   side-by-side – agents beside the work board, the board's columns in a row;
//   stacked      – the board under the agents, its columns still in a row;
//   narrow       – the board's columns stacked as well.
//
// Until herdr reports a size the panel is stacked: that fits any width a
// pane is likely to have. Every region in a row may shrink below its
// content, so its text wraps instead of running off the edge.

export type PanelLayout = "side-by-side" | "stacked" | "narrow";

/**
 * From this width the agents fit beside the board: the agents' rows with
 * their buttons (about 600 px) and three columns of about 280 px.
 */
export const SIDE_BY_SIDE_FROM_PX = 1500;

/** Below this width three columns side by side would be too thin to read (about 220 px each). */
export const NARROW_BELOW_PX = 720;

/** The layout for a width; null (or a width that is not a finite positive number) means herdr has not reported one. */
export function panelLayout(width: number | null): PanelLayout {
  if (width === null || !Number.isFinite(width) || width <= 0) return "stacked";
  if (width >= SIDE_BY_SIDE_FROM_PX) return "side-by-side";
  return width < NARROW_BELOW_PX ? "narrow" : "stacked";
}
