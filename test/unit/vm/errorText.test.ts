import { describe, expect, test } from "bun:test";
import { errorText } from "../../../src/vm/errorText.ts";

describe("errorText", () => {
  test("outcome-unknown names what gc's answer said, when there are issues", () => {
    expect(errorText({ kind: "outcome-unknown", requestId: null, operationId: "submit-session", cause: "unreadable-response", issues: ["id: expected string", "status: missing"] }))
      .toBe("outcome of submit-session unknown (unreadable-response): id: expected string; status: missing");
    expect(errorText({ kind: "outcome-unknown", requestId: "r-1", operationId: "create-session", cause: "outcome-poll-expired" }))
      .toBe("outcome of create-session unknown (outcome-poll-expired, request r-1)");
  });

  test("api-missing shows the body gc answered with, when it kept one", () => {
    expect(errorText({ kind: "api-missing", operationId: "get-v0-cities" })).toBe("gc too old (needs get-v0-cities)");
    expect(errorText({ kind: "api-missing", operationId: "get-v0-cities", raw: '{"message":"no such route"}' }))
      .toBe('gc too old (needs get-v0-cities): {"message":"no such route"}');
  });

  test("a request cancelled because the copy that started it closed is not a timeout", () => {
    expect(errorText({ kind: "cancelled", url: "http://127.0.0.1:8372/v0/cities", reason: "copy-closed" }))
      .toBe("request to http://127.0.0.1:8372/v0/cities was cancelled: the Gas City view that started it closed");
    expect(errorText({ kind: "cancelled", url: "http://127.0.0.1:8372/health", reason: "abandoned" }))
      .toBe("request to http://127.0.0.1:8372/health was dropped before it was sent: nothing waits for its answer any more");
  });

  test("gc-supplied text is shown without control characters or escapes", () => {
    expect(errorText({ kind: "http", status: 409, problem: { detail: "pending_interaction:\u001b[31m approve\u0007 first\nplease", errors: [] } }))
      .toBe("gc answered 409: pending_interaction: approve first please");
    expect(errorText({ kind: "exec", argv: ["gc", "supervisor", "status", "--json"], code: 2, stderr: "bad\u0000 flag\r\n\u009b2J" }))
      .toBe("gc supervisor status --json exited with code 2: bad flag ");
    expect(errorText({ kind: "city-not-running", city: "evil\u202ename" })).toBe('city "evilname" is not running');
    expect(errorText({ kind: "decode", operationId: "get-health", path: "items[0]", issues: ["x\u0007: bad"] }))
      .toBe("unreadable answer to get-health at items[0]: x: bad");
  });

  test("a demand-only singleton gc will not start on request says how to start it", () => {
    const detail = 'agent "frontend/builder" is a pool agent with max_active_sessions = 1 and no [[named_session]]: the controller starts its one session only while there is work for it and drains it when there is none; sling work to "frontend/builder" to start it, or declare a [[named_session]] for it to keep a session running';
    expect(errorText({ kind: "http", status: 400, problem: { code: "demand-only-singleton", title: "Demand-Only Singleton Agent", detail, errors: [] } }))
      .toBe(`gc starts this agent's one session only while it has work: sling a bead to it instead (gc: ${detail})`);
    // Without a detail, still the hint.
    expect(errorText({ kind: "http", status: 400, problem: { code: "demand-only-singleton", errors: [] } }))
      .toBe("gc starts this agent's one session only while it has work: sling a bead to it instead");
  });
});
