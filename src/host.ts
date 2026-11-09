// The only module that touches herdr-app's host APIs. Every export the mod
// calls is feature-detected at init, so a herdr-app that lacks one gets a
// visible banner instead of a module link failure that would only show up in
// `herdr-app status`. Host data is checked before it reaches the view.

import * as herdr from "herdr";

/** The herdr exports this build calls. */
export const REQUIRED_HOST_EXPORTS = ["theme"] as const;
export type HostExport = (typeof REQUIRED_HOST_EXPORTS)[number];

/** The required herdr exports this herdr-app does not provide, in declaration order. */
export function missingHostExports(): HostExport[] {
  const exports: Record<HostExport, unknown> = { theme: herdr.theme };
  return REQUIRED_HOST_EXPORTS.filter((name) => typeof exports[name] !== "function");
}

/** The theme colours the panel uses. */
export const PANEL_COLORS = ["background", "foreground", "muted"] as const;
export type PanelColorName = (typeof PANEL_COLORS)[number];

/** Each panel colour, or undefined when the theme has no usable value for it. */
export type PanelColors = Record<PanelColorName, GpuiColor | undefined>;

/** The panel's colours, plus one message per colour the theme lacks or gives in a form gpui-kit rejects. */
export interface ThemeRead {
  colors: PanelColors;
  issues: string[];
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isColor(value: string): value is GpuiColor {
  return HEX_COLOR.test(value);
}

/** Reads the current theme. Call only after `missingHostExports()` came back empty. */
export function readTheme(): ThemeRead {
  const theme = herdr.theme();
  const issues: string[] = [];
  const pick = (name: PanelColorName): GpuiColor | undefined => {
    const value = Object.hasOwn(theme, name) ? theme[name] : undefined;
    if (value === undefined) {
      issues.push(`herdr theme has no colour "${name}"`);
      return undefined;
    }
    if (!isColor(value)) {
      issues.push(`herdr theme colour "${name}" is not a #rgb, #rrggbb or #rrggbbaa value: ${value}`);
      return undefined;
    }
    return value;
  };
  const colors: PanelColors = { background: pick("background"), foreground: pick("foreground"), muted: pick("muted") };
  return { colors, issues };
}
