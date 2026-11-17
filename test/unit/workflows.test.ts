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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../.github/workflows");

interface Step { uses?: string; run?: string; if?: string; with?: Record<string, unknown>; name?: string }
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

describe("smoke.yml", () => {
  const smoke = async () => {
    const text = await readFile(join(DIR, "smoke.yml"), "utf8");
    return { text, w: Bun.YAML.parse(text) as Workflow & { on: Record<string, { paths?: string[] } | unknown[]> } };
  };

  test("runs on pushes and pull requests touching the mod only: no schedule, never dispatched", async () => {
    const { w } = await smoke();
    expect(Object.keys(w.on).sort()).toEqual(["pull_request", "push"]);
    for (const event of ["push", "pull_request"] as const) {
      const paths = (w.on[event] as { paths?: string[] }).paths ?? [];
      expect(paths).toContain("src/**");
      expect(paths).toContain("gascity/**");
      expect(paths).toContain(".github/workflows/smoke.yml");
    }
  });

  test("is read-only, holds no secret and every job has a timeout", async () => {
    const { text, w } = await smoke();
    expect(w.permissions).toEqual({ contents: "read" });
    expect(text).not.toMatch(/secrets\.|GITHUB_TOKEN|github\.token/);
    for (const [name, job] of Object.entries(w.jobs)) {
      expect({ name, permissions: job.permissions }).toEqual({ name, permissions: undefined });
      expect({ name, timeout: typeof (job as { "timeout-minutes"?: number })["timeout-minutes"] }).toEqual({ name, timeout: "number" });
    }
  });

  test("saves no cache: the release mirror is only restored", async () => {
    const { w } = await smoke();
    let restores = 0;
    for (const { job, step } of steps(w)) {
      const uses = step.uses ?? "";
      if (!/^actions\/cache(\/[a-z]+)?@/.test(uses)) continue;
      expect({ job, uses: uses.split("@")[0] }).toEqual({ job, uses: "actions/cache/restore" });
      restores++;
    }
    expect(restores).toBeGreaterThan(0);
  });

  test("a broken bundle must fail the smoke at the check stage", async () => {
    const { w } = await smoke();
    const broken = w.jobs["broken-bundle"]!.steps;
    expect(broken.some((s) => s.run === "canary/mod-linux.sh package --broken")).toBe(true);
    expect(broken.some((s) => (s.run ?? "").includes('.failed_stage == "check"'))).toBe(true);
    const runs = w.jobs["smoke"]!.steps.map((s) => s.run ?? "");
    for (const stage of ["package", "check", "install", "connected", "shot smoke.png"]) expect(runs).toContain(`canary/mod-linux.sh ${stage}`);
  });
});

describe("canary.yml", () => {
  const canary = async () => {
    const text = await readFile(join(DIR, "canary.yml"), "utf8");
    return { text, w: Bun.YAML.parse(text) as Workflow };
  };
  const CACHE = /^actions\/cache(\/[a-z]+)?@/;
  const checksOutGascity = (j: Job) => j.steps.some((s) => s.uses?.startsWith("actions/checkout@") && s.with?.["repository"] === "gastownhall/gascity");

  test("only the mirror job saves a cache, and it runs no gascity code and no downloaded code", async () => {
    const { w } = await canary();
    const savers = Object.entries(w.jobs).filter(([, j]) => j.steps.some((s) => CACHE.test(s.uses ?? "") && !s.uses!.startsWith("actions/cache/restore@")));
    expect(savers.map(([n]) => n)).toEqual(["mirror"]);
    const mirror = w.jobs["mirror"]!;
    expect(checksOutGascity(mirror)).toBe(false);
    for (const s of mirror.steps) {
      const uses = (s.uses ?? "").split("@")[0] ?? "";
      if (s.uses !== undefined) {
        expect(["actions/checkout", "actions/cache/restore", "actions/cache/save"]).toContain(uses);
        if (uses === "actions/checkout") expect(s.with?.["repository"]).toBeUndefined();
      } else {
        // Only the resolve (manifests) and the sha256-checked fill: neither runs what it downloads.
        expect(["canary/bootstrap-linux.sh resolve", "canary/bootstrap-linux.sh fill"]).toContain((s.run ?? "").trim());
      }
    }
  });

  test("a job that checks out gascity only restores caches", async () => {
    const { w } = await canary();
    const builders = Object.entries(w.jobs).filter(([, j]) => checksOutGascity(j));
    expect(builders.map(([n]) => n)).toEqual(["canary"]);
    for (const [job, j] of builders) {
      for (const s of j.steps) {
        if (CACHE.test(s.uses ?? "")) expect({ job, uses: s.uses!.split("@")[0] }).toEqual({ job, uses: "actions/cache/restore" });
      }
    }
  });

  test("the report job runs report.sh with the run's real ref, and the result names it", async () => {
    const { text, w } = await canary();
    const steps = w.jobs["report"]!.steps;
    const report = steps.filter((s) => s.run !== undefined);
    expect(report.map((s) => s.run)).toEqual(["canary/report.sh"]);
    expect((report[0] as Step & { env?: Record<string, string> }).env).toMatchObject({
      REF: "${{ github.ref }}",
      DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
      ATTEMPT: "${{ github.run_attempt }}",
      RESULTS: "results",
    });
    expect(text).not.toMatch(/globstar/);
    expect(text).toContain("CANARY_INTEGRATION_VERSION: ${{ github.ref_name }}@${{ github.sha }}");
  });

  test("least privilege: none by default, every job declares its own, and only the report job writes", async () => {
    const { w } = await canary();
    expect(w.permissions).toEqual({});
    // The only secret is the target-list App key, and only the targets job sees it.
    for (const [name, job] of Object.entries(w.jobs)) {
      const secrets = JSON.stringify(job).match(/secrets\.[A-Za-z0-9_]+/g) ?? [];
      expect({ name, secrets }).toEqual({ name, secrets: name === "targets" ? ["secrets.CANARY_TARGETS_APP_KEY"] : [] });
    }
    const perms = Object.fromEntries(Object.entries(w.jobs).map(([n, j]) => [n, j.permissions]));
    expect(perms).toEqual({ plan: {}, mirror: { contents: "read" }, canary: {}, targets: {}, report: { actions: "read", contents: "read", issues: "write" } });
    for (const [name, job] of Object.entries(w.jobs)) {
      expect({ name, timeout: typeof (job as { "timeout-minutes"?: number })["timeout-minutes"] }).toEqual({ name, timeout: "number" });
    }
    // The job that runs downloaded code never sees a token in its environment.
    expect(JSON.stringify(w.jobs["canary"])).not.toMatch(/github\.token|GITHUB_TOKEN|GH_TOKEN/);
  });

  describe("the targets job", () => {
    const LIST = "gascity/gas-city-inc";
    const targets = async () => (await canary()).w.jobs["targets"] as Job & { environment?: unknown; outputs?: Record<string, string> };
    const runs = async () => (await targets()).steps.filter((s) => s.run !== undefined) as (Step & { env?: Record<string, string> })[];

    test("runs from main only, on the schedule or a dispatch, in the canary-targets environment, with no token permissions", async () => {
      const j = await targets();
      expect(j.environment).toBe("canary-targets");
      expect(j.permissions).toEqual({});
      expect(j.if).toBe("github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')");
      expect(typeof (j as { "timeout-minutes"?: number })["timeout-minutes"]).toBe("number");
      expect(j.needs).toBeUndefined();
    });

    test("uses only checkout of this repo, setup-bun and the pinned App token action; runs nothing it downloads", async () => {
      const j = await targets();
      const uses = j.steps.filter((s) => s.uses !== undefined).map((s) => s.uses!.split("@")[0]);
      expect(uses).toEqual(["actions/checkout", "oven-sh/setup-bun", "actions/create-github-app-token"]);
      const checkout = j.steps.find((s) => s.uses?.startsWith("actions/checkout@"))!;
      expect(checkout.with?.["repository"]).toBeUndefined();
      expect(checkout.with?.["persist-credentials"]).toBe(false);
      for (const s of j.steps) expect(s.run ?? "").not.toMatch(/bun (install|add|x)\b|bunx|npm|npx|pip|go (run|install)|curl[^\n]*\| *(ba)?sh/);
    });

    test("mints a single-file read token for the list's repo only, from the environment's App", async () => {
      const app = (await targets()).steps.find((s) => s.uses?.startsWith("actions/create-github-app-token@"))!;
      expect(app.uses).toMatch(/^actions\/create-github-app-token@[0-9a-f]{40}$/);
      expect(app.name).toBe("Token for the target list (single file, read)");
      expect(app.with).toEqual({
        "client-id": "${{ vars.CANARY_TARGETS_CLIENT_ID }}",
        "private-key": "${{ secrets.CANARY_TARGETS_APP_KEY }}",
        owner: "gascity",
        repositories: "gas-city-inc",
        "permission-single-file": "read",
      });
    });

    test("fetches the list into the runner's temp dir and checks it with targets.ts; the token reaches the fetch only", async () => {
      const [fetch, check, ...rest] = await runs();
      expect(rest).toEqual([]);
      expect(fetch!.env?.["TOKEN"]).toBe("${{ steps.token.outputs.token }}");
      expect(fetch!.env?.["LIST_API"]).toBe(`\${{ github.api_url }}/repos/${LIST}/contents/packs/measure/config/agent-ui-targets.toml`);
      expect(fetch!.run).toContain('-o "$LIST" "$LIST_API"');
      // The token goes to curl on stdin, once: never on a command line or to the log.
      expect(fetch!.run!.match(/\$TOKEN|\$\{TOKEN/g)).toEqual(["$TOKEN"]);
      expect(fetch!.run).toContain('-H @-');
      expect(fetch!.run).toContain('<<<"Authorization: Bearer $TOKEN"');
      expect(check!.run).toContain('bun canary/targets.ts --file "$LIST"');
      expect(JSON.stringify(check)).not.toMatch(/TOKEN|token/);
      for (const s of [fetch!, check!]) {
        expect(s.env?.["LIST"]).toStartWith("${{ runner.temp }}/");
        expect(s.run).not.toMatch(/set -x|set -o xtrace/);
        // The list is private: never printed, copied or uploaded.
        expect(s.run).not.toMatch(/\b(cat|head|tail|less|cp|mv|tee)\b[^\n]*\$LIST|GITHUB_STEP_SUMMARY/);
      }
    });

    // Runs a step's script as Actions does (bash -e), with stubs first on PATH.
    function runStep(script: string, stubs: Record<string, string>, env: Record<string, string>) {
      const root = mkdtempSync(join(tmpdir(), "canary-targets-step-"));
      try {
        const bin = join(root, "bin");
        mkdirSync(bin);
        for (const [name, body] of Object.entries(stubs)) {
          writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
          chmodSync(join(bin, name), 0o755);
        }
        const out = join(root, "output");
        writeFileSync(out, "");
        const list = join(root, "targets", "list.toml");
        const p = Bun.spawnSync(["bash", "-e", "-c", script], {
          env: { PATH: `${bin}:${process.env["PATH"]}`, GITHUB_OUTPUT: out, LIST: list, TOKEN: "t0ken", LIST_API: "https://api.example/x", ...env },
        });
        let listed: string | null = null;
        try {
          listed = readFileSync(list, "utf8");
        } catch {
          listed = null;
        }
        return { code: p.exitCode, stdout: p.stdout.toString(), output: readFileSync(out, "utf8"), list: listed, root };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    describe("the fetch step", () => {
      // A curl that writes BODY to -o's file and prints WROTE as its -w output; exits CURL_RC.
      const CURL = 'o=""; while (($#)); do [[ $1 == -o ]] && o=$2; shift; done; cat >/dev/null; printf %s "$BODY" >"$o"; printf %s "$WROTE"; exit "${CURL_RC:-0}"';
      const fetch = async () => (await runs())[0]!.run!;

      test("the raw file with HTTP 200 is kept", async () => {
        const r = runStep(await fetch(), { curl: CURL }, { BODY: "a = 1\n", WROTE: "200 application/vnd.github.raw+json; charset=utf-8" });
        expect(r.code).toBe(0);
        expect(r.list).toBe("a = 1\n");
      });

      test("a redirect, another media type (a directory's JSON), an HTTP error or an empty file is a fetch error and leaves no file", async () => {
        const cases: Record<string, string>[] = [
          { BODY: "", WROTE: "302 text/html" },
          { BODY: "[]", WROTE: "200 application/json; charset=utf-8" },
          { BODY: "{}", WROTE: "404 application/json", CURL_RC: "22" },
          { BODY: "", WROTE: "200 application/vnd.github.raw+json" },
        ];
        for (const env of cases) {
          const r = runStep(await fetch(), { curl: CURL }, env);
          expect({ env, failed: r.code !== 0, list: r.list }).toEqual({ env, failed: true, list: null });
          if (env["CURL_RC"] === undefined) expect(r.stdout).toStartWith("::error::");
        }
      });

      test("does not follow redirects", async () => {
        expect(await fetch()).not.toMatch(/\s(-L|--location)\b/);
      });
    });

    describe("the check step", () => {
      const BUN = 'printf "%s" "$LINES"; exit "$RC"';
      const check = async () => (await runs())[1]!.run!;
      const LINE = "target list: herdr-app, lane main, 6 steps mapped onto this canary's stages";

      test("maps targets.ts's exit to a status: 0 ok and 3 ok-others pass; 1 mismatch and 2 error fail", async () => {
        for (const [rc, status, code] of [["0", "ok", 0], ["3", "ok-others", 0], ["1", "mismatch", 1], ["2", "error", 1], ["70", "error", 1]] as const) {
          const r = runStep(await check(), { bun: BUN }, { RC: rc, LINES: LINE + "\n" });
          expect({ rc, code: r.code }).toEqual({ rc, code });
          expect({ rc, status: r.output.match(/^status=(.*)$/m)?.[1] }).toEqual({ rc, status });
          expect(r.output).toContain(`\n${LINE}\n`);
        }
      });

      test("never prints the report to the log: it leaves only as an output, for report.sh to check first", async () => {
        const r = runStep(await check(), { bun: BUN }, { RC: "1", LINES: "::warning::target list: @someone\n" });
        expect(r.stdout).not.toContain("@someone");
        expect(r.stdout).toBe("::error::target list check: mismatch\n");
        const ok = runStep(await check(), { bun: BUN }, { RC: "0", LINES: LINE + "\n" });
        expect(ok.stdout).toBe("");
      });
    });

    test("uploads nothing and touches no cache", async () => {
      for (const s of (await targets()).steps) expect(s.uses ?? "").not.toMatch(/upload-artifact|actions\/cache/);
    });

    test("hands only targets.ts's public report and a status to the report job", async () => {
      const { w } = await canary();
      expect((await targets()).outputs).toEqual({ status: "${{ steps.check.outputs.status }}", report: "${{ steps.check.outputs.report }}" });
      expect([w.jobs["report"]!.needs].flat()).toEqual(["plan", "canary", "targets"]);
      const report = w.jobs["report"]!.steps.find((s) => s.run === "canary/report.sh") as Step & { env?: Record<string, string> };
      expect(report.env).toMatchObject({
        TARGETS: "${{ needs.targets.result }}",
        TARGETS_STATUS: "${{ needs.targets.outputs.status }}",
        TARGETS_REPORT: "${{ needs.targets.outputs.report }}",
      });
    });
  });
});
