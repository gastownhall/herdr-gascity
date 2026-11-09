// install.sh against a stub herdr-app (test/install/stub/herdr-app) and a
// stub curl on a PATH that holds nothing else but the tools install.sh is
// allowed to use. The stub records every call and answers from scripted
// replies, so each test pins the exact herdr-app calls the installer makes
// and checks that every failed step exits non-zero.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageMod, stampInstaller } from "../../scripts/package.ts";

const ROOT = join(import.meta.dir, "../..");
const INSTALL = join(ROOT, "install.sh");
const STUBS = join(import.meta.dir, "stub");
/** The programs install.sh may run besides herdr-app and curl (the PATH holds only these). */
const TOOLS = ["sh", "tar", "gzip", "sha256sum", "mktemp", "sed", "tr", "awk", "date", "sleep", "mv", "cp", "rm", "mkdir", "cat", "grep", "ls", "rmdir"];
const RELEASES = "https://github.com/gastownhall/herdr-gascity/releases/download";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** herdr-app's `ls`, pretty-printed as herdr prints it. */
type LsTab = { id: string; name: string; terminals: number };
const SHELL_TAB = (id: string): LsTab => ({ id: `tb-${id}`, name: "1", terminals: 1 });

function lsReply(spaces: { id: string; machine: string | null; active: boolean; tabs?: LsTab[] }[]): string {
  return JSON.stringify({
    spaces: spaces.map((s) => ({
      id: s.id, name: `space ${s.id}`, folder: `/home/p/${s.id} "x", {y}`, machine: s.machine, active: s.active,
      tabs: (s.tabs ?? [SHELL_TAB(s.id)]).map((t) => ({
        id: t.id, name: t.name, active: true, settled: false,
        terminals: Array.from({ length: t.terminals }, (_, i) => ({ terminal: `t${i}`, pane: `p${i}`, status: "idle", app: null, name: null, sub_agents: [] })),
      })),
    })),
    recent: [{ id: "recent-1", machine: null, active: true }],
  }, null, 2);
}

const ok = (body: Record<string, unknown> = { ok: true }) => `0\n${JSON.stringify(body, null, 2)}\n`;
const herdrError = (message: string) => `1\n${JSON.stringify({ error: message }, null, 2)}\n`;
const NOT_LOADED = herdrError('unknown command "gascity.set-gc-bin:/opt/gc/bin/gc": see `herdr-app commands`; a mod\'s are <mod>.<command> and need the mod loaded');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** Every herdr-app call, its arguments. */
  calls: string[][];
  /** The `do` commands, with their arguments. */
  dos: string[][];
}

let base: string;
let bin: string;
let stub: string;
let home: string;
let appHome: string;
let fixture: string;

/** A mod tarball like a release's: gascity/ (with the files install.sh leaves out), LICENSE, compat.json. */
async function makeTarball(dir: string, mainJs: string, files: Record<string, string> = {}): Promise<string> {
  const src = join(dir, "src");
  await mkdir(join(src, "gascity"), { recursive: true });
  const all: Record<string, string> = {
    "gascity/main.js": mainJs,
    "gascity/mod.json": '{ "place": "none", "title": "Gas City" }\n',
    "gascity/keys.json": '{ "global": { "ctrl-alt-g": "mod.open:gascity" } }\n',
    "gascity/RECIPE.md": "# Gas City\n",
    "gascity/preview.png": "png",
    "gascity/THIRD_PARTY_NOTICES.md": "notices\n",
    LICENSE: "MIT\n",
    "compat.json": "{}\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(join(src, path, ".."), { recursive: true });
    await writeFile(join(src, path), text);
  }
  const out = join(dir, "gascity-mod-9.9.9.tar.gz");
  const proc = Bun.spawnSync(["tar", "-czf", out, "-C", src, ...Object.keys(all).map((p) => p.split("/")[0]!).filter((p, i, a) => a.indexOf(p) === i)]);
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return out;
}

async function reply(key: string, text: string, n?: number) {
  await writeFile(join(stub, "replies", n === undefined ? key : `${key}.${n}`), text);
}

/** The app is up with one local, active space `pa`; tab.new, tab.select and set-gc-bin answer. */
async function appRunning() {
  await reply("status", ok({ space: "pa", tab: "tb-pa", errors: [] }));
  await reply("ls", `0\n${lsReply([{ id: "pa", machine: null, active: true }])}\n`);
  await reply("tab.new", ok({ space: "pa", tab: "tb9", pane: "p9" }));
  await reply("tab.select", ok());
  await reply("gascity.set-gc-bin", ok());
}

async function gcOnPath(dir = bin): Promise<string> {
  const gc = join(dir, "gc");
  await writeFile(gc, "#!/bin/sh\nexit 0\n");
  await chmod(gc, 0o755);
  return gc;
}

async function run(args: string[], options: { env?: Record<string, string | undefined>; script?: string } = {}): Promise<Run> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ PATH: bin, HOME: home, HERDR_APP_HOME: appHome, STUB_DIR: stub, HERDR_GASCITY_WAIT: "3", LC_ALL: "C", ...options.env })) {
    if (v !== undefined) env[k] = v;
  }
  const proc = Bun.spawn(["/bin/sh", options.script ?? INSTALL, ...args], { env, stdout: "pipe", stderr: "pipe", cwd: base });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const log = await readFile(join(stub, "argv.log"), "utf8").catch(() => "");
  const calls = log.split("\n").filter((l) => l !== "").map((l) => l.split("\x1f"));
  return { code, stdout, stderr, calls, dos: calls.filter((c) => c[0] === "do").map((c) => c.slice(1)) };
}

const installed = async () => (await readdir(join(appHome, "mods", "gascity"))).sort();
const modsDir = async () => (await readdir(join(appHome, "mods"))).sort();
const output = (r: Run) => r.stdout + r.stderr;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "gascity-install-"));
  bin = join(base, "bin");
  stub = join(base, "stub");
  home = join(base, "home");
  appHome = join(base, "app-home");
  await mkdir(bin);
  await mkdir(join(stub, "replies"), { recursive: true });
  await mkdir(home);
  for (const tool of TOOLS) {
    const path = Bun.which(tool, { PATH: "/usr/bin:/bin" });
    if (path === null) throw new Error(`test needs ${tool}`);
    await symlink(path, join(bin, tool));
  }
  for (const name of ["herdr-app", "curl"]) await cp(join(STUBS, name), join(bin, name));
  fixture = await makeTarball(join(base, "fixture"), "// new build\n");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("a fresh install with the app open", () => {
  test("checks the build, opens a Gas City tab in the local space, selects it and sets gcBin, in that order", async () => {
    await appRunning();
    const gc = await gcOnPath();
    const r = await run(["--from", fixture]);
    expect(output(r)).toContain("Gas City");
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => c[0])).toEqual(["check", "status", "ls", "do", "do", "do"]);
    expect(r.calls[0]![1]).not.toBe(join(appHome, "mods", "gascity"));
    expect(r.dos).toEqual([
      ["tab.new", "--mod", "gascity", "--name", "Gas City", "--space", "pa"],
      ["tab.select", "--id", "tb9"],
      [`gascity.set-gc-bin:${gc}`],
    ]);
    // herdr's flow: the recipe, the preview and the key fragment stay out of mods/.
    expect(await installed()).toEqual(["THIRD_PARTY_NOTICES.md", "main.js", "mod.json"]);
    expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe("// new build\n");
    expect(await modsDir()).toEqual(["gascity"]);
    expect(output(r)).toContain("ctrl-alt-g");
  });

  test("the build is checked before it replaces anything", async () => {
    await appRunning();
    await mkdir(join(appHome, "mods", "gascity"), { recursive: true });
    await writeFile(join(appHome, "mods", "gascity", "main.js"), "// old build\n");
    const r = await run(["--from", fixture]);
    expect(r.code).toBe(0);
    const log = await readFile(join(stub, "check.log"), "utf8");
    expect(log).toContain("main.js");
    expect(log).toContain("installed main.js: // old build");
  });

  test("the active space is remote: the tab goes to a local space, named explicitly", async () => {
    await appRunning();
    await reply("ls", `0\n${lsReply([{ id: "box/pr", machine: "box", active: true }, { id: "pl", machine: null, active: false }])}\n`);
    await reply("tab.new", ok({ space: "pl", tab: "tb9", pane: "p9" }));
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos[0]).toEqual(["tab.new", "--mod", "gascity", "--name", "Gas City", "--space", "pl"]);
  });

  test("the active local space wins over an earlier local one", async () => {
    await appRunning();
    await reply("ls", `0\n${lsReply([{ id: "p1", machine: null, active: false }, { id: "p2", machine: null, active: true }])}\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos[0]).toEqual(["tab.new", "--mod", "gascity", "--name", "Gas City", "--space", "p2"]);
  });

  test("no local space: space.new first, and the tab goes to the space it made", async () => {
    await appRunning();
    await reply("ls", `0\n${lsReply([{ id: "box/pr", machine: "box", active: true }])}\n`);
    await reply("space.new", ok({ space: "pn", tab: "tb1", terminal: "t1" }));
    await reply("tab.new", ok({ space: "pn", tab: "tb9", pane: "p9" }));
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos.slice(0, 2)).toEqual([["space.new"], ["tab.new", "--mod", "gascity", "--name", "Gas City", "--space", "pn"]]);
  });

  test("ls lists no space at all (a fresh home): space.new first", async () => {
    await appRunning();
    await reply("ls", `0\n${JSON.stringify({ spaces: [], recent: [] }, null, 2)}\n`);
    await reply("space.new", ok({ space: "pn", tab: "tb1", terminal: "t1" }));
    await reply("tab.new", ok({ space: "pn", tab: "tb9", pane: "p9" }));
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos.map((d) => d.join(" "))).toEqual([
      "space.new",
      "tab.new --mod gascity --name Gas City --space pn",
      "tab.select --id tb9",
      "gascity.set-gc-bin:gc",
    ]);
  });

  test("the local space closes between ls and tab.new (\"no space yet\"): space.new, then tab.new again", async () => {
    await appRunning();
    await reply("tab.new", herdrError("no space yet: make one first (space.new)"), 1);
    await reply("tab.new", ok({ space: "pn", tab: "tb9", pane: "p9" }), 2);
    await reply("space.new", ok({ space: "pn", tab: "tb1", terminal: "t1" }));
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos.map((d) => d.join(" "))).toEqual([
      "tab.new --mod gascity --name Gas City --space pa",
      "space.new",
      "tab.new --mod gascity --name Gas City --space pn",
      "tab.select --id tb9",
      "gascity.set-gc-bin:gc",
    ]);
  });

  test("tab.new is retried while herdr has not seen the new mod folder yet", async () => {
    await appRunning();
    for (const n of [1, 2]) await reply("tab.new", herdrError('no mod "gascity" in mods/'), n);
    const r = await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_GASCITY_WAIT: "10" } });
    expect(r.code).toBe(0);
    expect(r.dos.filter((d) => d[0] === "tab.new")).toHaveLength(3);
    expect(r.dos.at(-1)).toEqual(["gascity.set-gc-bin:gc"]);
  });

  test("herdr never sees the mod folder within the wait: herdr's message, and a non-zero exit", async () => {
    await appRunning();
    await reply("tab.new", herdrError('no mod "gascity" in mods/'));
    const r = await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_GASCITY_WAIT: "1" } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no mod \\"gascity\\" in mods/');
    expect(r.dos.some((d) => d[0]!.startsWith("gascity."))).toBe(false);
  });

  test("set-gc-bin is retried until the new copy answers (it loads asynchronously)", async () => {
    await appRunning();
    for (const n of [1, 2, 3]) await reply("gascity.set-gc-bin", NOT_LOADED, n);
    await reply("gascity.set-gc-bin", ok(), 4);
    await mkdir(join(base, "opt"));
    const gc = await gcOnPath(join(base, "opt"));
    const r = await run(["--from", fixture, "--gc-bin", gc], { env: { HERDR_GASCITY_WAIT: "10" } });
    expect(r.code).toBe(0);
    expect(r.dos.filter((d) => d[0]!.startsWith("gascity.")).length).toBe(4);
  });

  test("a delayed ok: set-gc-bin answers only after a second or two", async () => {
    await appRunning();
    await rm(join(stub, "replies", "gascity.set-gc-bin"));
    await reply("gascity.set-gc-bin", NOT_LOADED);
    await writeFile(join(stub, "replies", "gascity.set-gc-bin.okafter"), "2");
    await writeFile(join(stub, "replies", "gascity.set-gc-bin.ok"), ok());
    const r = await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_GASCITY_WAIT: "10" } });
    expect(r.code).toBe(0);
    expect(r.dos.filter((d) => d[0] === "gascity.set-gc-bin:gc").length).toBeGreaterThan(1);
  });

  test("set-gc-bin never answers within the wait: herdr's last message, and a non-zero exit", async () => {
    await appRunning();
    await reply("gascity.set-gc-bin", NOT_LOADED);
    const started = Date.now();
    const r = await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_GASCITY_WAIT: "1" } });
    expect(r.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(r.stderr).toContain("need the mod loaded");
    expect(r.stderr).toContain("set-gc-bin");
  });

  test("gcBin defaults to the absolute path of the gc on PATH", async () => {
    await appRunning();
    const gc = await gcOnPath();
    const r = await run(["--from", fixture]);
    expect(r.code).toBe(0);
    expect(r.dos.at(-1)).toEqual([`gascity.set-gc-bin:${gc}`]);
  });

  test("no gc on PATH and no --gc-bin: gcBin is left alone and the output says how to set it", async () => {
    await appRunning();
    const r = await run(["--from", fixture]);
    expect(r.code).toBe(0);
    expect(r.dos.map((d) => d[0])).toEqual(["tab.new", "tab.select"]);
    expect(output(r)).toContain("--gc-bin");
  });

  test("a gcBin path with ':' or '%' is percent-encoded for the command grammar", async () => {
    await appRunning();
    const dir = join(base, "odd:dir 100%");
    const gc = await gcOnPath((await mkdir(dir, { recursive: true }), dir));
    const r = await run(["--from", fixture, "--gc-bin", gc]);
    expect(r.code).toBe(0);
    expect(r.dos.at(-1)).toEqual([`gascity.set-gc-bin:${gc.replaceAll("%", "%25").replaceAll(":", "%3A")}`]);
  });
});

describe("every failed step exits non-zero", () => {
  const cases: [string, () => Promise<void>, string][] = [
    ["ls", () => reply("ls", herdrError("the window did not answer")), "the window did not answer"],
    ["tab.new", () => reply("tab.new", herdrError("this machine's layout is not loaded yet")), "this machine's layout is not loaded yet"],
    ["space.new", async () => {
      await reply("ls", `0\n${JSON.stringify({ spaces: [], recent: [] }, null, 2)}\n`);
      await reply("space.new", herdrError("this machine's layout is not loaded yet"));
    }, "this machine's layout is not loaded yet"],
    ["tab.select", () => reply("tab.select", herdrError('no tab "tb9"')), 'no tab \\"tb9\\"'],
    ["tab.new after space.new", async () => {
      await reply("tab.new", herdrError("no space yet: make one first (space.new)"));
      await reply("space.new", ok({ space: "pn", tab: "tb1", terminal: "t1" }));
    }, "no space yet"],
    ["the window hangs up", () => reply("tab.new", "2 stderr\nherdr-app: the window hung up\n"), "the window hung up"],
  ];
  for (const [name, script, message] of cases) {
    test(`${name} fails: herdr's message is shown`, async () => {
      await appRunning();
      await script();
      const r = await run(["--from", fixture, "--gc-bin", "gc"]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain(message);
      expect(r.dos.some((d) => d[0]!.startsWith("gascity."))).toBe(false);
    });
  }

  test("herdr-app check fails: nothing is replaced, no backup is made, nothing else runs", async () => {
    await appRunning();
    await reply("check", "1\nmain.js:1: SyntaxError: unexpected token\n");
    await mkdir(join(appHome, "mods", "gascity"), { recursive: true });
    await writeFile(join(appHome, "mods", "gascity", "main.js"), "// old build\n");
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).not.toBe(0);
    expect(output(r)).toContain("SyntaxError");
    expect(r.calls.map((c) => c[0])).toEqual(["check"]);
    expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe("// old build\n");
    expect(await modsDir()).toEqual(["gascity"]);
    expect(await readdir(join(appHome, "mod-backups")).catch(() => [])).toEqual([]);
  });

  test("no herdr-app on PATH", async () => {
    await rm(join(bin, "herdr-app"));
    const r = await run(["--from", fixture]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("herdr-app");
    expect(r.stderr).toContain("releases.herdr.dev/app/install.sh");
  });
});

describe("the app is not open", () => {
  test("the mod is installed and the output says what to run once it is", async () => {
    const gc = await gcOnPath();
    const r = await run(["--from", fixture]);
    expect(r.code).toBe(0);
    expect(r.dos).toEqual([]);
    expect(await installed()).toEqual(["THIRD_PARTY_NOTICES.md", "main.js", "mod.json"]);
    expect(r.stdout).toContain('herdr-app do tab.new --mod gascity --name "Gas City"');
    expect(r.stdout).toContain(`herdr-app do 'gascity.set-gc-bin:${gc}'`);
  });

  test("the printed set-gc-bin command is one shell word, whatever the path holds", async () => {
    const dir = join(base, "it's a dir");
    await mkdir(dir);
    const gc = await gcOnPath(dir);
    const r = await run(["--from", fixture, "--gc-bin", gc]);
    expect(r.code).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.includes("set-gc-bin"))!.trim();
    expect(line).toStartWith("herdr-app do ");
    const parsed = Bun.spawnSync(["/bin/sh", "-c", `eval "set -- $1"; printf '%s|%s' "$#" "$1"`, "sh", line.slice("herdr-app do ".length)]);
    expect(parsed.stdout.toString()).toBe(`1|gascity.set-gc-bin:${gc}`);
  });
});

describe("an earlier install", () => {
  test("is moved to <app home>/mod-backups/, outside mods/, and kept on every reinstall", async () => {
    await appRunning();
    await mkdir(join(appHome, "mods", "gascity"), { recursive: true });
    await writeFile(join(appHome, "mods", "gascity", "main.js"), "// old build\n");
    const r1 = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r1.code).toBe(0);
    const r2 = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r2.code).toBe(0);
    expect(await modsDir()).toEqual(["gascity"]);
    const backups = (await readdir(join(appHome, "mod-backups"))).sort();
    expect(backups).toHaveLength(2);
    for (const b of backups) expect(b).toMatch(/^gascity-\d{8}T\d{6}Z(-\d+)?$/);
    const contents = await Promise.all(backups.map((b) => readFile(join(appHome, "mod-backups", b, "main.js"), "utf8")));
    expect(contents.sort()).toEqual(["// new build\n", "// old build\n"]);
    expect(output(r1)).toContain(join(appHome, "mod-backups"));
  });
});

describe("the tarball", () => {
  test("--from verifies a sibling .sha256 when there is one", async () => {
    await appRunning();
    const bytes = await readFile(fixture);
    await writeFile(`${fixture}.sha256`, `${sha256(bytes)}  gascity-mod-9.9.9.tar.gz\n`);
    expect((await run(["--from", fixture, "--gc-bin", "gc"])).code).toBe(0);
    await writeFile(`${fixture}.sha256`, `${"0".repeat(64)}  gascity-mod-9.9.9.tar.gz\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("checksum");
  });

  test("a .sha256 file with only the hash in it is read too", async () => {
    await appRunning();
    await writeFile(`${fixture}.sha256`, `${sha256(await readFile(fixture))}\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("sha256 checked");
  });

  test("a release's install.sh downloads its own tarball and checks the sha256 it carries", async () => {
    await appRunning();
    const bytes = await readFile(fixture);
    const script = join(base, "install-release.sh");
    await writeFile(script, stampInstaller(await readFile(INSTALL, "utf8"), "9.9.9", sha256(bytes)));
    const url = `${RELEASES}/v9.9.9/gascity-mod-9.9.9.tar.gz`;
    await mkdir(join(stub, "www", url.replace(/^https:\/\//, ""), ".."), { recursive: true });
    await writeFile(join(stub, "www", url.replace(/^https:\/\//, "")), bytes);
    const r = await run(["--gc-bin", "gc"], { script });
    expect(r.code).toBe(0);
    expect(await readFile(join(stub, "curl.log"), "utf8")).toContain(url);
    expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe("// new build\n");
  });

  test("a download whose sha256 does not match is refused; nothing is installed and herdr-app is not asked", async () => {
    await appRunning();
    const bytes = await readFile(fixture);
    const script = join(base, "install-release.sh");
    await writeFile(script, stampInstaller(await readFile(INSTALL, "utf8"), "9.9.9", sha256("something else")));
    const path = `${RELEASES}/v9.9.9/gascity-mod-9.9.9.tar.gz`.replace(/^https:\/\//, "");
    await mkdir(join(stub, "www", path, ".."), { recursive: true });
    await writeFile(join(stub, "www", path), bytes);
    const r = await run(["--gc-bin", "gc"], { script });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("checksum");
    expect(r.calls).toEqual([]);
    expect(await readdir(join(appHome, "mods")).catch(() => [])).toEqual([]);
  });

  test("a failed download exits non-zero", async () => {
    const script = join(base, "install-release.sh");
    await writeFile(script, stampInstaller(await readFile(INSTALL, "utf8"), "9.9.9", sha256("x")));
    const r = await run(["--gc-bin", "gc"], { script });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("download");
  });

  test("HERDR_GASCITY_RELEASES_URL points a release's install.sh at a mirror", async () => {
    await appRunning();
    const bytes = await readFile(fixture);
    const script = join(base, "install-release.sh");
    await writeFile(script, stampInstaller(await readFile(INSTALL, "utf8"), "9.9.9", sha256(bytes)));
    await mkdir(join(stub, "www", "127.0.0.1:9/m/v9.9.9"), { recursive: true });
    await writeFile(join(stub, "www", "127.0.0.1:9/m/v9.9.9/gascity-mod-9.9.9.tar.gz"), bytes);
    const r = await run(["--gc-bin", "gc"], { script, env: { HERDR_GASCITY_RELEASES_URL: "http://127.0.0.1:9/m" } });
    expect(r.code).toBe(0);
  });

  test("the source copy (not from a release) needs --from", async () => {
    const r = await run([]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("releases/latest/download/install.sh");
    expect(r.calls).toEqual([]);
  });

  test("a tarball without gascity/main.js is refused", async () => {
    await appRunning();
    const bad = await makeTarball(join(base, "bad"), "", { "gascity/main.js": "" });
    await rm(join(base, "bad", "src", "gascity", "main.js"));
    const proc = Bun.spawnSync(["tar", "-czf", bad, "-C", join(base, "bad", "src"), "gascity", "LICENSE"]);
    expect(proc.exitCode).toBe(0);
    const r = await run(["--from", bad, "--gc-bin", "gc"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("gascity/main.js");
    expect(r.calls).toEqual([]);
  });

  test("a missing --from file", async () => {
    const r = await run(["--from", join(base, "nope.tar.gz")]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("nope.tar.gz");
  });
});

describe("arguments", () => {
  for (const bad of ["/usr/bin/tmux", "bin/gc", "./gc", "gcx", "/opt/gc/", "/opt/my\ngc/gc"]) {
    test(`--gc-bin ${JSON.stringify(bad)} is refused before anything runs`, async () => {
      await appRunning();
      const r = await run(["--from", fixture, "--gc-bin", bad]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--gc-bin");
      expect(r.calls).toEqual([]);
    });
  }

  test("--gc-bin naming a missing program is refused", async () => {
    const r = await run(["--from", fixture, "--gc-bin", join(base, "none", "gc")]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("not an executable");
  });

  test("an unknown option, or a missing value", async () => {
    expect((await run(["--frm", fixture])).code).toBe(2);
    expect((await run(["--from"])).code).toBe(2);
    expect((await run(["--gc-bin"])).code).toBe(2);
  });

  test("--help", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--from");
    expect(r.stdout).toContain("--gc-bin");
  });

  test("the app home is HERDR_APP_HOME, else $XDG_CONFIG_HOME/herdr-app, else ~/.config/herdr-app", async () => {
    const xdg = join(base, "xdg");
    expect((await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_APP_HOME: undefined, XDG_CONFIG_HOME: xdg } })).code).toBe(0);
    expect(await readdir(join(xdg, "herdr-app", "mods", "gascity"))).toContain("main.js");
    expect((await run(["--from", fixture, "--gc-bin", "gc"], { env: { HERDR_APP_HOME: undefined } })).code).toBe(0);
    expect(await readdir(join(home, ".config", "herdr-app", "mods", "gascity"))).toContain("main.js");
  });
});

describe("a reinstall with the Gas City tab already open", () => {
  test("selects that tab instead of opening another", async () => {
    await appRunning();
    await reply("ls", `0\n${lsReply([{ id: "pa", machine: null, active: true, tabs: [SHELL_TAB("pa"), { id: "tb-gc", name: "Gas City", terminals: 0 }] }])}\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos).toEqual([["tab.select", "--id", "tb-gc"], ["gascity.set-gc-bin:gc"]]);
  });

  test("a tab named Gas City that holds a terminal, or one on another machine, is not the mod's", async () => {
    await appRunning();
    await reply("ls", `0\n${lsReply([
      { id: "box/pr", machine: "box", active: true, tabs: [{ id: "box/tb-gc", name: "Gas City", terminals: 0 }] },
      { id: "pa", machine: null, active: false, tabs: [{ id: "tb-sh", name: "Gas City", terminals: 1 }] },
    ])}\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(r.dos[0]).toEqual(["tab.new", "--mod", "gascity", "--name", "Gas City", "--space", "pa"]);
  });
});

describe("hostile tarballs", () => {
  /** A tarball with the mod's files plus one hostile member, written by Python's tarfile. */
  async function hostile(kind: string): Promise<string> {
    const out = join(base, `hostile-${kind}.tar.gz`);
    const script = `
import io, sys, tarfile
out, kind = sys.argv[1], sys.argv[2]
def add(t, name, data=b"x", **kw):
    i = tarfile.TarInfo(name); i.size = len(data)
    for k, v in kw.items(): setattr(i, k, v)
    t.addfile(i, io.BytesIO(data) if i.isreg() else None)
with tarfile.open(out, "w:gz") as t:
    add(t, "gascity/main.js", b"// x\\n"); add(t, "gascity/mod.json", b"{}\\n")
    if kind == "symlink": add(t, "gascity/extra.js", b"", type=tarfile.SYMTYPE, linkname="/etc/hostname")
    if kind == "hardlink": add(t, "gascity/extra.js", b"", type=tarfile.LNKTYPE, linkname="gascity/main.js")
    if kind == "device": add(t, "gascity/tty", b"", type=tarfile.CHRTYPE, devmajor=5, devminor=0)
    if kind == "fifo": add(t, "gascity/pipe", b"", type=tarfile.FIFOTYPE)
    if kind == "absolute": add(t, "/tmp/gascity-hostile-absolute", b"x")
    if kind == "dotdot": add(t, "gascity/../../gascity-hostile-dotdot", b"x")
`;
    const p = Bun.spawnSync(["python3", "-I", "-c", script, out, kind]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return out;
  }

  for (const kind of ["symlink", "hardlink", "device", "fifo", "absolute", "dotdot"]) {
    test(`a ${kind} member is refused before anything is unpacked or installed`, async () => {
      await appRunning();
      const r = await run(["--from", await hostile(kind), "--gc-bin", "gc"]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("refused");
      expect(r.calls).toEqual([]);
      expect(await readdir(join(appHome, "mods")).catch(() => [])).toEqual([]);
      expect(await readdir(base)).not.toContain("gascity-hostile-dotdot");
    });
  }

  test("the same tarball without the hostile member installs (the check is not the cause)", async () => {
    await appRunning();
    const r = await run(["--from", await hostile("none"), "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
  });
});

describe("a failed swap", () => {
  test("puts the earlier install back and exits non-zero", async () => {
    await appRunning();
    await mkdir(join(appHome, "mods", "gascity"), { recursive: true });
    await writeFile(join(appHome, "mods", "gascity", "main.js"), "// old build\n");
    // mv fails only when it moves the staged build into place.
    await rm(join(bin, "mv"));
    await writeFile(join(bin, "mv"), `#!/bin/sh\ncase $1 in *.gascity-install.*) echo "mv: cannot move" >&2; exit 1 ;; esac\nexec ${Bun.which("mv")} "$@"\n`);
    await chmod(join(bin, "mv"), 0o755);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot move the new build");
    expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe("// old build\n");
    expect(await modsDir()).toEqual(["gascity"]);
    expect(await readdir(join(appHome, "mod-backups"))).toEqual([]);
    expect(r.dos).toEqual([]);
  });
});

describe("a truncated download of install.sh (curl | sh cut short)", () => {
  test("runs nothing: the body is one function called on the last line", async () => {
    const text = await readFile(INSTALL, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines.at(-1)).toBe('main "$@"');
    await appRunning();
    await mkdir(join(appHome, "mods", "gascity"), { recursive: true });
    await writeFile(join(appHome, "mods", "gascity", "main.js"), "// old build\n");
    for (const share of [0.3, 0.5, 0.7, 0.9]) {
      const cut = join(base, `cut-${share}.sh`);
      await writeFile(cut, lines.slice(0, Math.floor(lines.length * share)).join("\n") + "\n");
      const r = await run(["--from", fixture, "--gc-bin", "gc"], { script: cut });
      expect(r.calls).toEqual([]);
      expect(await modsDir()).toEqual(["gascity"]);
      expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe("// old build\n");
      expect(await readdir(join(appHome, "mod-backups")).catch(() => [])).toEqual([]);
    }
    // Everything but the last line: defines main and stops.
    const all = join(base, "cut-last.sh");
    await writeFile(all, lines.slice(0, -1).join("\n") + "\n");
    const r = await run(["--from", fixture, "--gc-bin", "gc"], { script: all });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });
});

describe("no sha256 tool", () => {
  test("names the missing tools instead of reporting a checksum mismatch", async () => {
    await rm(join(bin, "sha256sum"));
    await writeFile(`${fixture}.sha256`, `${sha256(await readFile(fixture))}  x\n`);
    const r = await run(["--from", fixture, "--gc-bin", "gc"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("needs sha256sum or shasum");
    expect(r.stderr).not.toContain("mismatch");
    expect(r.calls).toEqual([]);
  });
});

describe("the real package", () => {
  test("installs this repo's mod folder as built", async () => {
    await appRunning();
    const out = join(base, "dist");
    const pkg = await packageMod(ROOT, out);
    const r = await run(["--from", pkg.tarball, "--gc-bin", "gc"]);
    expect(r.code).toBe(0);
    expect(await readFile(join(appHome, "mods", "gascity", "main.js"), "utf8")).toBe(await readFile(join(ROOT, "gascity", "main.js"), "utf8"));
    expect(await readFile(join(appHome, "mods", "gascity", "mod.json"), "utf8")).toBe(await readFile(join(ROOT, "gascity", "mod.json"), "utf8"));
    expect(await installed()).not.toContain("RECIPE.md");
  });
});
