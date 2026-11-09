// The engine-parity probe: the gc client, the decoders
// and the host schemas, bundled exactly as the mod bundles them, run over
// every recorded fixture. parity.test.ts runs this same bundle in bun and in
// QuickJS (quickjs-ng) with the Function constructor and eval poisoned, and
// requires identical results.

import { createGcClient, type HostFetch } from "../../src/gc/client.ts";
import { unrecognizedIn } from "../../src/gc/decode.ts";
import { outcomeFailure } from "../../src/gc/errors.ts";
import { OPERATIONS, type OperationId } from "../../src/gc/operations.gen.ts";
import type { RequestOutcome } from "../../src/gc/types.gen.ts";
import { jitlessEnabled } from "../../src/gc/zod.ts";
import { decodeTerminals } from "../../src/host.schemas.ts";
import { SyncRegistry, TICK_MS } from "../../src/sync/registry.ts";
import type { EventBatch } from "../../src/sync/store.ts";
import { agentsModel } from "../../src/vm/agents.ts";
import { beadDetailModel, boardModel } from "../../src/vm/board.ts";
import { detailModel } from "../../src/vm/detail.ts";
import { errorText } from "../../src/vm/errorText.ts";
import { cleanLine, cleanText } from "../../src/vm/sanitize.ts";

/** One fixture as the test passes it in. */
export interface ProbeFixture {
  op: string;
  name: string;
  status: number;
  body: unknown;
}

/** What the probe reports per fixture: enough to compare engines exactly. */
export interface ProbeResult {
  fixture: string;
  ok: boolean;
  summary: unknown;
}

async function one(f: ProbeFixture): Promise<ProbeResult> {
  const op = f.op as OperationId;
  const fetch: HostFetch = (url) =>
    Promise.resolve({ status: f.status, ok: f.status >= 200 && f.status < 300, url, text: () => Promise.resolve(JSON.stringify(f.body)) });
  const made = createGcClient({ baseUrl: "http://127.0.0.1:8372", fetch, now: () => 0 });
  if (!made.ok) return { fixture: `${f.op}/${f.name}`, ok: false, summary: made.error };
  const meta = OPERATIONS[op];
  const path: Record<string, string> = {};
  for (const p of meta.pathParams) path[p] = p === "action" ? "suspend" : "x";
  const r = await made.value.call(op, { path, query: {}, body: meta.body ? {} : undefined, idempotencyKey: "k" } as never);
  if (!r.ok) return { fixture: `${f.op}/${f.name}`, ok: false, summary: r.error };
  const outcome = op === "get-request-outcome" ? outcomeFailure(r.value as RequestOutcome) : null;
  return { fixture: `${f.op}/${f.name}`, ok: true, summary: { value: r.value, unrecognized: unrecognizedIn(r.value), outcome } };
}

/** Lets queued promise reactions run (no setImmediate in QuickJS). */
async function settle(): Promise<void> {
  for (let i = 0; i < 400; i++) await Promise.resolve();
}

/**
 * The sync engine on an injected clock, serving the recorded fixtures: two
 * copies of one city, a driver hand-off, events that invalidate (a bead
 * closes: it leaves Ready and heads Recently closed), a watched bead, and a
 * gc outage with backoff. Reports what it requested and what it holds.
 */
async function syncScenario(fixtures: ProbeFixture[]): Promise<unknown> {
  let now = 1_000_000;
  // Each open copy ticks its subscription every TICK_MS, as main.ts will from its own timer.
  const ticking = new Set<{ tick(): number }>();
  const advance = async (ms: number) => {
    const target = now + ms;
    await settle();
    while (now + TICK_MS <= target) {
      now += TICK_MS;
      for (const sub of ticking) sub.tick();
      await settle();
    }
    now = target;
    await settle();
  };
  const body = (op: string, name: string) => fixtures.find((f) => f.op === op && f.name === name)?.body;
  const events: { seq: number; type: string; subject: string }[] = [{ seq: 1, type: "order.fired", subject: "gate-sweep" }];
  const closedIds = () => new Set(events.filter((e) => e.type === "bead.closed").map((e) => e.subject));
  const paths: string[] = [];
  let down = false;
  const fetch: HostFetch = (url) => {
    const path = url.replace("http://127.0.0.1:8372", "");
    paths.push(path);
    if (down) return Promise.reject(new Error("error sending request: connection refused"));
    let reply: unknown = { items: [], total: 0 };
    if (path.includes("/events")) {
      const limit = Number(/limit=(\d+)/.exec(path)?.[1] ?? "50");
      const items = [...events].reverse().slice(0, limit).map((e) => ({ ...e, ts: "t", actor: "a", payload: {} }));
      reply = { items, total: events.at(-1)?.seq ?? 0 };
    } else if (path.includes("/sessions")) reply = body("get-v0-city-by-city-name-sessions", "ok");
    else if (path.includes("/rigs")) reply = body("get-v0-city-by-city-name-rigs", "ok");
    else if (path.includes("/agents")) reply = body("get-v0-city-by-city-name-agents", "ok");
    else if (path.includes("/work/ready")) {
      const page = body("get-v0-city-by-city-name-work-ready", path.includes("closed") ? "closed-seed" : "ready") as { items: { id: string }[] };
      reply = path.includes("closed") ? page : { items: page.items.filter((x) => !closedIds().has(x.id)) };
    } else if (path.includes("/bead/")) {
      const id = path.split("/").at(-1) ?? "";
      const closed = closedIds().has(id) ? { status: "closed", close_reason: "closed\u0007 in the scenario" } : {};
      reply = { ...(body("get-v0-city-by-city-name-bead-by-id", "ok") as object), id, ...closed };
    }
    const text = JSON.stringify(reply);
    return Promise.resolve({ status: 200, ok: true, url, text: () => Promise.resolve(text) });
  };
  const registry = new SyncRegistry({ fetch, clock: { now: () => now }, random: () => 0.5 });
  registry.setOnScreen(true);
  const batches: EventBatch[] = [];
  registry.onEvents((b) => batches.push(b));
  const a = registry.subscribe({ apiUrl: "http://127.0.0.1:8372", city: "scratch" });
  const b = registry.subscribe({ apiUrl: "http://127.0.0.1:8372", city: "scratch" });
  if (!a.ok || !b.ok) return { error: "subscribe" };
  ticking.add(a.value);
  ticking.add(b.value);
  a.value.tick();
  await advance(0);
  const initial = paths.length;
  events.push({ seq: 2, type: "bead.closed", subject: "sc-74" }, { seq: 3, type: "session.woke", subject: "sc-20" });
  await advance(2500);
  ticking.delete(a.value);
  a.value.unsubscribe();
  events.push({ seq: 4, type: "bead.updated", subject: "fe-1" });
  await advance(2500);
  down = true;
  await advance(20_000);
  const outage = b.value.snapshot().connection;
  down = false;
  const releaseBead = b.value.watchBead("sc-74");
  await advance(40_000);
  const s = b.value.snapshot();
  const agents = agentsModel({ snapshot: s, now, selected: "sc-20", collapsed: new Set() });
  const detail = detailModel({ snapshot: s, now, selected: "sc-20" });
  const board = boardModel({ snapshot: s, now, selected: "sc-74" });
  const beadDetail = beadDetailModel({ snapshot: s, now, selected: "sc-74" });
  releaseBead();
  b.value.unsubscribe();
  return {
    agents,
    detail,
    board,
    beadDetail,
    sanitized: [
      cleanLine("a\u0000b\u001b[31mc\u001b]8;;http://x\u0007d\u202ee\r\nf"),
      cleanText("\u001b[1mline\u001b[0m\r\nnext\u0007"),
      errorText({ kind: "cancelled", url: "http://127.0.0.1:8372/health", reason: "copy-closed" }),
    ],
    initial,
    paths,
    batches: batches.map((x) => ({ seqs: x.events.map((e) => e.seq), resync: x.resync })),
    cursor: s.events.cursor,
    closed: s.closed.recent.map((c) => [c.seq, c.bead.id]),
    sessions: s.sessions.value?.items.map((x) => x.id),
    outage,
    connection: s.connection,
    errors: s.errors.length,
    budget: registry.budgetStats(),
    stores: registry.storeCount(),
  };
}

/** Runs every fixture, plus a malformed body and a host-data decode, and reports the results as JSON. */
export async function run(fixturesJson: string): Promise<string> {
  const fixtures = JSON.parse(fixturesJson) as ProbeFixture[];
  const results: ProbeResult[] = [];
  for (const f of fixtures) results.push(await one(f));
  results.push(await one({ op: "get-health", name: "malformed", status: 200, body: { status: "ok" } }));
  results.push({
    fixture: "host/terminals",
    ok: true,
    summary: decodeTerminals([{ address: "t1", argv: ["sh"], labels: {}, state: "live", program: { shell: true } }, { address: 2 }]),
  });
  const sync = await syncScenario(fixtures);
  return JSON.stringify({ jitless: jitlessEnabled(), results, sync });
}

(globalThis as { __gcEngineProbe?: { run: typeof run } }).__gcEngineProbe = { run };
