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
}

/** A change to the stored settings; `apiUrl: null` clears it. */
export interface SettingsPatch {
  apiUrl?: string | null;
  gcBin?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the stored value; absent means the defaults. Unknown keys are ignored. */
export function decodeSettings(raw: unknown): Result<Settings, HostDecodeError> {
  if (raw === undefined || raw === null) return ok({ apiUrl: null, gcBin: DEFAULT_GC_BIN });
  if (!isRecord(raw)) return err(invalid("", `expected an object, got ${JSON.stringify(raw)}`));
  const { apiUrl, gcBin } = raw;
  if (apiUrl !== undefined && (typeof apiUrl !== "string" || apiUrl === "")) {
    return err(invalid("apiUrl", `expected a non-empty string, got ${JSON.stringify(apiUrl)}`));
  }
  if (gcBin !== undefined) {
    if (typeof gcBin !== "string") return err(invalid("gcBin", `expected a string, got ${JSON.stringify(gcBin)}`));
    const issue = gcBinIssue(gcBin);
    if (issue) return err(invalid("gcBin", issue));
  }
  return ok({ apiUrl: apiUrl ?? null, gcBin: gcBin ?? DEFAULT_GC_BIN });
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
  return ok(next);
}
