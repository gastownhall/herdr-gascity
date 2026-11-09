// One line of text for every GcError, for chips, banners and diagnostics.
// The switch is exhaustive: a new error kind does not compile until it has a text.
// Errors carry text gc or a program supplied (problem details, stderr, city
// names), so the line is cleaned of control characters and escapes.

import { isUnrecognized } from "../gc/decode.ts";
import type { GcError } from "../gc/errors.ts";
import { cleanLine } from "./sanitize.ts";

/** Why a non-loopback URL is refused. */
export const LOOPBACK_ONLY = "only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed";

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

function drift(value: unknown): string {
  return isUnrecognized(value) ? value.raw : String(value);
}

/** The person-facing text of an error, one clean line. */
export function errorText(e: GcError): string {
  return cleanLine(rawText(e));
}

function rawText(e: GcError): string {
  switch (e.kind) {
    case "unreachable":
      return `cannot reach ${e.url}: ${e.cause}`;
    case "timeout":
      return `no answer from ${e.url} within ${seconds(e.ms)}`;
    case "too-large":
      return `the ${e.direction} at ${e.url} is over herdr's ${e.limitBytes} byte limit`;
    case "http": {
      const detail = e.problem ? (e.problem.detail ?? e.problem.title ?? "") : (e.raw ?? "");
      return detail === "" ? `gc answered ${e.status}` : `gc answered ${e.status}: ${detail}`;
    }
    case "csrf-rejected":
      return "gc refused a change without X-GC-Request (a bug in the mod)";
    case "read-only":
      return `gc serves this API read-only (${e.detail})`;
    case "write-grant-required":
      return `this city requires a signed write grant (${e.detail})`;
    case "read-grant-required":
      return `this city requires a signed read grant (${e.detail})`;
    case "city-not-running":
      return `city "${e.city}" is not running`;
    case "api-missing":
      return `gc too old (needs ${e.operationId})${e.raw === undefined ? "" : `: ${e.raw}`}`;
    case "decode":
      return `unreadable answer to ${e.operationId}${e.path === "" ? "" : ` at ${e.path}`}: ${e.issues.join("; ")}`;
    case "outcome-failed":
      return `request ${e.requestId} (${drift(e.operation)}) failed: ${e.payload.error_code}: ${e.payload.error_message}`;
    case "outcome-unknown": {
      const why = e.requestId === null ? e.cause : `${e.cause}, request ${e.requestId}`;
      const issues = e.issues && e.issues.length > 0 ? `: ${e.issues.join("; ")}` : "";
      return `outcome of ${e.operationId} unknown (${why})${issues}`;
    }
    case "exec":
      return e.code === null
        ? `${e.argv.join(" ")} did not run: ${e.stderr}`
        : `${e.argv.join(" ")} exited with code ${e.code}: ${e.stderr}`;
    case "host-incompatible":
      return `this herdr-app lacks ${e.missing.join(", ")}`;
    case "host-decode":
      return `unreadable ${e.api}${e.path === "" ? "" : ` at ${e.path}`}: ${e.issues.join("; ")}`;
    case "host-call":
      return `${e.api} failed: ${e.cause}`;
    case "supervisor-config":
      return `${e.path} line ${e.line}: ${e.issue}`;
    case "attach-not-started":
      return `terminal for ${e.sessionId} not opened (${e.reason}): ${e.detail}`;
    case "not-loopback":
      return LOOPBACK_ONLY;
    case "cancelled":
      return e.reason === "copy-closed"
        ? `request to ${e.url} was cancelled: the Gas City view that started it closed`
        : `request to ${e.url} was dropped before it was sent: nothing waits for its answer any more`;
  }
}
