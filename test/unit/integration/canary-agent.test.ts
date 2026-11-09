// The canary pack's deterministic agent: what it prints for the lines it
// reads, and the one gc API call it makes (needs sh and curl).

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PACK_DIR } from "../../../canary/city.ts";

const SCRIPT = join(PACK_DIR, "assets", "canary-agent.sh");
const calls: { method: string; path: string; gc: string | null; body: string }[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path, gc: req.headers.get("x-gc-request"), body: await req.text() });
    return path.includes("/bead/gone-1/") ? new Response("{}", { status: 404 }) : Response.json({ ok: true });
  },
});
afterAll(() => void server.stop(true));

async function agent(input: string, env: Record<string, string>): Promise<string[]> {
  const proc = Bun.spawn(["sh", SCRIPT], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GC_ALIAS: "canary.c1", ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(input);
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trimEnd().split("\n");
}

describe("canary-agent.sh", () => {
  const env = () => ({ CANARY_API_URL: `http://127.0.0.1:${server.port}`, CANARY_CITY: "canary" });

  test("closes a bead through gc's API on `close <bead> <nonce>`, ignoring control keys around the text", async () => {
    calls.length = 0;
    const out = await agent("hello\nclose ca-14 n1\x1b\n", env());
    expect(out).toEqual(["CANARY READY canary.c1", "CANARY IGNORED", "CANARY WORKING ca-14", "CANARY DONE ca-14 n1", "CANARY EOF"]);
    expect(calls).toEqual([{ method: "POST", path: "/v0/city/canary/bead/ca-14/close", gc: "herdr-gascity-canary-agent", body: '{"reason":"canary n1"}' }]);
  });

  test("a nonce is optional; a failed close says so", async () => {
    calls.length = 0;
    expect(await agent("close ca-2\nclose gone-1 n\n", env())).toEqual([
      "CANARY READY canary.c1", "CANARY WORKING ca-2", "CANARY DONE ca-2", "CANARY WORKING gone-1", "CANARY FAILED close gone-1: HTTP 404", "CANARY EOF",
    ]);
    expect(calls[0]!.body).toBe('{"reason":"canary"}');
  });

  test("ids that are not plain, extra words and globs are ignored, and nothing is sent", async () => {
    calls.length = 0;
    const out = await agent('close -x\nclose a"b\nclose a b c\nclose *\n', env());
    expect(out.slice(1, -1)).toEqual(["CANARY IGNORED", "CANARY IGNORED", "CANARY IGNORED", "CANARY IGNORED"]);
    expect(calls).toEqual([]);
  });

  test("refuses a gc API that is not on loopback, or no API at all", async () => {
    calls.length = 0;
    expect((await agent("close ca-1\n", { CANARY_API_URL: "http://example.com", CANARY_CITY: "canary" }))[1]).toBe("CANARY FAILED CANARY_API_URL is not a loopback http URL");
    expect((await agent("close ca-1\n", {}))[1]).toBe("CANARY FAILED CANARY_API_URL and CANARY_CITY must be set");
    expect(calls).toEqual([]);
  });
});
