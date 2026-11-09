// The decode policy on the generated schemas.

import { describe, expect, test } from "bun:test";
import { decodeListed, decodeValue, formatPath, isUnrecognized, unrecognizedIn } from "../../../src/gc/decode.ts";
import * as S from "../../../src/gc/schemas.gen.ts";

const SESSION = {
  id: "s-1", template: "worker", session_name: "s-s-1", title: "t", provider: "sh", state: "active",
  running: true, attached: false, created_at: "2026-11-09T00:00:00Z",
};
const OP = "get-v0-city-by-city-name-session-by-id";

describe("decodeValue", () => {
  test("unknown extra fields are ignored, not kept", () => {
    const r = decodeValue(S.SessionResponseSchema, { ...SESSION, brand_new_field: { x: 1 } }, OP);
    expect(r.ok).toBe(true);
    expect(r.ok && "brand_new_field" in r.value).toBe(false);
  });

  test("a missing required field is a decode error with its path", () => {
    const { running: _, ...rest } = SESSION;
    expect(decodeValue(S.SessionResponseSchema, rest, OP)).toEqual({
      ok: false, error: { kind: "decode", operationId: OP, path: "running", issues: ["running: missing required boolean"] },
    });
  });

  test("a wrong type deep inside is reported with the full path", () => {
    const r = decodeValue(S.SessionResponseSchema, { ...SESSION, program_status: { state: "idle", since: "t", working_children: "2" } }, OP);
    expect(r.ok ? null : r.error).toEqual({
      kind: "decode", operationId: OP, path: "program_status.working_children",
      issues: ["program_status.working_children: expected number, got string"],
    });
  });

  test("a non-object body is a root decode error", () => {
    expect(decodeValue(S.SessionResponseSchema, null, OP)).toEqual({
      ok: false, error: { kind: "decode", operationId: OP, path: "", issues: ["(root): expected object, got null"] },
    });
  });

  test("enum drift decodes to unrecognized instead of failing", () => {
    const r = decodeValue(S.SessionResponseSchema, {
      ...SESSION, activity_source: "program", program_status: { state: "napping", kind: "permission", since: "t", working_children: 0 },
    }, OP);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.activity_source).toBe("program");
    expect(r.value.program_status?.state).toEqual({ kind: "unrecognized", raw: "napping" });
    expect(isUnrecognized(r.value.program_status?.state)).toBe(true);
    expect(unrecognizedIn(r.value)).toEqual([{ path: "program_status.state", raw: "napping" }]);
  });

  test("an enum field of the wrong type is still an error", () => {
    const r = decodeValue(S.SessionResponseSchema, { ...SESSION, activity_source: 7 }, OP);
    expect(r.ok ? null : r.error).toMatchObject({ path: "activity_source", issues: ["activity_source: no accepted form matched number"] });
  });

  test("gc's [\"array\",\"null\"] decodes null and absent to []", () => {
    const r = decodeValue(S.ListBodyRigResponseSchema, { items: [], total: 0 }, "x");
    expect(r.ok && r.value.partial_errors).toEqual([]);
    const n = decodeValue(S.ListBodyRigResponseSchema, { items: null, total: 0, partial_errors: null }, "x");
    expect(n.ok && [n.value.items, n.value.partial_errors]).toEqual([[], []]);
  });

  test("wake_reasons keeps 'not requested' (absent) apart from 'none' (null or [])", () => {
    const absent = decodeValue(S.SessionResponseSchema, SESSION, OP);
    const none = decodeValue(S.SessionResponseSchema, { ...SESSION, wake_reasons: null }, OP);
    const some = decodeValue(S.SessionResponseSchema, { ...SESSION, wake_reasons: ["config"] }, OP);
    expect(absent.ok && "wake_reasons" in absent.value).toBe(false);
    expect(none.ok && none.value.wake_reasons).toEqual([]);
    expect(some.ok && some.value.wake_reasons).toEqual(["config"]);
  });

  test("issues are capped", () => {
    const r = decodeValue(S.ListBodyRigResponseSchema, { items: [], total: 0, partial_errors: Array.from({ length: 30 }, () => 1) }, "x");
    expect(r.ok ? [] : r.error.issues).toHaveLength(21);
  });
});

describe("decodeListed", () => {
  const OPL = "get-v0-city-by-city-name-sessions";

  test("one bad element is unreadable; the rest decode", () => {
    const r = decodeListed(S.ListBodySessionResponseSchema, S.SessionResponseSchema,
      { items: [SESSION, { id: "s-2" }, 7, { ...SESSION, id: "s-3" }], total: 4, partial: true, partial_errors: ["rig b: store down"] }, OPL);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.items.map((s) => s.id)).toEqual(["s-1", "s-3"]);
    expect(r.value.unreadable.map((u) => ({ index: u.index, id: u.id, path: u.error.path }))).toEqual([
      { index: 1, id: "s-2", path: "items[1].title" },
      { index: 2, id: null, path: "items[2]" },
    ]);
    expect(r.value.partial).toBe(true);
    expect(r.value.partial_errors).toEqual(["rig b: store down"]);
  });

  test("items: null is []", () => {
    const r = decodeListed(S.ListBodySessionResponseSchema, S.SessionResponseSchema, { items: null, total: 0 }, OPL);
    expect(r.ok && r.value.items).toEqual([]);
  });

  test("a broken envelope fails the whole list", () => {
    const r = decodeListed(S.ListBodySessionResponseSchema, S.SessionResponseSchema, { items: [] }, OPL);
    expect(r.ok ? null : r.error).toMatchObject({ kind: "decode", path: "total" });
  });

  test("an item named by `name` (cities, rigs, agents) keeps that as its id", () => {
    const r = decodeListed(S.SupervisorCitiesOutputBodySchema, S.CityInfoSchema, { items: [{ name: "c1" }], total: 1 }, "get-v0-cities");
    expect(r.ok && r.value.unreadable[0]?.id).toBe("c1");
  });
});

test("formatPath", () => {
  expect(formatPath([])).toBe("");
  expect(formatPath(["items", 3, "program_status", "state"])).toBe("items[3].program_status.state");
  expect(formatPath([0, "a"])).toBe("[0].a");
});
