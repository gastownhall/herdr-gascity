// Guards on the GitHub workflows:
//   - no tool cache crosses workflows: a workflow that runs downloaded code
//     (herdr's installer, gc, Go modules) must not be able to save a tool
//     binary that release.yml later restores and builds the release with. So
//     every setup-bun step has `no-cache: true` and every setup-go step
//     `cache: false`, in every workflow;
//   - every action is pinned to a commit;
//   - release.yml: read-only by default; only the tag-gated attest job may mint
//     an OIDC token and write attestations, only the tag-gated publish job may
//     write contents; a tag must be on main.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../.github/workflows");

interface Step { uses?: string; run?: string; with?: Record<string, unknown>; name?: string }
interface Job { if?: string; needs?: string | string[]; permissions?: Record<string, string>; steps: Step[] }
interface Workflow { permissions?: Record<string, string>; jobs: Record<string, Job> }

async function workflows(): Promise<[string, Workflow][]> {
  const names = (await readdir(DIR)).filter((n) => n.endsWith(".yml")).sort();
  return Promise.all(names.map(async (n): Promise<[string, Workflow]> => [n, Bun.YAML.parse(await readFile(join(DIR, n), "utf8")) as Workflow]));
}

const steps = (w: Workflow) => Object.entries(w.jobs).flatMap(([job, j]) => j.steps.map((s) => ({ job, step: s })));
const TAG_ONLY = "github.event_name == 'push' && github.ref_type == 'tag'";

describe("workflows", () => {
  test("every setup-bun step turns its cache off", async () => {
    let seen = 0;
    for (const [name, w] of await workflows()) {
      for (const { job, step } of steps(w)) {
        if (!step.uses?.startsWith("oven-sh/setup-bun@")) continue;
        seen++;
        expect({ name, job, noCache: step.with?.["no-cache"] }).toEqual({ name, job, noCache: true });
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("every setup-go step turns its cache off", async () => {
    for (const [name, w] of await workflows()) {
      for (const { job, step } of steps(w)) {
        if (!step.uses?.startsWith("actions/setup-go@")) continue;
        expect({ name, job, cache: step.with?.["cache"] }).toEqual({ name, job, cache: false });
      }
    }
  });

  test("every action is pinned to a full commit sha", async () => {
    for (const [name, w] of await workflows()) {
      for (const { step } of steps(w)) {
        if (step.uses === undefined || step.uses.startsWith("./")) continue;
        expect({ name, uses: step.uses, pinned: /^[^@]+@[0-9a-f]{40}$/.test(step.uses) }).toEqual({ name, uses: step.uses, pinned: true });
      }
    }
  });
});

describe("preview.yml", () => {
  test("never runs in main's context: only branch pushes other than main", async () => {
    const w = (await workflows()).find(([n]) => n === "preview.yml")![1] as unknown as { on: Record<string, unknown> };
    expect(Object.keys(w.on)).toEqual(["push"]);
    const push = w.on["push"] as Record<string, unknown>;
    expect(push["branches-ignore"]).toEqual(["main"]);
    expect(push["branches"]).toBeUndefined();
    expect(push["tags"]).toBeUndefined();
  });
});

describe("release.yml", () => {
  const release = async () => (await workflows()).find(([n]) => n === "release.yml")![1];

  test("is read-only by default; only attest mints tokens and only publish writes, both on a tag push only", async () => {
    const w = await release();
    expect(w.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(w.jobs)) {
      const perms = job.permissions ?? {};
      const writes = Object.entries(perms).filter(([, v]) => v === "write").map(([k]) => k).sort();
      if (name === "attest") expect(writes).toEqual(["attestations", "id-token"]);
      else if (name === "publish") expect(writes).toEqual(["contents"]);
      else expect(writes).toEqual([]);
      if (writes.length > 0) expect(job.if).toBe(TAG_ONLY);
    }
  });

  test("publish waits for the attestation; the attestation covers the tarball and install.sh", async () => {
    const w = await release();
    expect([w.jobs["publish"]!.needs].flat()).toContain("attest");
    const attest = w.jobs["attest"]!.steps.find((s) => s.uses?.startsWith("actions/attest-build-provenance@"));
    const subjects = String(attest?.with?.["subject-path"] ?? "");
    expect(subjects).toContain(".tar.gz");
    expect(subjects).toContain("install.sh");
  });

  test("the tag checks come right after checkout, before any of the tagged commit's code runs", async () => {
    const w = await release();
    const pkg = w.jobs["package"]!;
    expect(pkg.steps[0]!.uses).toStartWith("actions/checkout@");
    expect(pkg.steps[0]!.with?.["fetch-depth"]).toBe(0);
    const [onMain, version] = [pkg.steps[1]!, pkg.steps[2]!];
    expect(onMain.if).toBe("github.ref_type == 'tag'");
    expect(onMain.run).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(version.if).toBe("github.ref_type == 'tag'");
    expect(version.run).toContain("jq -er .version package.json");
    // Only git and jq run before them: no bun, no install, no repository script.
    for (const step of [onMain, version]) expect(step.run).not.toMatch(/\bbun\b|\.\/|scripts\/|canary\//);
  });

  test("restores no cache: no cache action, and no setup step with its cache on", async () => {
    const w = await release();
    for (const { job, step } of steps(w)) {
      const uses = step.uses ?? "";
      expect({ job, uses, cacheAction: /^actions\/cache(\/[a-z]+)?@/.test(uses) }).toEqual({ job, uses, cacheAction: false });
      if (uses.startsWith("oven-sh/setup-bun@")) expect(step.with?.["no-cache"]).toBe(true);
      if (/^actions\/setup-(go|node|python)@/.test(uses)) expect(step.with?.["cache"]).toBe(false);
      expect(step.run ?? "").not.toMatch(/actions\/cache|ACTIONS_CACHE_URL|ACTIONS_RUNTIME_TOKEN/);
    }
  });
});
