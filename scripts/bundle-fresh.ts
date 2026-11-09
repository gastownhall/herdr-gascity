// Fails when the committed bundle is not exactly what the source builds to.
// Usage: bun run scripts/bundle-fresh.ts [--bundle <path>]

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BUNDLE_FILE, ROOT, buildBundle } from "../build.ts";

export type Freshness = { fresh: true } | { fresh: false; reason: string };

/** Compares the bundle at `path` with the expected build output. */
export async function checkBundle(path: string, expected: string): Promise<Freshness> {
  let actual: string;
  try {
    actual = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { fresh: false, reason: `${path} is missing` };
    throw err;
  }
  if (actual === expected) return { fresh: true };
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.min(a.length, e.length); i++) {
    if (a[i] !== e[i]) return { fresh: false, reason: `${path} differs from a clean rebuild at line ${i + 1}` };
  }
  return {
    fresh: false,
    reason: `${path} differs from a clean rebuild in length (${actual.length} vs ${expected.length} characters)`,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--bundle");
  const path = flag >= 0 && args[flag + 1] ? resolve(args[flag + 1]!) : resolve(ROOT, BUNDLE_FILE);
  const result = await checkBundle(path, await buildBundle(ROOT));
  if (!result.fresh) {
    console.error(`${result.reason}\nRun \`bun run build\` and commit ${BUNDLE_FILE}.`);
    process.exit(1);
  }
  console.log(`${BUNDLE_FILE} matches a clean rebuild`);
}
