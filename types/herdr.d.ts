// The subset of herdr-app's `herdr` host module (herdr-app v0.1.14,
// `defaults/herdr.d.ts`) that this mod uses. herdr-app regenerates the full
// file into the app home on every start; keep this subset in step with it.
declare module "herdr" {
  /** Every theme colour by name (foreground, muted, accent, …). */
  export function theme(): Record<string, string>;

  export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
  }

  /** Runs a program with the user's real environment. `timeout` defaults to 30 000 ms, capped at 600 000.
   *  Rejects when it can't start. */
  export function exec(command: string, args?: string[], options?: { cwd?: string; on?: string | null; timeout?: number }): Promise<ExecResult>;

  /** The user's home directory. */
  export function home(): string;

  /** Reads UTF-8 text (up to 1 MiB), or null if absent. */
  export function readTextFile(path: string, options?: { on?: string | null }): Promise<string | null>;

  /** The props this copy of the mod was given in the layout (or overlay); null for a copy opened without props. */
  export function props(): unknown;

  /** Reads a value every mod can see (persisted). */
  export function shared(key: string): unknown;

  /** The app's folder (`~/.config/herdr-app`, or `$HERDR_APP_HOME`). */
  export function appHome(): string;

  /** Writes UTF-8 text only if it still matches expected (null creates a new file).
   * Rejects on a stale snapshot; existing files are replaced atomically. */
  export function writeTextFile(path: string, text: string, expected: string | null): Promise<null>;

  /** Every pane in every tab (herdr's PaneInfo; decoded by host.schemas.ts). Live. */
  export function panes(): unknown[];

  /** Actual terminal/pane focus: the window's current space and tab, or null. Live. */
  export function focused(): unknown;

  /** The shown layout (layouts/<name>.json). */
  export function layout(): unknown;

  /** Herdr's and herdr-core's versions and what's waiting. */
  export function updates(): { app: { version: string } };
}
