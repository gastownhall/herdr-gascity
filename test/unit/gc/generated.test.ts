// src/gc/*.gen.ts must be exactly what scripts/gen-gc.ts makes from the
// committed pin and used surface, and the generator must refuse a used surface
// that drifts from the pin.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OUTPUTS, generate, generateFromRepo } from "../../../scripts/gen-gc.ts";
import { PINNED_SPEC, ROOT, USED_SURFACE, readJson, type Spec, type UsedSurface } from "../../../scripts/gc-spec.ts";

const spec = await readJson<Spec>(ROOT, PINNED_SPEC);
const used = await readJson<UsedSurface>(ROOT, USED_SURFACE);

test("the committed generated files are fresh", async () => {
  const files = await generateFromRepo();
  for (const [key, path] of Object.entries(OUTPUTS) as [keyof typeof OUTPUTS, string][]) {
    expect([path, await readFile(join(ROOT, path), "utf8")]).toEqual([path, files[key]]);
  }
});

describe("the generator refuses drift between the used surface and the pin", () => {
  const withModels = (models: UsedSurface["models"]): UsedSurface => ({ ...used, models });

  test("a listed field the pin does not have", () => {
    const models = { ...used.models, Bead: { fields: [...used.models["Bead"]!.fields, "closed_at"] } };
    expect(() => generate(spec, withModels(models))).toThrow("Bead.closed_at is listed in api/used-surface.json but not in the pin");
  });

  test("a model reached from a used operation but not listed", () => {
    const { PoolLimits: _, ...models } = used.models;
    expect(() => generate(spec, withModels(models))).toThrow("PoolLimits is reached from a used operation but not listed");
  });

  test("a listed model no used operation reaches", () => {
    const models = { ...used.models, Dep: { fields: ["type"] } };
    expect(() => generate(spec, withModels(models))).toThrow("reached by no used operation: Dep");
  });

  test("an operation the pin does not have", () => {
    expect(() => generate(spec, { ...used, operations: { ...used.operations, "get-v0-nope": "x" } })).toThrow("operation get-v0-nope is not in the pin");
  });

  test("keepAbsent on a field that is not an optional nullable list", () => {
    const models = { ...used.models, Bead: { ...used.models["Bead"]!, keepAbsent: ["title"] } };
    expect(() => generate(spec, withModels(models))).toThrow('Bead.title: keepAbsent applies only to optional ["array","null"] fields');
  });
});
