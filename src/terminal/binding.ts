// The TerminalBinding seam: how the mod shows a session's terminal.
//
// Today there is one binding, an attach tab: a herdr terminal tab running
// `gc session attach` (attach.ts), after gc's API reports the session
// running. Later, once gc reports a session's runtime binding (or a herdr-core
// runtime pack labels the terminals it starts), the session's own hc terminal
// is shown in an overlay window instead; those resolvers go before the attach
// tab in `resolveBinding`, and every caller already goes through this seam.
//
// Pure: no host calls.

import { gcBinIssue } from "../discovery/settings.ts";
import type * as T from "../gc/types.gen.ts";
import { err, ok, type Result } from "../result.ts";
import { cleanLine } from "../vm/sanitize.ts";
import { cityPathIssue, sessionIdIssue, supportsNoStart, type AttachTarget } from "./argv.ts";

/** How a session's terminal is shown. */
export type TerminalBinding =
  /** A new herdr tab running `gc session attach` (or the tab that still runs it). */
  { kind: "attach-tab"; target: AttachTarget; noStart: boolean };

/**
 * gc transports that have no terminal to attach to, keyed by gc's
 * `transport` value, with what the person is told. Anything else (empty,
 * unknown, new) is allowed: gc answers in the tab.
 */
const NO_ATTACH: Readonly<Record<string, string>> = {
  acp: "this session runs over acp (a protocol, not a terminal): gc cannot attach to it",
  subprocess: "this session runs as a plain subprocess: gc cannot attach to it",
};

/** Why a session on `transport` has no terminal to open, or null. */
export function attachRefusal(transport: string | undefined): string | null {
  return transport !== undefined && Object.hasOwn(NO_ATTACH, transport) ? (NO_ATTACH[transport] ?? null) : null;
}

/** What resolving a binding reads: the session as gc lists it, its city's path from /v0/cities, the gc program and gc's version. */
export interface BindingInput {
  session: T.SessionResponse;
  cityPath: string;
  gcBin: string;
  gcVersion: string;
}

/** The binding for a session's terminal, or why there is none. */
export function resolveBinding(input: BindingInput): Result<TerminalBinding, string> {
  const refused = attachRefusal(input.session.transport);
  if (refused !== null) return err(refused);
  const issue = gcBinIssue(input.gcBin) ?? cityPathIssue(input.cityPath) ?? sessionIdIssue(input.session.id);
  if (issue !== null) return err(cleanLine(issue));
  return ok({
    kind: "attach-tab",
    target: { gcBin: input.gcBin, cityPath: input.cityPath, sessionId: input.session.id },
    noStart: supportsNoStart(input.gcVersion),
  });
}
