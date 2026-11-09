// The integration run's stand-ins for herdr: the tab wrapper and program
// naming (against herdr-app's recorded terminal records), the constrained
// fetch, and the exec allowlist.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execAllowed, FetchMeter, herdrFetch, HERDR_FETCH_MAX_BYTES, redirectRefusal } from "../../integration/herdr.ts";
import { programOf, PtyTerminals, wrapperArgv } from "../../integration/terminals.ts";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "terminals");

describe("herdr's tab wrapper", () => {
  test("is what herdr-app recorded for an attach tab", () => {
    const scene = JSON.parse(readFileSync(join(FIXTURES, "attach-running.json"), "utf8")) as { terminals: { address: string; argv: string[] }[] };
    const recorded = scene.terminals.find((t) => t.address === "t7")!.argv;
    expect(wrapperArgv("/bin/zsh", recorded.slice(4))).toEqual(recorded);
  });

  test("login shells use -lic and exec a login shell; fish has its own script", () => {
    expect(wrapperArgv("/bin/zsh", ["gc"], true)).toEqual(["/bin/zsh", "-lic", '"$@"; exec "$0" -li', "/bin/zsh", "gc"]);
    expect(wrapperArgv("/usr/bin/fish", ["gc"]).slice(0, 3)).toEqual(["/usr/bin/fish", "-ic", "command $argv[2..]; exec $argv[1] -i"]);
  });

  test("program naming unwraps the wrapper, names shells, and calls anything else a program", () => {
    expect(programOf(wrapperArgv("/bin/bash", ["env", "-u", "HC_SCOPE", "gc"]))).toEqual({ key: "program", name: "env", shell: false });
    expect(programOf(["gc", "--city", "/c", "session", "attach", "s"])).toEqual({ key: "program", name: "gc", shell: false });
    expect(programOf(["/bin/bash", "-i"])).toEqual({ key: "shell", name: "bash", shell: true });
    expect(programOf(["-zsh"])).toEqual({ key: "shell", name: "zsh", shell: true });
    expect(programOf([])).toEqual({ key: "shell", name: null, shell: true });
  });
});

describe("the exec allowlist", () => {
  test("only <gc> supervisor status --json", () => {
    expect(execAllowed("gc", ["supervisor", "status", "--json"])).toBe(true);
    expect(execAllowed("/opt/bin/gc", ["supervisor", "status", "--json"])).toBe(true);
    expect(execAllowed("gc", ["session", "attach", "s"])).toBe(false);
    expect(execAllowed("tmux", ["supervisor", "status", "--json"])).toBe(false);
    expect(execAllowed("/opt/bin/gcx", ["supervisor", "status", "--json"])).toBe(false);
  });
});

describe("herdr's constrained fetch", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/slow") {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response("late");
      }
      if (u.pathname === "/to-echo") return new Response(null, { status: 307, headers: { location: "/echo" } });
      if (u.pathname === "/see-other") return new Response(null, { status: 303, headers: { location: "/echo" } });
      if (u.pathname === "/elsewhere") return new Response(null, { status: 302, headers: { location: `http://localhost:${u.port}/echo` } });
      if (u.pathname === "/loop") return new Response(null, { status: 302, headers: { location: "/loop" } });
      if (u.pathname === "/big") return new Response("x".repeat(HERDR_FETCH_MAX_BYTES + 1));
      if (u.pathname === "/echo") return Response.json({ method: req.method, gc: req.headers.get("x-gc-request"), body: await req.text() }, { headers: { "x-gc-index": "7" } });
      return new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  afterAll(() => void server.stop(true));

  test("answers status, ok, url, text() and json(), and no headers", async () => {
    const meter = new FetchMeter();
    const r = await herdrFetch(meter)(`${base}/echo`, { method: "post", headers: { "X-GC-Request": "t" }, body: "hi" });
    expect(Object.keys(r).sort()).toEqual(["json", "ok", "status", "text", "url"]);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ method: "POST", gc: "t", body: "hi" });
    expect(meter.log).toHaveLength(1);
    expect(meter.log[0]!.status).toBe(200);
    expect(meter.inFlight).toBe(0);
  });

  test("refuses options and headers herdr refuses", async () => {
    const f = herdrFetch(new FetchMeter());
    await expect(f(`${base}/echo`, { signal: null })).rejects.toThrow("unknown option `signal`");
    await expect(f(`${base}/echo`, { headers: { Connection: "close" } })).rejects.toThrow("may not set `Connection`");
    await expect(f(`${base}/echo`, { headers: { "X-N": 1 } })).rejects.toThrow("string header values");
    await expect(f(`${base}/echo`, { method: "POST", body: "x".repeat(HERDR_FETCH_MAX_BYTES + 1) })).rejects.toThrow("request body exceeded");
  });

  test("times out with herdr's words, and caps the response", async () => {
    const meter = new FetchMeter();
    await expect(herdrFetch(meter, 200)(`${base}/slow`)).rejects.toThrow("operation timed out");
    expect(meter.log[0]!.error).toContain("operation timed out");
    await expect(herdrFetch(meter)(`${base}/big`)).rejects.toThrow(`exceeded the ${HERDR_FETCH_MAX_BYTES} byte limit`);
  });

  test("meters requests in flight together", async () => {
    const meter = new FetchMeter();
    const f = herdrFetch(meter);
    await Promise.all([f(`${base}/slow`), f(`${base}/slow`), f(`${base}/echo`)]);
    expect(meter.max).toBe(3);
    expect(meter.maxConcurrentBetween(0)).toBe(3);
    expect(meter.inFlight).toBe(0);
  });

  test("follows redirects as herdr does: same origin, 303 to GET, at most 10", async () => {
    const f = herdrFetch(new FetchMeter());
    const kept = await f(`${base}/to-echo`, { method: "POST", headers: { "X-GC-Request": "t" }, body: "b" });
    expect(await kept.json()).toEqual({ method: "POST", gc: "t", body: "b" });
    expect(kept.url).toBe(`${base}/echo`);
    const got = await f(`${base}/see-other`, { method: "POST", body: "b" });
    expect(await got.json()).toEqual({ method: "GET", gc: null, body: "" });
    await expect(f(`${base}/loop`)).rejects.toThrow("redirect limit");
  });

  test("refuses a cross-origin redirect that would replay a method or headers", async () => {
    const f = herdrFetch(new FetchMeter());
    await expect(f(`${base}/elsewhere`, { method: "PUT", body: "b" })).rejects.toThrow("would replay a PUT request");
    await expect(f(`${base}/elsewhere`, { headers: { "X-GC-Request": "t" } })).rejects.toThrow("caller-supplied request headers would be replayed");
    expect(await (await f(`${base}/elsewhere`)).json()).toEqual({ method: "GET", gc: null, body: "" });
    expect(redirectRefusal("https://a/x", "http://a/y", "GET", {})).toContain("HTTPS downgrade");
    expect(redirectRefusal("http://a/x", "http://b/y", "GET", { Authorization: "x" })).toContain("carries Authorization");
  });

  test("a refused connection rejects with reqwest's shape", async () => {
    const meter = new FetchMeter();
    await expect(herdrFetch(meter)("http://127.0.0.1:9/x")).rejects.toThrow("fetching http://127.0.0.1:9/x failed: error sending request for url");
  });
});

describe("PTY terminals", () => {
  test("a terminal whose wrapper has ended is reported finished, as herdr does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hg-pty-"));
    const terms = new PtyTerminals({ env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, shell: "/bin/sh", cwd: dir, logDir: dir, runId: "unit" });
    // `exit` as the program: the wrapper's shell runs it and ends before it would exec an interactive shell.
    const t = terms.launch(["exit", "0"], { tab: "t2", space: "s1" });
    await t.proc.exited;
    const r = terms.record(t);
    expect(r.state).toBe("finished");
    expect(r.labels).toEqual({ "herdr.space": "s1", "herdr.tab": "t2" });
    expect(t.scope).toMatch(/^m7-unit-[0-9a-f]{16}$/);
    await terms.killAll();
  });
});
