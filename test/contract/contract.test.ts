// Recorded-API contract test (design §13.2). Every fixture under
// test/contract/fixtures/<operationId>/ was recorded from a scratch city at the
// pinned gc commit (test/contract/record.ts). Each one must
//   (a) validate against the pinned OpenAPI schema with ajv (OpenAPI 3.1 =
//       JSON Schema 2020-12), and
//   (b) decode through the mod's client to the expected result,
// so the decoders cannot silently diverge from the spec. Malformed variants of
// the recorded bodies must be rejected with the right GcError.

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGcClient, type HostFetch } from "../../src/gc/client.ts";
import { unrecognizedIn } from "../../src/gc/decode.ts";
import { outcomeFailure, type GcError } from "../../src/gc/errors.ts";
import { OPERATIONS, type OperationId } from "../../src/gc/operations.gen.ts";
import type { RequestOutcome } from "../../src/gc/types.gen.ts";
import {
  PINNED_SPEC, PIN_FILE, ROOT, USED_SURFACE, operationsById, parsePin, readJson, refName, successResponse,
  type Spec, type UsedSurface,
} from "../../scripts/gc-spec.ts";
import { formatSpec, pruneSpec } from "../../scripts/pin-gc-spec.ts";
import { FIXTURES, type Fixture } from "./record.ts";

const spec = await readJson<Spec>(ROOT, PINNED_SPEC);
const used = await readJson<UsedSurface>(ROOT, USED_SURFACE);
const byId = operationsById(spec);
const usedIds = Object.keys(used.operations) as OperationId[];

interface Loaded {
  op: OperationId;
  name: string;
  fixture: Fixture;
}

const loaded: Loaded[] = [];
for (const op of (await readdir(FIXTURES)).sort()) {
  for (const file of (await readdir(join(FIXTURES, op))).sort()) {
    const fixture = JSON.parse(await readFile(join(FIXTURES, op, file), "utf8")) as Fixture;
    loaded.push({ op: op as OperationId, name: file.replace(/\.json$/, ""), fixture });
  }
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
for (const f of ["int32", "int64"]) ajv.addFormat(f, { type: "number", validate: (n: number) => Number.isInteger(n) });
for (const f of ["float", "double"]) ajv.addFormat(f, { type: "number", validate: () => true });
ajv.addSchema(spec as object, "pinned");

/** The pinned schema for a fixture's status: the success model or the declared error body. */
function schemaFor(op: OperationId, status: number): string {
  const located = byId.get(op)!;
  const success = successResponse(located.op);
  if (status === success.status) return refName(success.schema.$ref!);
  const declared = located.op.responses[String(status)] ?? located.op.responses["default"];
  const content = declared?.content ?? {};
  const schema = (content["application/problem+json"] ?? content["application/json"])?.schema;
  if (!schema?.$ref) throw new Error(`${op}: status ${status} is not declared in the pin`);
  return refName(schema.$ref);
}

function validate(op: OperationId, f: Fixture): string[] {
  const check = ajv.getSchema(`pinned#/components/schemas/${schemaFor(op, f.status)}`);
  if (!check) throw new Error(`no schema for ${op} ${f.status}`);
  return check(f.body) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** Plays one recorded response through the real client. */
async function play(op: OperationId, status: number, body: unknown) {
  const fetch: HostFetch = (url) =>
    Promise.resolve({ status, ok: status >= 200 && status < 300, url, text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)) });
  const made = createGcClient({ baseUrl: "http://127.0.0.1:8372", fetch });
  if (!made.ok) throw new Error("client");
  const meta = OPERATIONS[op];
  const path = Object.fromEntries(meta.pathParams.map((p) => [p, p === "action" ? "suspend" : "x"]));
  // The call's arguments do not matter here: the fake fetch answers with the fixture.
  return made.value.call(op, { path, query: {}, body: meta.body ? {} : undefined, idempotencyKey: "k" } as never);
}

/**
 * Fixtures gc cannot produce in a scratch city, written by hand from gc's
 * handler source at the pin. They are validated against the pin like the
 * recorded ones; any other fixture must be recorded.
 */
const SYNTHESIZED = ["respond-session/accepted"];

/** What each recorded error fixture must decode to. */
const EXPECTED_ERRORS: Record<string, (e: GcError) => void> = {
  "city-not-running": (e) => expect(e).toMatchObject({ kind: "city-not-running" }),
  "not-found": (e) => expect(e).toMatchObject({ kind: "http", status: 404, problem: { status: 404 } }),
  "csrf-missing": (e) => expect(e).toEqual({ kind: "csrf-rejected" }),
  "validation-failed": (e) => expect(e).toMatchObject({ kind: "http", status: 422, problem: { code: "validation-failed" } }),
  "no-pending": (e) => expect(e).toMatchObject({ kind: "http", status: 501, problem: { code: "not-implemented" } }),
  "closed-session-conflict": (e) => expect(e).toMatchObject({ kind: "http", status: 409, problem: { code: "session-conflict" } }),
};

describe("pin", () => {
  test("api/PIN names a gascity commit and the upstream file", async () => {
    const pin = parsePin(await readFile(join(ROOT, PIN_FILE), "utf8"));
    expect(pin.repo).toBe("gastownhall/gascity");
    expect(pin.path).toBe("internal/api/openapi.json");
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(pin.committed))).toBe(false);
  });

  test("the pinned spec holds exactly the used operations and the components they reach", () => {
    expect([...byId.keys()].sort()).toEqual([...usedIds].sort());
    expect(formatSpec(pruneSpec(spec, used))).toBe(formatSpec(spec));
  });

  test("generated metadata matches the pin: X-GC-Request on every mutation, Idempotency-Key exactly where declared", () => {
    for (const id of usedIds) {
      const { method, path, op } = byId.get(id)!;
      const headers = (op.parameters ?? []).filter((p) => p.in === "header");
      const meta: { method: string; path: string; csrf: boolean; idempotencyKey: boolean; success: number } = OPERATIONS[id];
      expect([id, meta.method, meta.path]).toEqual([id, method.toUpperCase(), path]);
      expect([id, meta.csrf]).toEqual([id, headers.some((h) => h.name === "X-GC-Request" && h.required === true)]);
      expect([id, meta.csrf]).toEqual([id, meta.method !== "GET"]);
      expect([id, meta.idempotencyKey]).toEqual([id, headers.some((h) => h.name === "Idempotency-Key")]);
      expect([id, meta.success]).toEqual([id, successResponse(op).status]);
    }
  });

  test("gc declares Idempotency-Key on the operations design §7.3 lists, and not on the others", () => {
    const declaring = usedIds.filter((id) => OPERATIONS[id].idempotencyKey).sort();
    expect(declaring).toEqual([
      "create-bead", "create-session",
      "post-v0-city-by-city-name-session-by-id-close", "post-v0-city-by-city-name-session-by-id-kill",
      "post-v0-city-by-city-name-session-by-id-stop", "post-v0-city-by-city-name-session-by-id-suspend",
      "post-v0-city-by-city-name-session-by-id-wake",
      "respond-session", "send-session-message", "submit-session",
    ]);
  });
});

describe("fixtures", () => {
  test("every used operation has a recorded success fixture, and every fixture is a used operation", () => {
    const dirs = new Set(loaded.map((l) => l.op));
    expect([...dirs].sort()).toEqual([...usedIds].sort());
    for (const id of usedIds) {
      expect([id, loaded.some((l) => l.op === id && l.fixture.status === OPERATIONS[id].success)]).toEqual([id, true]);
    }
  });

  test("only the listed fixtures are synthesized, and each says why", () => {
    const synthesized = loaded.filter((l) => l.fixture.provenance !== undefined);
    expect(synthesized.map((l) => `${l.op}/${l.name}`)).toEqual(SYNTHESIZED);
    for (const l of synthesized) expect(l.fixture.provenance).toMatch(/^synthesized: .{20,}/);
  });

  for (const { op, name, fixture } of loaded) {
    describe(`${op}/${name} (${fixture.status})`, () => {
      test("validates against the pinned spec (ajv)", () => {
        expect(validate(op, fixture)).toEqual([]);
      });

      test("decodes through the client", async () => {
        const r = await play(op, fixture.status, fixture.body);
        if (fixture.status === OPERATIONS[op].success) {
          if (!r.ok) throw new Error(JSON.stringify(r.error));
          const value = r.value as { unreadable?: unknown[] };
          if (OPERATIONS[op].item) expect(value.unreadable).toEqual([]);
          expect(unrecognizedIn(r.value)).toEqual([]);
          if (op === "get-request-outcome") {
            const failure = outcomeFailure(r.value as RequestOutcome);
            if (name === "session-create-failed") expect(failure).toMatchObject({ kind: "outcome-failed", operation: "session.create" });
            else expect(failure).toBeNull();
          }
        } else {
          const expectation = EXPECTED_ERRORS[name];
          if (!expectation) throw new Error(`no expected GcError for error fixture ${op}/${name}`);
          if (r.ok) throw new Error("an error fixture decoded as success");
          expectation(r.error);
        }
      });
    });
  }
});

describe("malformed variants of the recorded bodies are rejected", () => {
  const successes = loaded.filter((l) => l.fixture.status === OPERATIONS[l.op].success);

  /** The first required field of the response model that this mod reads. */
  function requiredField(op: OperationId): string | undefined {
    const model = spec.components.schemas[schemaFor(op, OPERATIONS[op].success)]!;
    const fields = used.models[schemaFor(op, OPERATIONS[op].success)]!.fields;
    return (model.required ?? []).find((f) => fields.includes(f));
  }

  for (const { op, name, fixture } of successes) {
    const field = requiredField(op);
    if (!field) continue;
    test(`${op}/${name}: missing "${field}" -> decode error at that path`, async () => {
      const body = { ...(fixture.body as Record<string, unknown>) };
      delete body[field];
      const r = await play(op, fixture.status, body);
      expect(r.ok ? null : r.error).toMatchObject({ kind: "decode", operationId: op, path: field });
    });

    test(`${op}/${name}: "${field}" of the wrong type -> decode error at that path`, async () => {
      const body = { ...(fixture.body as Record<string, unknown>), [field]: { wrong: true } };
      const r = await play(op, fixture.status, body);
      expect(r.ok ? null : r.error).toMatchObject({ kind: "decode", operationId: op, path: field });
    });

    const items = (fixture.body as { items?: unknown }).items;
    if (OPERATIONS[op].item && Array.isArray(items) && items.length > 0) {
      test(`${op}/${name}: a corrupted element is unreadable, the others still decode`, async () => {
        const body = { ...(fixture.body as Record<string, unknown>), items: [...items, 42] };
        const r = await play(op, fixture.status, body);
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        const value = r.value as { items: unknown[]; unreadable: { index: number }[] };
        expect(value.items).toHaveLength(items.length);
        expect(value.unreadable.map((u) => u.index)).toEqual([items.length]);
      });
    }
  }

  test("a list op with no recorded elements is still covered by at least one list fixture with elements", () => {
    const withItems = successes.filter((l) => OPERATIONS[l.op].item && ((l.fixture.body as { items?: unknown[] }).items?.length ?? 0) > 0);
    expect(withItems.length).toBeGreaterThan(0);
  });
});
