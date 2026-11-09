// The subset of herdr-app's `herdr` host module (herdr-app v0.1.14,
// `defaults/herdr.d.ts`) that this mod uses. herdr-app regenerates the full
// file into the app home on every start; keep this subset in step with it.
declare module "herdr" {
  /** Every theme colour by name (foreground, muted, accent, …). */
  export function theme(): Record<string, string>;
}
