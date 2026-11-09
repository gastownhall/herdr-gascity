// Every way a gc call can fail, as one typed union (design §5.3), and the
// mapping from gc's HTTP answers to it. Nothing is swallowed: callers render,
// log and probe these.
//
// The 401/403 mapping keys on the exact problem `detail` texts gc writes at
// the pin (internal/api/writeauth.go problem bodies; the CSRF and read-only
// guards in huma_handlers_supervisor.go). They are a contract by convention
// only; gc gap GA6 asks for machine-readable codes.

import { decodeValue } from "./decode.ts";
import { ErrorModelSchema, RequestFailedPayloadSchema } from "./schemas.gen.ts";
import type { ErrorModel, RequestFailedPayload, RequestOutcome } from "./types.gen.ts";

/** An RFC 9457 problem body as gc sends it. */
export type ProblemDetails = ErrorModel;

/** Why a mutation's outcome is unknown. */
export type OutcomeUnknownCause = "timeout" | "unreachable" | "too-large" | "outcome-poll-expired" | "reported-by-gc";

/** Every failure of a gc call or of host data, as the mod renders and logs it. */
export type GcError =
  /** fetch rejected: connection refused, reset, DNS, or a host capability refusal. */
  | { kind: "unreachable"; url: string; cause: string }
  /** herdr's fetch hit its fixed 30 s timeout. */
  | { kind: "timeout"; url: string; ms: number }
  /** A body over herdr's fetch cap (8 MiB): a request is refused before sending. */
  | { kind: "too-large"; url: string; direction: "request" | "response"; limitBytes: number }
  /** Any other non-2xx answer; `problem` when the body is an RFC 9457 problem, else `raw`. */
  | { kind: "http"; status: number; problem: ProblemDetails | null; raw?: string }
  /** 403 "csrf: …": the mod sent a mutation without X-GC-Request (a bug in the mod). */
  | { kind: "csrf-rejected" }
  /** 403 "read_only: …": gc is bound to a non-loopback address. */
  | { kind: "read-only"; detail: string }
  /** 401, 403 "write grant rejected", or 403 workspace-service gate: a hardened city. */
  | { kind: "write-grant-required"; status: 401 | 403; detail: string }
  /** 404 "not_found: city not found or not running: <name>". */
  | { kind: "city-not-running"; city: string; status?: string }
  /** 404/405 without a problem body: the route does not exist, so gc is too old. */
  | { kind: "api-missing"; operationId: string; gcVersion?: string }
  /** A body that does not match the pinned model. */
  | { kind: "decode"; operationId: string; path: string; issues: string[] }
  /** A 202 request that gc reports as failed. */
  | { kind: "outcome-failed"; requestId: string; operation: RequestOutcome["operation"]; payload: RequestFailedPayload }
  /** A mutation that may or may not have happened: refetch before allowing a retry. */
  | { kind: "outcome-unknown"; requestId: string | null; operationId: string; cause: OutcomeUnknownCause }
  /** A program the mod ran failed. */
  | { kind: "exec"; argv: string[]; code: number | null; stderr: string }
  /** This herdr-app lacks host exports the mod needs. */
  | { kind: "host-incompatible"; missing: string[] }
  /** herdr host data that does not match host.schemas.ts. */
  | { kind: "host-decode"; api: string; path: string; issues: string[] }
  /** Open terminal did not start an attach. */
  | {
    kind: "attach-not-started";
    sessionId: string;
    reason: "wake-refused" | "not-running-after-wake" | "not-seen-in-terminals" | "attach-exited";
    detail: string;
  }
  /** The configured gc API is not a loopback address. */
  | { kind: "not-loopback"; url: string };

/** gc's stable 404 detail for a city that is not running (internal/api/city_scope.go). */
export const CITY_NOT_RUNNING_PREFIX = "not_found: city not found or not running: ";

/** Raw non-problem bodies are kept up to this many characters. */
export const RAW_LIMIT = 2000;

function parseProblem(body: string): ProblemDetails | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const decoded = decodeValue(ErrorModelSchema, json, "problem");
  return decoded.ok ? decoded.value : null;
}

function rawText(body: string): string {
  return body.trim().slice(0, RAW_LIMIT);
}

/** Maps a non-2xx answer of `operationId` to a GcError. */
export function httpError(operationId: string, status: number, body: string): GcError {
  const problem = parseProblem(body);
  const detail = problem?.detail ?? "";

  if ((status === 404 || status === 405) && problem === null) return { kind: "api-missing", operationId };
  if (status === 404 && detail.startsWith(CITY_NOT_RUNNING_PREFIX)) {
    return { kind: "city-not-running", city: detail.slice(CITY_NOT_RUNNING_PREFIX.length) };
  }
  if (status === 401) return { kind: "write-grant-required", status: 401, detail: problem ? detail : rawText(body) };
  if (status === 403) {
    if (detail.startsWith("csrf:")) return { kind: "csrf-rejected" };
    if (detail.startsWith("read_only:")) return { kind: "read-only", detail };
    if (detail === "write grant rejected" || detail.startsWith("workspace-service mutations are disabled")) {
      return { kind: "write-grant-required", status: 403, detail };
    }
  }
  if (problem) return { kind: "http", status, problem };
  return { kind: "http", status, problem: null, raw: rawText(body) };
}

/** A hint for a known problem: 409 "pending_interaction: …" means a prompt waits for an answer. */
export function problemHint(error: GcError): "answer-pending-prompt" | null {
  if (error.kind === "http" && error.status === 409 && error.problem?.detail?.startsWith("pending_interaction:")) {
    return "answer-pending-prompt";
  }
  return null;
}

const OUTCOME_OP = "get-request-outcome";

/**
 * The failure a 202 request's outcome reports, or null while it is pending,
 * when it succeeded, or when its state is one this pin does not know.
 */
export function outcomeFailure(outcome: RequestOutcome): GcError | null {
  if (outcome.state === "outcome_unknown") {
    return { kind: "outcome-unknown", requestId: outcome.request_id, operationId: OUTCOME_OP, cause: "reported-by-gc" };
  }
  if (outcome.state !== "failed") return null;
  const event = outcome.event;
  if (!event || event.type !== "request.failed") {
    return { kind: "decode", operationId: OUTCOME_OP, path: "event", issues: ["event: a failed outcome must carry a request.failed event"] };
  }
  const payload = decodeValue(RequestFailedPayloadSchema, event.payload, OUTCOME_OP, "event.payload");
  if (!payload.ok) return payload.error;
  return { kind: "outcome-failed", requestId: outcome.request_id, operation: outcome.operation, payload: payload.value };
}
