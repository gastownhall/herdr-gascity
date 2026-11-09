// The only module that touches herdr-app's host APIs. Every export the mod
// calls is feature-detected at init, so a herdr-app that lacks one gets a
// visible banner instead of a module link failure that would only show up in
// `herdr-app status`. Host data is checked before it reaches the view.

import * as herdr from "herdr";
import { err, ok, type Result } from "./result.ts";
import type { HostFetch } from "./gc/client.ts";
import type { GcError } from "./gc/errors.ts";
import { GC_STATUS_ARGS } from "./discovery/gcStatus.ts";
import { SETTINGS_KEY, gcBinIssue } from "./discovery/settings.ts";

/** The herdr exports and script globals this build calls. */
export const REQUIRED_HOST_EXPORTS = ["theme", "props", "shared", "home", "readTextFile", "exec", "fetch", "localStorage"] as const;
export type HostExport = (typeof REQUIRED_HOST_EXPORTS)[number];

/** The required herdr exports and globals this herdr-app does not provide, in declaration order. */
export function missingHostExports(): HostExport[] {
  const present: Record<HostExport, boolean> = {
    theme: typeof herdr.theme === "function",
    props: typeof herdr.props === "function",
    shared: typeof herdr.shared === "function",
    home: typeof herdr.home === "function",
    readTextFile: typeof herdr.readTextFile === "function",
    exec: typeof herdr.exec === "function",
    fetch: typeof fetch === "function",
    localStorage: typeof localStorage === "object" && localStorage !== null,
  };
  return REQUIRED_HOST_EXPORTS.filter((name) => !present[name]);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** This copy's props: null for a copy opened without props (decoded by discovery/city.ts). */
export function readProps(): unknown {
  return herdr.props();
}

/** The raw machine-wide settings (decoded by discovery/settings.ts). */
export function readSharedSettings(): unknown {
  return herdr.shared(SETTINGS_KEY);
}

/** herdr's fetch, in the shape the gc client takes. */
export const hostFetch: HostFetch = (url, init) => fetch(url, init);

/** The per-copy localStorage key of the city an unpinned copy last showed. */
export const LAST_CITY_KEY = "city";

/** The city this copy last showed, or null. */
export function readLastCity(): Result<string | null, GcError> {
  try {
    const value = localStorage.getItem(LAST_CITY_KEY);
    return ok(value === "" ? null : value);
  } catch (cause) {
    return err({ kind: "host-call", api: `localStorage.getItem("${LAST_CITY_KEY}")`, cause: messageOf(cause) });
  }
}

/** Remembers the city this copy shows. */
export function rememberCity(city: string): Result<null, GcError> {
  try {
    localStorage.setItem(LAST_CITY_KEY, city);
    return ok(null);
  } catch (cause) {
    return err({ kind: "host-call", api: `localStorage.setItem("${LAST_CITY_KEY}")`, cause: messageOf(cause) });
  }
}

/** Where gc keeps its supervisor config by default (a GC_HOME elsewhere needs the apiUrl setting: mods cannot read env vars). */
export function supervisorConfigPath(): string {
  return `${herdr.home().replace(/\/+$/, "")}/.gc/supervisor.toml`;
}

/** supervisor.toml's path and text; null text when the file does not exist. */
export async function readSupervisorConfig(): Promise<Result<{ path: string; text: string | null }, GcError>> {
  const path = supervisorConfigPath();
  try {
    return ok({ path, text: await herdr.readTextFile(path) });
  } catch (cause) {
    return err({ kind: "host-call", api: `readTextFile(${path})`, cause: messageOf(cause) });
  }
}

/** How long `gc supervisor status --json` may run. */
export const GC_STATUS_TIMEOUT_MS = 10_000;
/** stderr is kept up to this many characters. */
const STDERR_LIMIT = 2000;

/**
 * Runs `<gcBin> supervisor status --json` and returns its stdout. The runtime
 * half of the exec allowlist: this is the only exec of a program other than
 * the dashboard opener, its arguments are fixed, and gcBin must name gc
 * (settings.ts gcBinIssue) or nothing is spawned.
 */
export async function execGcStatus(gcBin: string): Promise<Result<string, GcError>> {
  const argv = [gcBin, ...GC_STATUS_ARGS];
  const refused = gcBinIssue(gcBin);
  if (refused) return err({ kind: "exec", argv, code: null, stderr: `not run: gcBin ${refused}` });
  return herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS }).then(
    (result): Result<string, GcError> => result.code === 0
      ? ok(result.stdout)
      : err({ kind: "exec", argv, code: result.code, stderr: result.stderr.trim().slice(0, STDERR_LIMIT) }),
    (cause: unknown): Result<string, GcError> => err({ kind: "exec", argv, code: null, stderr: messageOf(cause) }),
  );
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
