// scripts/package.ts: the release tarball is reproducible and holds exactly
// the mod folder, LICENSE and compat.json; install.sh is stamped with the
// version and the tarball's sha256, and nothing else changes in it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageMod, stampInstaller, tarballName, type Package } from "../../scripts/package.ts";

const ROOT = join(import.meta.dir, "../..");
const SHA = "a".repeat(64);
let dir: string;
let first: Package;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "gascity-package-test-"));
  first = await packageMod(ROOT, join(dir, "a"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tracked = async (spec: string) => {
  const p = Bun.spawnSync(["git", "ls-files", "--", spec], { cwd: ROOT });
  return p.stdout.toString().split("\n").filter(Boolean);
};

describe("stampInstaller", () => {
  const source = "#!/bin/sh\nrelease_version=''\nrelease_sha256=''\necho hi\n";

  test("fills in the two empty lines and changes nothing else", () => {
    expect(stampInstaller(source, "1.2.3", SHA)).toBe(`#!/bin/sh\nrelease_version='1.2.3'\nrelease_sha256='${SHA}'\necho hi\n`);
  });

  test("refuses a bad version or sha256, and a script without exactly one of each line", () => {
    expect(() => stampInstaller(source, "v1.2.3", SHA)).toThrow("not a release version");
    expect(() => stampInstaller(source, "1.2.3'; rm -rf /'", SHA)).toThrow("not a release version");
    expect(() => stampInstaller(source, "1.2.3", "A".repeat(64))).toThrow("not a sha256");
    expect(() => stampInstaller("release_sha256=''\n", "1.2.3", SHA)).toThrow("release_version=''");
    expect(() => stampInstaller(`${source}release_version=''\n`, "1.2.3", SHA)).toThrow("exactly once (found 2)");
  });

  test("the repository's install.sh is the unstamped source copy", async () => {
    const text = await readFile(join(ROOT, "install.sh"), "utf8");
    expect(text).toContain("\nrelease_version=''\n");
    expect(text).toContain("\nrelease_sha256=''\n");
  });
});

describe("packageMod", () => {
  test("names the tarball after package.json's version", async () => {
    const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(first.version).toBe(version);
    expect(first.tarball).toBe(join(dir, "a", tarballName(version)));
  });

  test("is reproducible: a second package is the same bytes", async () => {
    const second = await packageMod(ROOT, join(dir, "b"));
    expect(second.sha256).toBe(first.sha256);
    expect(Buffer.compare(await readFile(second.tarball), await readFile(first.tarball))).toBe(0);
  });

  test("holds the tracked mod folder, LICENSE and compat.json, owned by 0:0 with fixed modes", async () => {
    const list = Bun.spawnSync(["tar", "-tvzf", first.tarball]).stdout.toString().trim().split("\n");
    const names = list.map((l) => l.split(/\s+/).at(-1)!).filter((n) => !n.endsWith("/")).sort();
    expect(names).toEqual([...(await tracked("gascity")), "LICENSE", "compat.json"].sort());
    for (const line of list) {
      expect(line).toMatch(/^(-rw-r--r--|drwxr-xr-x) 0\/0 /);
    }
  });

  test("the sha256 file is sha256sum -c format and matches the tarball", async () => {
    const sum = createHash("sha256").update(await readFile(first.tarball)).digest("hex");
    expect(first.sha256).toBe(sum);
    expect(await readFile(first.sha256File, "utf8")).toBe(`${sum}  ${tarballName(first.version)}\n`);
  });

  test("install.sh is stamped with the version and the tarball's sha256", async () => {
    const stamped = await readFile(first.installer, "utf8");
    expect(stamped).toBe(stampInstaller(await readFile(join(ROOT, "install.sh"), "utf8"), first.version, first.sha256));
  });
});
