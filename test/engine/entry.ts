// The engine-parity probe (design §13.1, risk 3): the gc client, the decoders
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
  return JSON.stringify({ jitless: jitlessEnabled(), results });
}

(globalThis as { __gcEngineProbe?: { run: typeof run } }).__gcEngineProbe = { run };
