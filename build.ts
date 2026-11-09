// Builds the readable, committed mod bundle gascity/main.js from src/.
//
// The output is deterministic: the same inputs give the same bytes, so CI can
// require the committed bundle to equal a clean rebuild (scripts/bundle-fresh.ts).
// The header names the package version and a sha256 digest of the git-tracked
// build inputs. It cannot name the git commit: the bundle is part of that commit.

import { build, type BuildOptions } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ROOT = import.meta.dir;
export const ENTRY = "src/main.ts";
export const BUNDLE_FILE = "gascity/main.js";
/** Modules herdr-app's QuickJS host provides; never bundled. */
export const HOST_MODULES = ["herdr", "gpui-kit", "gpui-base"] as const;
/** Everything that can change the bundle's bytes (esbuild reads tsconfig.json too). */
export const INPUT_PATHSPECS = ["src", "build.ts", "package.json", "bun.lock", "tsconfig.json"] as const;

/** sha256 over (path, content) pairs, independent of their order. */
export function digestOf(entries: readonly (readonly [string, string])[]): string {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * The git-tracked build inputs under `root`, sorted. Only tracked files count,
 * so a stray untracked file cannot change the committed header; a new source
 * file must be `git add`ed before `bun run build`.
 */
export async function inputPaths(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z", "--", ...INPUT_PATHSPECS], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ls-files in ${root} failed (exit ${code}): ${err.trim()}`);
  return out.split("\0").filter(Boolean).sort();
}

async function inputEntries(root: string): Promise<[string, string][]> {
  const paths = await inputPaths(root);
  return Promise.all(paths.map(async (p): Promise<[string, string]> => [p, await readFile(join(root, p), "utf8")]));
}

function header(version: string, digest: string): string {
  return [
    `// herdr-gascity ${version} - the Gas City mod for herdr-app. Built file: do not edit.`,
    "// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file",
    `// byte for byte; source digest sha256:${digest} over the git-tracked src/, build.ts, package.json, bun.lock and tsconfig.json.`,
  ].join("\n");
}

/**
 * The esbuild options of the mod bundle: one readable ES module for herdr's
 * QuickJS engine. Shared with the engine-parity probe (test/engine), so that
 * probe runs code bundled exactly like the mod.
 */
export const BUNDLE_OPTIONS = {
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
} as const satisfies BuildOptions;

/** Builds the bundle in memory and returns its text. */
export async function buildBundle(root: string = ROOT): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  const result = await build({
    ...BUNDLE_OPTIONS,
    external: [...HOST_MODULES],
    mainFields: [...BUNDLE_OPTIONS.mainFields],
    absWorkingDir: root,
    entryPoints: [ENTRY],
    outfile: BUNDLE_FILE,
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
