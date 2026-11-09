// The gc-reported API URL: `gc supervisor status --json` → `api_url`. Older
// gc releases do not print it, so the field is feature-detected: absent means
// "this gc does not say" and discovery moves on.

import { err, ok, type Result } from "../result.ts";
import type { GcError } from "../gc/errors.ts";

/** The arguments discovery passes to gcBin; the only gc command the mod runs itself. */
export const GC_STATUS_ARGS = ["supervisor", "status", "--json"] as const;
/** How the command is named in errors and diagnostics. */
export const GC_STATUS_COMMAND = `gc ${GC_STATUS_ARGS.join(" ")}`;

type DecodeError = Extract<GcError, { kind: "decode" }>;

function decodeError(path: string, issue: string): DecodeError {
  return { kind: "decode", operationId: GC_STATUS_COMMAND, path, issues: [issue] };
}

/** The API URL in the command's stdout, or null when this gc does not report one. */
export function parseGcStatus(stdout: string): Result<string | null, DecodeError> {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (cause) {
    return err(decodeError("", `(root): output is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return err(decodeError("", "(root): expected a JSON object"));
  }
  if (!Object.hasOwn(json, "api_url")) return ok(null);
  const url: unknown = (json as Record<string, unknown>)["api_url"];
  if (typeof url !== "string" || url === "") return err(decodeError("api_url", `api_url: expected a non-empty string, got ${JSON.stringify(url)}`));
  return ok(url);
}
