// Packages a release of the mod: the tarball install.sh installs, its sha256
// file, and install.sh stamped with the version and that sha256.
//
//   bun run package [--out <dir>]      (default: dist/)
//
// writes <dir>/gascity-mod-<version>.tar.gz, <dir>/gascity-mod-<version>.tar.gz.sha256
// (`sha256sum -c` format) and <dir>/install.sh. The tarball holds the
// git-tracked files of gascity/ (the mod folder, with RECIPE.md and
// preview.png), LICENSE and compat.json. It is reproducible: entries sorted
// by name, owner 0:0, fixed modes, every mtime the commit's time (or
// SOURCE_DATE_EPOCH), gzip without a name or time stamp; it needs GNU tar.

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** What goes into the tarball (tracked files only). */
export const PACKAGE_PATHSPECS = ["gascity", "LICENSE", "compat.json"] as const;
/** The files the tarball must hold for install.sh to install it. */
export const REQUIRED_FILES = ["gascity/main.js", "gascity/mod.json", "LICENSE", "compat.json"] as const;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION_LINE = "release_version=''";
const SHA256_LINE = "release_sha256=''";

/** The tarball's file name for a version. */
export const tarballName = (version: string) => `gascity-mod-${version}.tar.gz`;

/**
 * install.sh as a release attaches it: the source copy's empty
 * `release_version=''` and `release_sha256=''` lines filled in, so the
 * script downloads that release's tarball and refuses any other bytes.
 */
export function stampInstaller(text: string, version: string, sha256: string): string {
  if (!SEMVER.test(version)) throw new Error(`not a release version: ${JSON.stringify(version)}`);
  if (!SHA256.test(sha256)) throw new Error(`not a sha256: ${JSON.stringify(sha256)}`);
  const lines = text.split("\n");
  for (const line of [VERSION_LINE, SHA256_LINE]) {
    const n = lines.filter((l) => l === line).length;
    if (n !== 1) throw new Error(`install.sh must hold the line ${line} exactly once (found ${n})`);
  }
  return lines.map((l) => (l === VERSION_LINE ? `release_version='${version}'` : l === SHA256_LINE ? `release_sha256='${sha256}'` : l)).join("\n");
}

async function run(argv: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${argv.join(" ")} failed (exit ${code}): ${err.trim()}`);
  return out;
}

/** The commit's time, or SOURCE_DATE_EPOCH: every entry's mtime. */
async function sourceDate(root: string): Promise<number> {
  const env = process.env["SOURCE_DATE_EPOCH"];
  const raw = env !== undefined && env !== "" ? env : (await run(["git", "log", "-1", "--format=%ct"], root)).trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`not a time: ${JSON.stringify(raw)}`);
  return Number(raw);
}

/** The result of packaging. */
export interface Package {
  version: string;
  tarball: string;
  sha256: string;
  sha256File: string;
  installer: string;
}

/** Packages the repo at `root` into `outDir`. */
export async function packageMod(root: string, out: string): Promise<Package> {
  const outDir = resolve(out);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  if (!SEMVER.test(version)) throw new Error(`package.json version is not a release version: ${JSON.stringify(version)}`);
  const paths = (await run(["git", "ls-files", "-z", "--", ...PACKAGE_PATHSPECS], root)).split("\0").filter(Boolean).sort();
  for (const required of REQUIRED_FILES) {
    if (!paths.includes(required)) throw new Error(`${required} is not a tracked file`);
  }
  const stage = await mkdtemp(join(tmpdir(), "gascity-package-"));
  try {
    for (const path of paths) {
      await mkdir(join(stage, dirname(path)), { recursive: true });
      await copyFile(join(root, path), join(stage, path));
      await chmod(join(stage, path), 0o644);
    }
    await mkdir(outDir, { recursive: true });
    const tarball = join(outDir, tarballName(version));
    const tops = [...new Set(paths.map((p) => p.split("/")[0]!))].sort();
    const tar = [
      "tar", "--create", "--format=ustar", "--sort=name", `--mtime=@${await sourceDate(root)}`,
      "--owner=0", "--group=0", "--numeric-owner", "--mode=u=rwX,go=rX,a-st", "--file=-", ...tops,
    ];
    await run(["bash", "-c", 'set -o pipefail; "$@" | gzip -9 -n >"$OUT"', "bash", ...tar], stage, { OUT: tarball });
    const sha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
    const sha256File = `${tarball}.sha256`;
    await writeFile(sha256File, `${sha256}  ${basename(tarball)}\n`);
    const installer = join(outDir, "install.sh");
    await writeFile(installer, stampInstaller(await readFile(join(root, "install.sh"), "utf8"), version, sha256));
    await chmod(installer, 0o755);
    return { version, tarball, sha256, sha256File, installer };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let out = join(import.meta.dir, "..", "dist");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1] !== undefined) out = args[++i]!;
    else throw new Error(`usage: bun run scripts/package.ts [--out <dir>] (got ${JSON.stringify(args[i])})`);
  }
  const pkg = await packageMod(join(import.meta.dir, ".."), out);
  console.log(JSON.stringify(pkg, null, 2));
}
