import { expect, test } from "bun:test";
import pkg from "../../package.json";
import { MOD_VERSION } from "../../src/version.ts";

test("MOD_VERSION is package.json's version", () => {
  expect(MOD_VERSION).toBe(pkg.version);
});
