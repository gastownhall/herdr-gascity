// The probe writer: compare-and-swap writes of the probe document, only
// while the probe is on, at most one write in flight, a new write only when
// the document changed or a heartbeat is due, and recovery from a write that
// never settles (its copy closed) or a stale snapshot.

import { describe, expect, test } from "bun:test";
import type { GcError } from "../../src/gc/errors.ts";
import {
  PROBE_HEARTBEAT_MS, PROBE_MAX_BYTES, PROBE_WRITE_DEADLINE_MS, ProbeWriter, fitProbe, utf8Bytes, type ProbeIo,
} from "../../src/probe.ts";
import { PROBE_SCHEMA, type ProbeBody } from "../../src/vm/probe.ts";
import { err, ok, type Result } from "../../src/result.ts";
import { flush } from "./sync/fakes.ts";

const PATH = "/app/data/gascity-probe/probe.json";

function fakeIo(initial: string | null = null) {
  let file = initial;
  const calls: string[] = [];
  let hang = false;
  let failNext: string | null = null;
  const io: ProbeIo = {
    path: () => PATH,
    read: (path): Promise<Result<string | null, GcError>> => {
      calls.push(`read ${path}`);
      return Promise.resolve(ok(file));
    },
    write: (path, text, expected): Promise<Result<null, GcError>> => {
      calls.push(`write ${path} expected=${expected === null ? "null" : expected === file ? "current" : "stale"}`);
      if (hang) return new Promise(() => {});
      if (failNext !== null) {
        const m = failNext;
        failNext = null;
        return Promise.resolve(err({ kind: "host-call", api: `writeTextFile(${path})`, cause: m }));
      }
      if (expected !== file) return Promise.resolve(err({ kind: "host-call", api: `writeTextFile(${path})`, cause: "stale snapshot" }));
      file = text;
      return Promise.resolve(ok(null));
    },
  };
  return {
    io, calls,
    file: () => file,
    setFile: (t: string | null) => { file = t; },
    hang: (h: boolean) => { hang = h; },
    failNext: (m: string) => { failNext = m; },
  };
}

const body = (n: number) => ({ schema: "gascity-herdr-probe/3", n }) as never;
/** Two copies, as owners of the file. */
const A = { copy: "a" };
const B = { copy: "b" };

/** A whole probe document. */
function fullBody(over: Partial<ProbeBody> = {}): ProbeBody {
  return {
    schema: PROBE_SCHEMA, mod_version: "0.0.0", herdr_version: "0.1.14", connection: { text: "connected", tone: "ok" }, discovery: null,
    city: "scratch", city_phase: "city-running", visibility: { on_screen: true }, keyboard: false, needs_you: 0, data_age: null,
    sessions: [], board: null, bead_detail: null, detail: null, actions: [], exec_log: [], errors: [], refresh_count: 0, fetch_in_flight_max: 0,
    window: false, notice: null, commands: [],
    ...over,
  };
}

const session = (i: number) => ({
  id: `sc-${i}`, label: `worker ${i} ${"x".repeat(80)}`, agent: "a", group: "city", status: "active", status_kind: "ok", status_source: "gc",
  attached: false, active_bead: null,
});

describe("ProbeWriter", () => {
  test("while the probe is off and there is no file, the file is read once and nothing is written", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.off(1000);
    await flush();
    w.off(1250);
    await flush();
    expect(f.calls).toEqual([`read ${PATH}`]);
  });

  test("the first write reads the file for its compare-and-swap; later writes use what it wrote", async () => {
    const f = fakeIo("old run\n");
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    w.offer(A, body(2), 1100);
    await flush();
    expect(f.calls).toEqual([`read ${PATH}`, `write ${PATH} expected=current`, `write ${PATH} expected=current`]);
    expect(JSON.parse(f.file()!)).toEqual({ schema: "gascity-herdr-probe/3", n: 2, seq: 2, ts: "1970-01-01T00:00:01.100Z" });
  });

  test("an unchanged document is written again only when the heartbeat is due", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    w.offer(A, body(1), 1000 + PROBE_HEARTBEAT_MS - 1);
    await flush();
    expect(f.calls.filter((c) => c.startsWith("write")).length).toBe(1);
    w.offer(A, body(1), 1000 + PROBE_HEARTBEAT_MS);
    await flush();
    expect(f.calls.filter((c) => c.startsWith("write")).length).toBe(2);
  });

  test("one write at a time; one that never settles (its copy closed) is given up after the deadline and the file re-read", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    f.hang(true);
    w.offer(A, body(1), 1000);
    await flush();
    w.offer(A, body(2), 2000);
    await flush();
    expect(f.calls).toEqual([`read ${PATH}`, `write ${PATH} expected=null`]);
    f.hang(false);
    w.offer(A, body(3), 1000 + PROBE_WRITE_DEADLINE_MS + 1);
    await flush();
    expect(f.calls.slice(2)).toEqual([`read ${PATH}`, `write ${PATH} expected=null`]);
    expect(JSON.parse(f.file()!).n).toBe(3);
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "host-call", api: `writeTextFile(${PATH})`, cause: `no answer within ${PROBE_WRITE_DEADLINE_MS} ms` }]);
  });

  test("a rejected write is recorded, and the next one re-reads the file", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    f.setFile("someone else\n");
    w.offer(A, body(2), 1100);
    await flush();
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "host-call", api: `writeTextFile(${PATH})`, cause: "stale snapshot" }]);
    w.offer(A, body(2), 1200);
    await flush();
    expect(f.calls.slice(-2)).toEqual([`read ${PATH}`, `write ${PATH} expected=current`]);
    expect(JSON.parse(f.file()!).n).toBe(2);
  });

  test("one copy owns the file: another copy's documents are not written until the owner closes", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    for (let t = 1250; t < 4000; t += 250) {
      w.offer(B, body(t), t);
      await flush();
      w.offer(A, body(1), t);
      await flush();
    }
    expect(f.calls.filter((c) => c.startsWith("write")).length).toBe(1);
    expect(JSON.parse(f.file()!).n).toBe(1);
    w.release(A);
    w.offer(B, body(2), 4000);
    await flush();
    expect(JSON.parse(f.file()!).n).toBe(2);
    // B owns it now: A (were it still open) is not written
    w.offer(A, body(3), 4250);
    await flush();
    expect(JSON.parse(f.file()!).n).toBe(2);
  });

  test("when the probe goes off the file is emptied with a compare-and-swap write, once; on again writes over the empty file", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    w.off(1250);
    await flush();
    expect(f.file()).toBe("");
    expect(f.calls.at(-1)).toBe(`write ${PATH} expected=current`);
    const calls = f.calls.length;
    w.off(1500);
    w.off(1750);
    await flush();
    expect(f.calls.length).toBe(calls);
    w.offer(A, body(2), 2000);
    await flush();
    expect(JSON.parse(f.file()!).n).toBe(2);
    expect(f.calls.at(-1)).toBe(`write ${PATH} expected=current`);
  });

  test("a probe file left by an earlier run is emptied when the probe is off; an empty file is left alone", async () => {
    const f = fakeIo('{"schema":"gascity-herdr-probe/3","detail":{"output":"secret"}}\n');
    const w = new ProbeWriter(f.io);
    w.off(1000);
    await flush();
    expect(f.file()).toBe("");
    const g = fakeIo("");
    const v = new ProbeWriter(g.io);
    v.off(1000);
    await flush();
    expect(g.calls).toEqual([`read ${PATH}`]);
  });

  test("emptying a file that changed meanwhile fails the compare-and-swap, is recorded, and is retried with a fresh read", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(A, body(1), 1000);
    await flush();
    f.setFile("someone else\n");
    w.off(1250);
    await flush();
    expect(f.file()).toBe("someone else\n");
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "host-call", api: `writeTextFile(${PATH})`, cause: "stale snapshot" }]);
    w.off(1500);
    await flush();
    expect(f.file()).toBe("");
  });

  test("a document over herdr's 1 MiB limit drops the free text first, says so in the file, and is recorded once", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    const big = (n: number) => fullBody({
      refresh_count: n,
      detail: { session: "sc-1", status: "active", output: "o".repeat(PROBE_MAX_BYTES), wake_reasons: "", pending: { kind: "none" } },
      sessions: [session(1)],
    });
    w.offer(A, big(1), 1000);
    await flush();
    w.offer(A, big(2), 1250);
    await flush();
    const text = f.file()!;
    expect(utf8Bytes(text)).toBeLessThanOrEqual(PROBE_MAX_BYTES);
    const doc = JSON.parse(text);
    expect(doc.refresh_count).toBe(2);
    expect(doc.detail).toEqual({ session: "sc-1", status: "active", output: null, wake_reasons: "", pending: null });
    expect(doc.truncated).toEqual(["detail.output", "detail.pending"]);
    expect(doc.sessions.length).toBe(1);
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "probe-truncated", limitBytes: PROBE_MAX_BYTES, dropped: ["detail.output", "detail.pending"] }]);
  });

  test("the limit counts UTF-8 bytes, not characters", () => {
    const body = fullBody({ bead_detail: { id: "b", title: "t", state: "open", close_reason: null, description: "é".repeat(600_000) } });
    const fitted = fitProbe(body, { seq: 1, ts: "t" });
    expect(fitted.truncated).toEqual(["bead_detail.description"]);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("\u{1F600}")).toBe(4);
    expect(utf8Bytes("東")).toBe(3);
  });

  test("lists too long to fit are halved until the document fits, keeping the most relevant half", () => {
    const sessions = Array.from({ length: 20_000 }, (_, i) => session(i));
    const exec_log = Array.from({ length: 4 }, (_, i) => ({ at: i, kind: "exec", argv: [`n${i}`] }));
    const fitted = fitProbe(fullBody({ sessions, exec_log }), { seq: 1, ts: "t" });
    expect(utf8Bytes(fitted.text)).toBeLessThanOrEqual(PROBE_MAX_BYTES);
    const doc = JSON.parse(fitted.text);
    expect(doc.sessions[0].id).toBe("sc-0");
    const halvings = Math.log2(20_000 / doc.sessions.length);
    expect(Number.isInteger(halvings) && halvings >= 1).toBe(true);
    // one halving fewer would not have fitted
    expect(utf8Bytes(JSON.stringify(sessions.slice(0, doc.sessions.length * 2), null, 2))).toBeGreaterThan(PROBE_MAX_BYTES - 2_000);
    // the exec log keeps its newest entries (it is newest last)
    expect(doc.exec_log.map((e: { argv: string[] }) => e.argv[0])).toEqual(halvings === 1 ? ["n2", "n3"] : halvings === 2 ? ["n3"] : []);
    expect(doc.truncated).toEqual([`every list halved ${halvings} times (sessions 20000, actions 0, exec_log 4, errors 0 -> sessions ${doc.sessions.length}, actions 0, exec_log ${doc.exec_log.length}, errors 0)`]);
  });

  test("a document that cannot fit even with empty lists keeps only the schema, the versions and what was cut", () => {
    const fitted = fitProbe(fullBody({ city: "c".repeat(PROBE_MAX_BYTES) }), { seq: 7, ts: "t" });
    expect(JSON.parse(fitted.text)).toEqual({
      schema: PROBE_SCHEMA, mod_version: "0.0.0", herdr_version: "0.1.14", truncated: ["everything but the schema and versions"], seq: 7, ts: "t",
    });
  });
});
