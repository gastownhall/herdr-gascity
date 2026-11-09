// Every way a gc call can fail, as one typed union, and the
// mapping from gc's HTTP answers to it. Nothing is swallowed: callers render,
// log and probe these.
//
// The 401/403 mapping keys on the exact problem `detail` texts gc writes at
// the pin (internal/api/writeauth.go problem bodies; the CSRF and read-only
// guards in huma_handlers_supervisor.go). They are a contract by convention
// only: gc writes no machine-readable `code` on them.

import { decodeValue, isUnrecognized } from "./decode.ts";
import { ErrorModelSchema, RequestFailedPayloadSchema } from "./schemas.gen.ts";
import type { ErrorModel, RequestFailedPayload, RequestOutcome } from "./types.gen.ts";

/** An RFC 9457 problem body as gc sends it. */
export type ProblemDetails = ErrorModel;

/** Why a mutation's outcome is unknown. */
export type OutcomeUnknownCause =
  | "timeout"
  | "unreachable"
  | "too-large"
  /** gc answered 2xx (so it likely applied the change) but the body did not parse or decode. */
  | "unreadable-response"
  /** herdr's fetch followed a redirect away from the gc API's loopback origin. */
  | "redirected"
  | "outcome-poll-expired"
  | "reported-by-gc"
  /** gc reported an outcome state this pin does not know. */
  | "unrecognized-state";

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
  /** 401 "missing X-GC-City-Read grant" or 403 "read grant rejected": reads need signed grants. */
  | { kind: "read-grant-required"; status: 401 | 403; detail: string }
  /** 404 "not_found: city not found or not running: <name>". */
  | { kind: "city-not-running"; city: string; status?: string }
  /** 404/405 without a problem body: the route does not exist, so gc is too old. `raw` keeps a non-empty body. */
  | { kind: "api-missing"; operationId: string; gcVersion?: string; raw?: string }
  /** A body that does not match the pinned model. */
  | { kind: "decode"; operationId: string; path: string; issues: string[] }
  /** A 202 request that gc reports as failed. */
  | { kind: "outcome-failed"; requestId: string; operation: RequestOutcome["operation"]; payload: RequestFailedPayload }
  /** A mutation that may or may not have happened: refetch before allowing a retry. */
  | { kind: "outcome-unknown"; requestId: string | null; operationId: string; cause: OutcomeUnknownCause; issues?: string[] }
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
  if (!decoded.ok) return null;
  // Every RFC 9457 member is optional, so any object would decode; one that
  // carries none of them is some other JSON, not a problem.
  const p = decoded.value;
  const isProblem = [p.type, p.title, p.status, p.detail, p.code].some((v) => v !== undefined);
  return isProblem ? p : null;
}

function rawText(body: string): string {
  return body.trim().slice(0, RAW_LIMIT);
}

/** gc's problem codes this mapping keys on (internal/api/apierr/catalog.go). */
const CODE_CITY_NOT_FOUND = "city-not-found";
const CODE_SESSION_CONFLICT = "session-conflict";

/**
 * Maps a non-2xx answer of `operationId` to a GcError. gc's machine-readable
 * `code` wins where the problem has one; the 401/403 auth gates write no code,
 * so those key on their exact detail texts.
 */
export function httpError(operationId: string, status: number, body: string): GcError {
  const problem = parseProblem(body);
  const detail = problem?.detail ?? "";
  const code = problem?.code;

  if ((status === 404 || status === 405) && problem === null) {
    const raw = rawText(body);
    return raw === "" || !raw.startsWith("{") ? { kind: "api-missing", operationId } : { kind: "api-missing", operationId, raw };
  }
  if (status === 404 && (code === CODE_CITY_NOT_FOUND || (code === undefined && detail.startsWith(CITY_NOT_RUNNING_PREFIX)))) {
    return { kind: "city-not-running", city: detail.startsWith(CITY_NOT_RUNNING_PREFIX) ? detail.slice(CITY_NOT_RUNNING_PREFIX.length) : "" };
  }
  if (status === 401 && problem) {
    if (detail === "missing X-GC-City-Write grant") return { kind: "write-grant-required", status: 401, detail };
    if (detail === "missing X-GC-City-Read grant") return { kind: "read-grant-required", status: 401, detail };
  }
  if (status === 403 && problem) {
    if (detail.startsWith("csrf:")) return { kind: "csrf-rejected" };
    if (detail.startsWith("read_only:")) return { kind: "read-only", detail };
    if (detail === "write grant rejected" || detail.startsWith("workspace-service mutations are disabled")) {
      return { kind: "write-grant-required", status: 403, detail };
    }
    if (detail === "read grant rejected") return { kind: "read-grant-required", status: 403, detail };
  }
  if (problem) return { kind: "http", status, problem };
  return { kind: "http", status, problem: null, raw: rawText(body) };
}

/** A hint for a known problem: a 409 session conflict "pending_interaction: …" means a prompt waits for an answer. */
export function problemHint(error: GcError): "answer-pending-prompt" | null {
  if (error.kind !== "http" || error.status !== 409 || !error.problem) return null;
  const { code, detail } = error.problem;
  if (code !== undefined && code !== CODE_SESSION_CONFLICT) return null;
  return detail?.startsWith("pending_interaction:") ? "answer-pending-prompt" : null;
}

const OUTCOME_OP = "get-request-outcome";

/**
 * The failure a 202 request's outcome reports, or null while it is pending or
 * when it succeeded. A state this pin does not know is outcome-unknown: it is
 * never read as success.
 */
export function outcomeFailure(outcome: RequestOutcome): GcError | null {
  if (outcome.state === "outcome_unknown") {
    return { kind: "outcome-unknown", requestId: outcome.request_id, operationId: OUTCOME_OP, cause: "reported-by-gc" };
  }
  if (isUnrecognized(outcome.state)) {
    return {
      kind: "outcome-unknown", requestId: outcome.request_id, operationId: OUTCOME_OP, cause: "unrecognized-state",
      issues: [`state: ${outcome.state.raw}`],
    };
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
