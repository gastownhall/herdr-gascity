// Records real gc responses for the contract fixtures.
//
// Run it when re-pinning, against a THROWAWAY city started from the pinned gc
// build for this purpose: the scenario creates, slings, closes and reopens
// beads, creates/wakes/suspends/kills sessions and suspends agents and a rig.
// Never point it at a city you care about; it refuses unless given
// --throwaway-city.
//
// The scratch city needs: a rig, a city-scoped agent and a rig-scoped agent
// whose sessions run a deterministic program (no LLM), on the subprocess
// session provider and the file bead store.
//
// Usage:
//   bun run test/contract/record.ts --throwaway-city --api http://127.0.0.1:<port> --city <name> \
//     --rig <rig> --agent <city agent> --rig-agent <rig>/<agent> --session <a running session id> \
//     --scratch-root <the directory holding the scratch city, GC_HOME and rig>
//
// Writes test/contract/fixtures/<operationId>/<name>.json:
//   { request: {method, path, query, body?}, status, body }
// where `body` is the parsed JSON (or the raw text when it is not JSON).
// It does not touch fixtures that carry a `provenance` (the synthesized ones
// listed in contract.test.ts SYNTHESIZED).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MOD_VERSION } from "../../src/version.ts";

export const FIXTURES = join(import.meta.dir, "fixtures");

/** One recorded exchange. */
export interface Fixture {
  /** Absent for recorded fixtures; "synthesized: <why>" for the few gc cannot produce in a scratch city. */
  provenance?: string;
  request: { method: string; path: string; query: string; body?: unknown };
  status: number;
  body: unknown;
}

/** Where the scratch city's absolute paths are rewritten to in fixtures. */
export const SCRATCH_ROOT = "/scratch";
/** What a session's instance_token is rewritten to in fixtures. */
export const INSTANCE_TOKEN = "instance-token";

/**
 * Makes a recorded body host-independent: the scratch directory prefix becomes
 * SCRATCH_ROOT and session instance tokens become INSTANCE_TOKEN. Idempotent.
 */
export function normalize(value: unknown, scratchRoot: string): unknown {
  if (typeof value === "string") return scratchRoot && value.includes(scratchRoot) ? value.split(scratchRoot).join(SCRATCH_ROOT) : value;
  if (Array.isArray(value)) return value.map((v) => normalize(v, scratchRoot));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "instance_token" && typeof v === "string" ? INSTANCE_TOKEN : normalize(v, scratchRoot)]));
  }
  return value;
}

interface Args {
  api: string;
  city: string;
  rig: string;
  agent: string;
  rigAgent: string;
  session: string;
  /** The scratch city's top directory, rewritten to SCRATCH_ROOT in fixtures. */
  scratchRoot: string;
}

function parseArgs(argv: string[]): Args {
  if (!argv.includes("--throwaway-city")) {
    throw new Error("refusing to record: this scenario mutates the city. Pass --throwaway-city for a scratch city you started for recording.");
  }
  const get = (name: string) => {
    const at = argv.indexOf(name);
    const v = at >= 0 ? argv[at + 1] : undefined;
    if (!v) throw new Error(`missing ${name}`);
    return v;
  };
  return { api: get("--api"), city: get("--city"), rig: get("--rig"), agent: get("--agent"), rigAgent: get("--rig-agent"), session: get("--session"), scratchRoot: get("--scratch-root") };
}

class Recorder {
  private readonly written: string[] = [];
  constructor(private readonly api: string, private readonly scratchRoot: string) {}

  async send(
    operationId: string,
    name: string,
    method: string,
    path: string,
    opts: { query?: string; body?: unknown; csrf?: boolean; idempotencyKey?: string } = {},
  ): Promise<Fixture> {
    const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
    if (method !== "GET" && opts.csrf !== false) headers["X-GC-Request"] = `herdr-gascity/${MOD_VERSION}`;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const query = opts.query ?? "";
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(`${this.api}${path}${query ? `?${query}` : ""}`, init);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const fixture: Fixture = { request: { method, path, query }, status: res.status, body: normalize(body, this.scratchRoot) };
    if (opts.body !== undefined) fixture.request.body = normalize(opts.body, this.scratchRoot);
    const dir = join(FIXTURES, operationId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify(fixture, null, 2) + "\n");
    this.written.push(`${operationId}/${name} ${res.status}`);
    return fixture;
  }

  report(): string[] {
    return this.written;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function field<T>(f: Fixture, key: string): T {
  const v = (f.body as Record<string, unknown> | null)?.[key];
  if (v === undefined) throw new Error(`${f.request.method} ${f.request.path} -> ${f.status}: no ${key} in ${JSON.stringify(f.body)}`);
  return v as T;
}

/** Polls a 202 request's outcome until it is no longer pending; returns the last answer. */
async function outcome(r: Recorder, c: string, name: string, accepted: Fixture): Promise<Fixture> {
  const id = field<string>(accepted, "request_id");
  const after = field<string>(accepted, "event_cursor");
  for (let i = 0; ; i++) {
    const f = await r.send("get-request-outcome", name, "GET", `${c}/request/${encodeURIComponent(id)}`, { query: `after_seq=${after}` });
    if (f.status !== 200 || field<string>(f, "state") !== "pending" || i >= 20) return f;
    await sleep(500);
  }
}

/** The recording scenario. Fixture names say what each one shows. */
export async function record(a: Args): Promise<string[]> {
  const r = new Recorder(a.api, a.scratchRoot);
  const c = `/v0/city/${encodeURIComponent(a.city)}`;
  const nonce = Date.now().toString(36);
  const [dir, base] = [a.rigAgent.slice(0, a.rigAgent.lastIndexOf("/")), a.rigAgent.slice(a.rigAgent.lastIndexOf("/") + 1)];

  // Reads.
  await r.send("get-health", "ok", "GET", "/health");
  await r.send("get-v0-cities", "ok", "GET", "/v0/cities");
  await r.send("get-v0-city-by-city-name-rigs", "ok", "GET", `${c}/rigs`);
  await r.send("get-v0-city-by-city-name-agents", "ok", "GET", `${c}/agents`);
  await r.send("get-v0-city-by-city-name-sessions", "ok", "GET", `${c}/sessions`, { query: "limit=500" });
  await r.send("get-v0-city-by-city-name-sessions", "wake-reasons", "GET", `${c}/sessions`, { query: `template=${encodeURIComponent(a.agent)}&wake_reasons=true` });
  await r.send("get-v0-city-by-city-name-sessions", "city-not-running", "GET", `/v0/city/no-such-city-${nonce}/sessions`, { query: "limit=500" });
  await r.send("get-v0-city-by-city-name-session-by-id", "peek", "GET", `${c}/session/${encodeURIComponent(a.session)}`, { query: "peek=true&peek_lines=40" });
  await r.send("get-v0-city-by-city-name-session-by-id", "not-found", "GET", `${c}/session/no-such-session-${nonce}`);
  await r.send("get-v0-city-by-city-name-pending", "ok", "GET", `${c}/pending`);
  await r.send("get-v0-city-by-city-name-session-by-id-pending", "none", "GET", `${c}/session/${encodeURIComponent(a.session)}/pending`);
  await r.send("get-v0-city-by-city-name-events", "ok", "GET", `${c}/events`, { query: "limit=50" });
  await r.send("get-v0-city-by-city-name-events", "cursor", "GET", `${c}/events`, { query: "limit=1" });

  // Beads: create, read, sling, close, reopen.
  const created = await r.send("create-bead", "ok", "POST", `${c}/beads`, {
    body: { title: `recorder bead ${nonce}`, description: "recorded for the herdr-gascity contract fixtures", priority: 2 },
    idempotencyKey: `rec-bead-${nonce}`,
  });
  await r.send("create-bead", "validation-failed", "POST", `${c}/beads`, { body: { description: "no title" }, idempotencyKey: `rec-bad-${nonce}` });
  const bead = field<string>(created, "id");
  await r.send("get-v0-city-by-city-name-bead-by-id", "ok", "GET", `${c}/bead/${encodeURIComponent(bead)}`);
  await r.send("get-v0-city-by-city-name-bead-by-id", "not-found", "GET", `${c}/bead/no-such-bead-${nonce}`);
  await r.send("get-v0-city-by-city-name-work-ready", "ready", "GET", `${c}/work/ready`, { query: "limit=50&exclude_type=session&exclude_type=message" });
  await r.send("post-v0-city-by-city-name-sling", "ok", "POST", `${c}/sling`, { body: { target: a.agent, bead } });
  await r.send("get-v0-city-by-city-name-work-ready", "in-progress", "GET", `${c}/work/ready`, { query: "status=in_progress&limit=50" });
  await r.send("post-v0-city-by-city-name-bead-by-id-close", "ok", "POST", `${c}/bead/${encodeURIComponent(bead)}/close`, { body: { reason: `recorded ${nonce}` } });
  await r.send("get-v0-city-by-city-name-work-ready", "closed-seed", "GET", `${c}/work/ready`, { query: "status=closed&sort=newest&limit=20" });
  await r.send("post-v0-city-by-city-name-bead-by-id-reopen", "ok", "POST", `${c}/bead/${encodeURIComponent(bead)}/reopen`);
  await r.send("post-v0-city-by-city-name-bead-by-id-close", "not-found", "POST", `${c}/bead/no-such-bead-${nonce}/close`, { body: { reason: "x" } });

  // Sessions: create (202 + outcome), input, prompt answer without a prompt, lifecycle.
  const made = await r.send("create-session", "accepted", "POST", `${c}/sessions`, {
    body: { kind: "agent", name: a.agent, alias: `rec-${nonce}`, title: "recorder session" },
    idempotencyKey: `rec-session-${nonce}`,
  });
  const createdOutcome = await outcome(r, c, "session-create", made);
  const createdId = field<{ subject?: string }>(createdOutcome, "event").subject;
  if (!createdId) throw new Error(`session create outcome names no session: ${JSON.stringify(createdOutcome.body)}`);
  // An alias that is taken: accepted, then the outcome is request.failed.
  const dup = await r.send("create-session", "alias-taken-accepted", "POST", `${c}/sessions`, {
    body: { kind: "agent", name: a.agent, alias: a.agent },
    idempotencyKey: `rec-dup-${nonce}`,
  });
  await outcome(r, c, "session-create-failed", dup);
  const s = encodeURIComponent(a.session);
  const submitted = await r.send("submit-session", "accepted", "POST", `${c}/session/${s}/submit`, {
    body: { message: `hello ${nonce}`, intent: "default" },
    idempotencyKey: `rec-submit-${nonce}`,
  });
  await outcome(r, c, "session-submit", submitted);
  const messaged = await r.send("send-session-message", "accepted", "POST", `${c}/session/${s}/messages`, {
    body: { message: `note ${nonce}` },
    idempotencyKey: `rec-message-${nonce}`,
  });
  await outcome(r, c, "session-message", messaged);
  await r.send("respond-session", "no-pending", "POST", `${c}/session/${s}/respond`, { body: { action: "approve" }, idempotencyKey: `rec-respond-${nonce}` });
  await r.send("post-v0-city-by-city-name-session-by-id-wake", "csrf-missing", "POST", `${c}/session/${s}/wake`, { csrf: false });
  await r.send("post-v0-city-by-city-name-session-by-id-pin", "ok", "POST", `${c}/session/${s}/pin`);
  await r.send("post-v0-city-by-city-name-session-by-id-unpin", "ok", "POST", `${c}/session/${s}/unpin`);
  await r.send("post-v0-city-by-city-name-session-by-id-stop", "ok", "POST", `${c}/session/${s}/stop`, { idempotencyKey: `rec-stop-${nonce}` });
  await r.send("post-v0-city-by-city-name-session-by-id-suspend", "ok", "POST", `${c}/session/${s}/suspend`, { idempotencyKey: `rec-suspend-${nonce}` });
  await r.send("post-v0-city-by-city-name-session-by-id-wake", "ok", "POST", `${c}/session/${s}/wake`, { idempotencyKey: `rec-wake-${nonce}` });
  const alias = encodeURIComponent(`rec-${nonce}`);
  await r.send("post-v0-city-by-city-name-session-by-id-kill", "ok", "POST", `${c}/session/${alias}/kill`, { idempotencyKey: `rec-kill-${nonce}` });
  await r.send("post-v0-city-by-city-name-session-by-id-close", "ok", "POST", `${c}/session/${alias}/close`, { idempotencyKey: `rec-close-${nonce}` });
  await r.send("post-v0-city-by-city-name-session-by-id-wake", "closed-session-conflict", "POST", `${c}/session/${encodeURIComponent(createdId)}/wake`, { idempotencyKey: `rec-wake-closed-${nonce}` });

  // Agents and rigs.
  await r.send("post-v0-city-by-city-name-agent-by-base-by-action", "suspend", "POST", `${c}/agent/${encodeURIComponent(a.agent)}/suspend`);
  await r.send("post-v0-city-by-city-name-agent-by-base-by-action", "resume", "POST", `${c}/agent/${encodeURIComponent(a.agent)}/resume`);
  await r.send("post-v0-city-by-city-name-agent-by-dir-by-base-by-action", "suspend", "POST", `${c}/agent/${encodeURIComponent(dir)}/${encodeURIComponent(base)}/suspend`);
  await r.send("post-v0-city-by-city-name-agent-by-dir-by-base-by-action", "resume", "POST", `${c}/agent/${encodeURIComponent(dir)}/${encodeURIComponent(base)}/resume`);
  await r.send("post-v0-city-by-city-name-rig-by-name-by-action", "suspend", "POST", `${c}/rig/${encodeURIComponent(a.rig)}/suspend`);
  await r.send("post-v0-city-by-city-name-rig-by-name-by-action", "resume", "POST", `${c}/rig/${encodeURIComponent(a.rig)}/resume`);
  return r.report();
}

if (import.meta.main) {
  for (const line of await record(parseArgs(process.argv.slice(2)))) console.log(line);
}
