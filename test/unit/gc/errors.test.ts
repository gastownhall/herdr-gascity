// Problem+json and status -> GcError (design §5.3), table-tested against the
// exact bodies gc writes at the pin (internal/api/writeauth.go problem
// bodies, huma_handlers_supervisor.go CSRF/read-only guards, city_scope.go).

import { describe, expect, test } from "bun:test";
import { httpError, outcomeFailure, problemHint, type GcError } from "../../../src/gc/errors.ts";
import type { RequestOutcome } from "../../../src/gc/types.gen.ts";

const OP = "post-v0-city-by-city-name-session-by-id-wake";
const map = (status: number, body: unknown) =>
  httpError(OP, status, typeof body === "string" ? body : JSON.stringify(body));

// A decoded problem always has `errors` (gc's ["array","null"] decodes absent to []).

describe("401/403: write auth, CSRF and read-only (exact gc bodies)", () => {
  const cases: [string, number, unknown, GcError][] = [
    ["missing write grant", 401, { status: 401, title: "Unauthorized", detail: "missing X-GC-City-Write grant" },
      { kind: "write-grant-required", status: 401, detail: "missing X-GC-City-Write grant" }],
    ["write grant rejected", 403, { status: 403, title: "Forbidden", detail: "write grant rejected" },
      { kind: "write-grant-required", status: 403, detail: "write grant rejected" }],
    ["workspace-service gate", 403,
      { status: 403, title: "Forbidden", detail: "workspace-service mutations are disabled on a write-auth-hardened city" },
      { kind: "write-grant-required", status: 403, detail: "workspace-service mutations are disabled on a write-auth-hardened city" }],
    ["csrf", 403, { status: 403, title: "Forbidden", detail: "csrf: X-GC-Request header required on mutation endpoints" },
      { kind: "csrf-rejected" }],
    ["read-only bind", 403,
      { status: 403, title: "Forbidden", detail: "read_only: mutations disabled: server bound to non-localhost address" },
      { kind: "read-only", detail: "read_only: mutations disabled: server bound to non-localhost address" }],
  ];
  for (const [name, status, body, want] of cases) {
    test(name, () => expect(map(status, body)).toEqual(want));
  }

  test("a 401 without a problem body is still write-grant-required, with the raw text", () => {
    expect(map(401, "unauthorized\n")).toEqual({ kind: "write-grant-required", status: 401, detail: "unauthorized" });
  });

  test("any other 403 stays http with the problem verbatim", () => {
    const problem = { status: 403, title: "Forbidden", detail: "something else" };
    expect(map(403, problem)).toEqual({ kind: "http", status: 403, problem: { ...problem, errors: [] } });
  });
});

describe("404/405", () => {
  test("city not running (gc's stable 404 detail) -> city-not-running with the name", () => {
    const body = {
      type: "urn:gascity:error:city-not-found", title: "City Not Found", status: 404,
      detail: "not_found: city not found or not running: my-city", code: "city-not-found",
    };
    expect(map(404, body)).toEqual({ kind: "city-not-running", city: "my-city" });
  });

  test("a plain-text 404/405 (the route does not exist: gc too old) -> api-missing", () => {
    expect(map(404, "404 page not found\n")).toEqual({ kind: "api-missing", operationId: OP });
    expect(map(405, "Method Not Allowed\n")).toEqual({ kind: "api-missing", operationId: OP });
  });

  test("a problem 404 for a missing resource stays http", () => {
    const problem = { type: "urn:gascity:error:session-not-found", title: "Session Not Found", status: 404, detail: "not_found: session not found: \"x\"", code: "session-not-found" };
    expect(map(404, problem)).toEqual({ kind: "http", status: 404, problem: { ...problem, errors: [] } });
  });
});

describe("409, 422, 5xx", () => {
  test("409 session-conflict keeps the problem; pending_interaction gets a hint", () => {
    const problem = { type: "urn:gascity:error:session-conflict", title: "Session State Conflict", status: 409, detail: "pending_interaction: session s-1 is waiting for an answer", code: "session-conflict" };
    const e = map(409, problem);
    expect(e).toEqual({ kind: "http", status: 409, problem: { ...problem, errors: [] } });
    expect(problemHint(e)).toBe("answer-pending-prompt");
    expect(problemHint(map(409, { ...problem, detail: "session sc-60 is closed" }))).toBeNull();
    expect(problemHint({ kind: "csrf-rejected" })).toBeNull();
  });

  test("422 keeps the validation details", () => {
    const problem = {
      type: "urn:gascity:error:validation-failed", title: "Validation Failed", status: 422, detail: "validation failed",
      errors: [{ message: "expected required property title to be present", location: "body", value: { description: "x" } }],
      code: "validation-failed",
    };
    expect(map(422, problem)).toEqual({ kind: "http", status: 422, problem });
  });

  test("a problem body with errors: null decodes errors to []", () => {
    expect(map(500, { status: 500, title: "Internal Server Error", errors: null }))
      .toEqual({ kind: "http", status: 500, problem: { status: 500, title: "Internal Server Error", errors: [] } });
  });

  test("5xx without a problem body keeps the raw text, trimmed and capped", () => {
    expect(map(502, "Bad Gateway\n")).toEqual({ kind: "http", status: 502, problem: null, raw: "Bad Gateway" });
    const huge = map(503, "x".repeat(10_000));
    expect(huge.kind === "http" && huge.raw?.length).toBe(2000);
  });

  test("JSON that is not a problem (wrong field types) is raw, not a problem", () => {
    expect(map(500, { status: "boom" })).toEqual({ kind: "http", status: 500, problem: null, raw: '{"status":"boom"}' });
  });
});

describe("202 outcomes", () => {
  const failed: RequestOutcome = {
    request_id: "req-1",
    operation: "session.create",
    state: "failed",
    event: {
      seq: 222, type: "request.failed", ts: "2026-11-09T06:24:24Z", actor: "api",
      payload: { request_id: "req-1", operation: "session.create", error_code: "create_failed", error_message: "session alias already exists" },
    },
  };

  test("failed + request.failed -> outcome-failed with the typed payload", () => {
    expect(outcomeFailure(failed)).toEqual({
      kind: "outcome-failed",
      requestId: "req-1",
      operation: "session.create",
      payload: { request_id: "req-1", operation: "session.create", error_code: "create_failed", error_message: "session alias already exists" },
    });
  });

  test("a request.failed payload that does not decode is a decode error, not swallowed", () => {
    const bad = { ...failed, event: { ...failed.event!, payload: { request_id: "req-1" } } };
    const e = outcomeFailure(bad);
    expect(e?.kind).toBe("decode");
    expect(e?.kind === "decode" && e.path).toBe("event.payload.operation");
  });

  test("failed without a request.failed event is still a failure (decode error on the event)", () => {
    const e = outcomeFailure({ ...failed, event: undefined });
    expect(e).toEqual({ kind: "decode", operationId: "get-request-outcome", path: "event", issues: ["event: a failed outcome must carry a request.failed event"] });
  });

  test("outcome_unknown reported by gc -> outcome-unknown", () => {
    expect(outcomeFailure({ request_id: "req-2", operation: "session.submit", state: "outcome_unknown" }))
      .toEqual({ kind: "outcome-unknown", requestId: "req-2", operationId: "get-request-outcome", cause: "reported-by-gc" });
  });

  test("pending and succeeded are not failures", () => {
    expect(outcomeFailure({ request_id: "r", operation: "session.submit", state: "pending" })).toBeNull();
    expect(outcomeFailure({ request_id: "r", operation: "session.submit", state: "succeeded" })).toBeNull();
  });

  test("an unrecognized state is not treated as success or failure", () => {
    expect(outcomeFailure({ request_id: "r", operation: "session.submit", state: { kind: "unrecognized", raw: "parked" } })).toBeNull();
  });
});
