// The argv of an attach tab: `env -u HC_SCOPE -u HC_TERMINAL_ID -u
// HC_TERMINAL_SOCKET <gcBin> --city <path> session attach <id> [--no-start]`.
//
// herdr-core gives every program a herdr terminal runs an HC_SCOPE sweep
// token and kills every process carrying it when the terminal's holder dies.
// The mod wakes a session through gc's API before it opens the tab (so the
// controller starts the runtime from its own environment); the `env -u`
// prefix is the defence in depth for a session that falls asleep in between:
// whatever that attach starts and leaves running does not carry the token.
// gc ≥ NO_START_MIN_GC has `--no-start` (attach only to a running session,
// exit non-zero otherwise), which closes that race.
//
// Pure: no host calls. host.ts runs attachArgvIssue before every tab.new.

import { gcBinIssue } from "../discovery/settings.ts";

/** The prefix every attach argv starts with: herdr-core's terminal variables removed from the environment. */
export const HC_SCRUB: readonly string[] = ["env", "-u", "HC_SCOPE", "-u", "HC_TERMINAL_ID", "-u", "HC_TERMINAL_SOCKET"];

/** gc's flag: attach only if the session is running; never create, start or wake it. */
export const NO_START_FLAG = "--no-start";

/**
 * The first gc release with `gc session attach --no-start`. The flag merged
 * into gc's main on 2026-11-09 (gastownhall/gascity#9011), after v1.5.1,
 * which gc cut from a release branch that lacks it; so the first release that
 * can have it is the next minor one. A gc that reports no release version
 * ("dev", a build without a tag) gets no flag: wake-then-poll through the API
 * is the guard either way.
 */
export const NO_START_MIN_GC = "1.6.0";

/** What an attach tab attaches to: gc's program, the city's path and the session's id, as gc gave them. */
export interface AttachTarget {
  gcBin: string;
  cityPath: string;
  sessionId: string;
}

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

function release(version: string): [number, number, number] | null {
  const m = RELEASE.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether gc `version` (from /health) has `session attach --no-start`. A pre-release of the minimum counts. */
export function supportsNoStart(version: string): boolean {
  const have = release(version);
  const need = release(NO_START_MIN_GC);
  if (have === null || need === null) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** gc's session ids are bead ids: letters, digits, ".", "_" and "-", never starting with "-" (a flag). */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Why `id` may not go into an attach argv, or null. */
export function sessionIdIssue(id: string): string | null {
  return SESSION_ID.test(id) ? null : `session id ${JSON.stringify(id)} is not a gc session id`;
}

/** Why `path` may not go into an attach argv as `--city`, or null: absolute, no control characters, no ".." segment. */
export function cityPathIssue(path: string): string | null {
  if (!path.startsWith("/")) return `city path ${JSON.stringify(path)} is not absolute`;
  if (/[\u0000-\u001f\u007f]/.test(path)) return `city path ${JSON.stringify(path)} has a control character`;
  if (path.split("/").includes("..")) return `city path ${JSON.stringify(path)} has a ".." segment`;
  return null;
}

/** `<gcBin> --city <path> session attach <id>`: what a terminal running our attach ends with (before `--no-start`). */
export function attachTail(t: AttachTarget): string[] {
  return [t.gcBin, "--city", t.cityPath, "session", "attach", t.sessionId];
}

/** The whole argv for herdr's tab.new. */
export function attachArgv(t: AttachTarget, noStart: boolean): string[] {
  return [...HC_SCRUB, ...attachTail(t), ...(noStart ? [NO_START_FLAG] : [])];
}

function endsWith(argv: readonly string[], tail: readonly string[]): boolean {
  if (argv.length < tail.length) return false;
  const start = argv.length - tail.length;
  return tail.every((w, i) => argv[start + i] === w);
}

/** Whether a terminal's argv (herdr's shell wrapper included) runs our attach of `t`, with or without `--no-start`. */
export function isAttachOf(argv: readonly string[], t: AttachTarget): boolean {
  const tail = [...HC_SCRUB, ...attachTail(t)];
  return endsWith(argv, tail) || endsWith(argv, [...tail, NO_START_FLAG]);
}

/**
 * Why `argv` is not an attach argv, or null: exactly HC_SCRUB, a gc program
 * (gcBinIssue), `--city`, a city path (cityPathIssue), `session attach`, a
 * session id (sessionIdIssue), and optionally `--no-start` — nothing else.
 */
export function attachArgvIssue(argv: readonly string[]): string | null {
  const n = HC_SCRUB.length;
  if (!HC_SCRUB.every((w, i) => argv[i] === w)) return `the argv does not start with ${HC_SCRUB.join(" ")}`;
  const [gcBin, city, path, verb, sub, id, ...rest] = argv.slice(n);
  if (gcBin === undefined || city !== "--city" || path === undefined || verb !== "session" || sub !== "attach" || id === undefined) {
    return "the argv is not <gc> --city <path> session attach <id> after the env prefix";
  }
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== NO_START_FLAG)) return `unexpected arguments after the session id: ${JSON.stringify(rest)}`;
  return gcBinIssue(gcBin) ?? cityPathIssue(path) ?? sessionIdIssue(id);
}
