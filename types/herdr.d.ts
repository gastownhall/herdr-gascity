// The subset of herdr-app's `herdr` host module (herdr-app v0.1.14,
// `defaults/herdr.d.ts`) that this mod uses. herdr-app regenerates the full
// file on every start; the types-drift job (slice M12) checks `src/` against
// the generated one for each new release.
declare module "herdr" {
  /** Every theme colour by name (foreground, muted, accent, …). */
  export function theme(): Record<string, string>;
}
