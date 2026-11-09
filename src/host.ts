// The only module that touches herdr-app's host APIs (design §4). Every
// export the mod calls is feature-detected at init, so a herdr-app that lacks
// one gets a visible banner instead of a module link failure that would only
// show up in `herdr-app status`.

import * as herdr from "herdr";

/** The herdr exports this build calls. */
export const REQUIRED_HOST_EXPORTS = ["theme"] as const;

/** The required herdr exports this herdr-app does not provide, in declaration order. */
export function missingHostExports(): string[] {
  const host: Record<string, unknown> = { ...herdr };
  return REQUIRED_HOST_EXPORTS.filter((name) => typeof host[name] !== "function");
}

/** The theme colours the panel uses; a colour the theme does not name is undefined. */
export interface PanelColors {
  background: string | undefined;
  foreground: string | undefined;
  muted: string | undefined;
}

/** Reads the current theme. Call only after `missingHostExports()` came back empty. */
export function panelColors(): PanelColors {
  const theme = herdr.theme();
  return { background: theme.background, foreground: theme.foreground, muted: theme.muted };
}
