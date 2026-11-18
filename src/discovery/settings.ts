// Machine-wide settings: the gc API URL and the gc program. They live in
// herdr's shared store under one key, so every copy of the mod, pinned or
// not, sees what the installer or the person set (per-copy localStorage is
// keyed by the copy's props, so it would hide them from pinned copies).
// A stored value this build cannot read is a visible error, never replaced
// by a default.

import { err, ok, type Result } from "../result.ts";
import { isLoopbackApiUrl } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";

/** The shared-store key. */
export const SETTINGS_KEY = "gascity.settings";
/** gc on the PATH of herdr-app's environment. */
export const DEFAULT_GC_BIN = "gc";

/** The settings discovery reads. */
export interface Settings {
  /** An explicit gc API URL, as written; the loopback guard runs when it is resolved. */
  apiUrl: string | null;
  /** The gc program: "gc" or an absolute path to it. */
  gcBin: string;
  /** The web dashboard (mdash) to link to, e.g. https://mdash.example.com; null: no links. */
  dashboardUrl: string | null;
  /** The dashboard formula runs link to (factory), e.g. https://factory.example.com; null: no run links. */
  runsUrl: string | null;
}

/** A change to the stored settings; `apiUrl: null` clears it. */
export interface SettingsPatch {
  apiUrl?: string | null;
  gcBin?: string;
  /** null clears it. */
  dashboardUrl?: string | null;
  /** null clears it. */
  runsUrl?: string | null;
}

type HostDecodeError = Extract<GcError, { kind: "host-decode" }>;

const API = `shared("${SETTINGS_KEY}")`;
const GC_BIN = /^(gc|(\/[^\0-\x1f\x7f]*)?\/gc)$/;

function invalid(path: string, issue: string): HostDecodeError {
  return { kind: "host-decode", api: API, path, issues: [path === "" ? issue : `${path}: ${issue}`] };
}

/**
 * Why `gcBin` may not be run, or null when it may. Discovery runs it only as
 * `gcBin supervisor status --json`; this keeps that from naming any other
 * program (the runtime half of the exec allowlist in src/host.ts).
 */
export function gcBinIssue(gcBin: string): string | null {
  return GC_BIN.test(gcBin) ? null : `must be "gc" or an absolute path to a program named gc, not ${JSON.stringify(gcBin)}`;
}

/** https, a host, an optional port and path; no query, fragment, credentials, whitespace or control characters. */
const DASHBOARD_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;

/** Why `url` may not be the dashboard the mod links to, or null: an https origin with an optional path. */
export function dashboardUrlIssue(url: string): string | null {
  return DASHBOARD_URL.test(url) ? null : `must be an https URL with no query or fragment, like https://mdash.example.com, not ${JSON.stringify(url)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the stored value; absent means the defaults. Unknown keys are ignored. */
export function decodeSettings(raw: unknown): Result<Settings, HostDecodeError> {
  if (raw === undefined || raw === null) return ok({ apiUrl: null, gcBin: DEFAULT_GC_BIN, dashboardUrl: null, runsUrl: null });
  if (!isRecord(raw)) return err(invalid("", `expected an object, got ${JSON.stringify(raw)}`));
  const { apiUrl, gcBin, dashboardUrl, runsUrl } = raw;
  if (apiUrl !== undefined && (typeof apiUrl !== "string" || apiUrl === "")) {
    return err(invalid("apiUrl", `expected a non-empty string, got ${JSON.stringify(apiUrl)}`));
  }
  if (gcBin !== undefined) {
    if (typeof gcBin !== "string") return err(invalid("gcBin", `expected a string, got ${JSON.stringify(gcBin)}`));
    const issue = gcBinIssue(gcBin);
    if (issue) return err(invalid("gcBin", issue));
  }
  if (dashboardUrl !== undefined) {
    if (typeof dashboardUrl !== "string") return err(invalid("dashboardUrl", `expected a string, got ${JSON.stringify(dashboardUrl)}`));
    const issue = dashboardUrlIssue(dashboardUrl);
    if (issue) return err(invalid("dashboardUrl", issue));
  }
  if (runsUrl !== undefined) {
    if (typeof runsUrl !== "string") return err(invalid("runsUrl", `expected a string, got ${JSON.stringify(runsUrl)}`));
    const issue = dashboardUrlIssue(runsUrl);
    if (issue) return err(invalid("runsUrl", issue));
  }
  const trim = (u: unknown) => (typeof u === "string" ? u.replace(/\/+$/, "") : null);
  return ok({ apiUrl: apiUrl ?? null, gcBin: gcBin ?? DEFAULT_GC_BIN, dashboardUrl: trim(dashboardUrl), runsUrl: trim(runsUrl) });
}

/**
 * The value to store after applying `patch` to the stored `raw` value. Keys
 * this build does not know are kept. A non-loopback apiUrl or a gcBin that is
 * not gc is refused before anything is stored.
 */
export function patchSettings(raw: unknown, patch: SettingsPatch): Result<Record<string, unknown>, GcError> {
  if (raw !== undefined && raw !== null && !isRecord(raw)) {
    return err(invalid("", `cannot change a stored value that is not an object: ${JSON.stringify(raw)}`));
  }
  const next: Record<string, unknown> = { ...(raw ?? {}) };
  if (patch.apiUrl === null) delete next["apiUrl"];
  else if (patch.apiUrl !== undefined) {
    if (!isLoopbackApiUrl(patch.apiUrl)) return err({ kind: "not-loopback", url: patch.apiUrl });
    next["apiUrl"] = patch.apiUrl;
  }
  if (patch.gcBin !== undefined) {
    const issue = gcBinIssue(patch.gcBin);
    if (issue) return err(invalid("gcBin", issue));
    next["gcBin"] = patch.gcBin;
  }
  if (patch.dashboardUrl === null) delete next["dashboardUrl"];
  else if (patch.dashboardUrl !== undefined) {
    const issue = dashboardUrlIssue(patch.dashboardUrl);
    if (issue) return err(invalid("dashboardUrl", issue));
    next["dashboardUrl"] = patch.dashboardUrl.replace(/\/+$/, "");
  }
  if (patch.runsUrl === null) delete next["runsUrl"];
  else if (patch.runsUrl !== undefined) {
    const issue = dashboardUrlIssue(patch.runsUrl);
    if (issue) return err(invalid("runsUrl", issue));
    next["runsUrl"] = patch.runsUrl.replace(/\/+$/, "");
  }
  return ok(next);
}
