// Builds the readable, committed mod bundle gascity/main.js from src/.
//
// The output is deterministic: the same inputs give the same bytes, so CI can
// require the committed bundle to equal a clean rebuild (scripts/bundle-fresh.ts).
// The header names the package version and a sha256 digest of every build
// input. It cannot name the git commit: the bundle is part of that commit.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ROOT = import.meta.dir;
export const ENTRY = "src/main.ts";
export const BUNDLE_FILE = "gascity/main.js";
/** Modules herdr-app's QuickJS host provides; never bundled. */
export const HOST_MODULES = ["herdr", "gpui-kit", "gpui-base"] as const;
/** Everything that can change the bundle's bytes. */
const INPUT_GLOBS = ["src/**/*", "build.ts", "package.json", "bun.lock"] as const;

/** sha256 over (path, content) pairs, independent of their order. */
export function digestOf(entries: readonly (readonly [string, string])[]): string {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

async function inputEntries(root: string): Promise<[string, string][]> {
  const paths = new Set<string>();
  for (const pattern of INPUT_GLOBS) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) paths.add(path);
  }
  return Promise.all([...paths].map(async (p): Promise<[string, string]> => [p, await readFile(join(root, p), "utf8")]));
}

function header(version: string, digest: string): string {
  return [
    `// herdr-gascity ${version} - the Gas City mod for herdr-app. Built file: do not edit.`,
    "// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file",
    `// byte for byte; source digest sha256:${digest} over src/, build.ts, package.json and bun.lock.`,
  ].join("\n");
}

/** Builds the bundle in memory and returns its text. */
export async function buildBundle(root: string = ROOT): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  const result = await build({
    absWorkingDir: root,
    entryPoints: [ENTRY],
    outfile: BUNDLE_FILE,
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2022",
    external: [...HOST_MODULES],
    minify: false,
    sourcemap: false,
    legalComments: "eof",
    charset: "utf8",
    logLevel: "silent",
    banner: { js: header(pkg.version, digestOf(await inputEntries(root))) },
  });
  const [file, ...rest] = result.outputFiles;
  if (!file || rest.length > 0) throw new Error(`esbuild produced ${result.outputFiles.length} files; expected one`);
  return file.text;
}

if (import.meta.main) {
  const out = join(ROOT, BUNDLE_FILE);
  await writeFile(out, await buildBundle(ROOT));
  console.log(`wrote ${BUNDLE_FILE}`);
}
