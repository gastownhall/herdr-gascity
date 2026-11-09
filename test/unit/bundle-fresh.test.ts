// The committed bundle must be exactly what the source builds to (design §9:
// a reviewer reads gascity/main.js, so it must be the code that runs).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE_FILE, buildBundle, digestOf } from "../../build.ts";
import { checkBundle } from "../../scripts/bundle-fresh.ts";

const ROOT = join(import.meta.dir, "../..");
const STALE_FIXTURE = join(ROOT, "test/fixtures/bundle/stale-main.js");

describe("build", () => {
  test("is deterministic", async () => {
    expect(await buildBundle(ROOT)).toBe(await buildBundle(ROOT));
  });

  test("is readable: unminified, with a header naming the version and source digest", async () => {
    const out = await buildBundle(ROOT);
    const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    expect(out.split("\n")[0]).toMatch(new RegExp(`^// herdr-gascity ${version.replace(/\./g, "\\.")} `));
    expect(out).toMatch(/source digest sha256:[0-9a-f]{64}/);
    expect(out).toContain("export {\n  GasCity as default\n};");
    expect(out.split("\n").length).toBeGreaterThan(20);
  });

  test("keeps the host modules external", async () => {
    const out = await buildBundle(ROOT);
    expect(out).toContain('from "herdr";');
    expect(out).toContain('from "gpui-kit";');
    expect(out).toContain('from "gpui-base";');
  });

  test("the source digest depends on every input's path and content, not their order", () => {
    const a = digestOf([["src/a.ts", "x"], ["src/b.ts", "y"]]);
    expect(digestOf([["src/b.ts", "y"], ["src/a.ts", "x"]])).toBe(a);
    expect(digestOf([["src/a.ts", "x"], ["src/b.ts", "z"]])).not.toBe(a);
    expect(digestOf([["src/a.ts", "x"], ["src/c.ts", "y"]])).not.toBe(a);
    expect(digestOf([["src/a.tsx", ""], ["src/b.ts", "y"]])).not.toBe(digestOf([["src/a.ts", "x"], ["src/b.ts", "y"]]));
  });
});

describe("freshness check", () => {
  test("the committed bundle matches a clean rebuild", async () => {
    expect(await checkBundle(join(ROOT, BUNDLE_FILE), await buildBundle(ROOT))).toEqual({ fresh: true });
  });

  test("the stale fixture fails", async () => {
    const r = await checkBundle(STALE_FIXTURE, await buildBundle(ROOT));
    expect(r.fresh).toBe(false);
    expect(r.fresh === false && r.reason).toContain("differs from a clean rebuild at line 1");
  });

  test("a one-byte edit to the real bundle fails and names the line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-gascity-"));
    try {
      const expected = await buildBundle(ROOT);
      const lines = expected.split("\n");
      lines[5] += " ";
      const stale = join(dir, "main.js");
      await writeFile(stale, lines.join("\n"));
      const r = await checkBundle(stale, expected);
      expect(r).toEqual({ fresh: false, reason: expect.stringContaining("at line 6") });
      await writeFile(stale, expected + "\n");
      expect(await checkBundle(stale, expected)).toEqual({ fresh: false, reason: expect.stringContaining("length") });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing bundle fails", async () => {
    const r = await checkBundle(join(ROOT, "test/fixtures/bundle/absent.js"), "x");
    expect(r).toEqual({ fresh: false, reason: expect.stringContaining("missing") });
  });

  test("the command line exits 0 on the real tree and 1 on the stale fixture", () => {
    const run = (...args: string[]) =>
      Bun.spawnSync(["bun", "scripts/bundle-fresh.ts", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const ok = run();
    expect(ok.stderr.toString()).toBe("");
    expect(ok.exitCode).toBe(0);
    const stale = run("--bundle", "test/fixtures/bundle/stale-main.js");
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr.toString()).toContain("bun run build");
  });
});
