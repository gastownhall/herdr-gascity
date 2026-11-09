// `gc supervisor status --json` names the API URL only once gc reports it
// (gc does not today): the field is feature-detected, so its absence means
// "this gc does not say", not an error.

import { describe, expect, test } from "bun:test";
import { GC_STATUS_ARGS, parseGcStatus } from "../../../src/discovery/gcStatus.ts";

describe("parseGcStatus", () => {
  test("the exact argv shape the runtime exec allowlist permits", () => {
    expect(GC_STATUS_ARGS).toEqual(["supervisor", "status", "--json"]);
  });

  test("api_url present: the reported URL", () => {
    expect(parseGcStatus('{"running":true,"pid":12,"api_url":"http://127.0.0.1:8372"}\n')).toEqual({
      ok: true, value: "http://127.0.0.1:8372",
    });
  });

  test("api_url absent (today's gc): null, not an error", () => {
    expect(parseGcStatus('{"running":true,"pid":12}')).toEqual({ ok: true, value: null });
    expect(parseGcStatus('{"running":false}')).toEqual({ ok: true, value: null });
  });

  test("output that is not a JSON object, or an api_url that is not a non-empty string, is a decode error", () => {
    for (const [stdout, path] of [
      ["", ""], ["not json", ""], ["[1]", ""], ["null", ""], ['{"api_url":8372}', "api_url"], ['{"api_url":""}', "api_url"],
    ] as const) {
      const r = parseGcStatus(stdout);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatchObject({ kind: "decode", operationId: "gc supervisor status --json", path });
    }
  });
});
