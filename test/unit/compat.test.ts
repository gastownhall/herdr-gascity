// compat.json: the herdr-app and gc versions this build of the mod supports.
// It must agree with what the build is pinned to (api/PIN) and with what
// RECIPE.md tells a person.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

interface Compat {
  schema: string;
  herdrApp: { minimum: string; tested: string[] };
  gc: { repo: string; minimumCommit: string; minimumCommitDate: string; minimumRelease: string | null };
}

const read = async (path: string) => readFile(join(ROOT, path), "utf8");
const compat = async () => JSON.parse(await read("compat.json")) as Compat;
const pin = async () => Object.fromEntries((await read("api/PIN")).trim().split("\n").map((l) => l.split("=") as [string, string]));
const cmp = (a: string, b: string) => {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
};

describe("compat.json", () => {
  test("has exactly the documented fields", async () => {
    const c = await compat();
    expect(c.schema).toBe("herdr-gascity-compat/1");
    expect(Object.keys(c).sort()).toEqual(["gc", "herdrApp", "schema"]);
    expect(Object.keys(c.herdrApp).sort()).toEqual(["minimum", "tested"]);
    expect(Object.keys(c.gc).sort()).toEqual(["minimumCommit", "minimumCommitDate", "minimumRelease", "repo"]);
  });

  test("herdr-app: the minimum is a tested version, and every version is a release version", async () => {
    const { herdrApp } = await compat();
    for (const v of [herdrApp.minimum, ...herdrApp.tested]) expect(v).toMatch(SEMVER);
    expect(herdrApp.tested).toContain(herdrApp.minimum);
    for (const v of herdrApp.tested) expect(cmp(v, herdrApp.minimum)).toBeGreaterThanOrEqual(0);
  });

  test("gc: the minimum is the commit the API types are pinned to", async () => {
    const { gc } = await compat();
    const p = await pin();
    expect(gc.repo).toBe(p["repo"]!);
    expect(gc.minimumCommit).toBe(p["commit"]!);
    expect(gc.minimumCommitDate).toBe(p["committed"]!);
    if (gc.minimumRelease !== null) expect(gc.minimumRelease).toMatch(/^v[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  test("RECIPE.md states the same versions", async () => {
    const { herdrApp, gc } = await compat();
    const recipe = await read("gascity/RECIPE.md");
    expect(recipe).toContain(`herdr-app ${herdrApp.minimum} or newer`);
    expect(recipe).toContain(gc.minimumCommit.slice(0, 10));
    if (gc.minimumRelease !== null) expect(recipe).toContain(`gc ${gc.minimumRelease}`);
  });
});
