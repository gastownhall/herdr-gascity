// The probe writer: compare-and-swap writes of the probe document, only
// while the probe is on, at most one write in flight, a new write only when
// the document changed or a heartbeat is due, and recovery from a write that
// never settles (its copy closed) or a stale snapshot.

import { describe, expect, test } from "bun:test";
import type { GcError } from "../../src/gc/errors.ts";
import { PROBE_HEARTBEAT_MS, PROBE_WRITE_DEADLINE_MS, ProbeWriter, type ProbeIo } from "../../src/probe.ts";
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

describe("ProbeWriter", () => {
  test("nothing is read or written while the probe is off", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(body(1), 1000, false);
    await flush();
    expect(f.calls).toEqual([]);
  });

  test("the first write reads the file for its compare-and-swap; later writes use what it wrote", async () => {
    const f = fakeIo("old run\n");
    const w = new ProbeWriter(f.io);
    w.offer(body(1), 1000, true);
    await flush();
    w.offer(body(2), 1100, true);
    await flush();
    expect(f.calls).toEqual([`read ${PATH}`, `write ${PATH} expected=current`, `write ${PATH} expected=current`]);
    expect(JSON.parse(f.file()!)).toEqual({ schema: "gascity-herdr-probe/3", n: 2, seq: 2, ts: "1970-01-01T00:00:01.100Z" });
  });

  test("an unchanged document is written again only when the heartbeat is due", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(body(1), 1000, true);
    await flush();
    w.offer(body(1), 1000 + PROBE_HEARTBEAT_MS - 1, true);
    await flush();
    expect(f.calls.filter((c) => c.startsWith("write")).length).toBe(1);
    w.offer(body(1), 1000 + PROBE_HEARTBEAT_MS, true);
    await flush();
    expect(f.calls.filter((c) => c.startsWith("write")).length).toBe(2);
  });

  test("one write at a time; one that never settles (its copy closed) is given up after the deadline and the file re-read", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    f.hang(true);
    w.offer(body(1), 1000, true);
    await flush();
    w.offer(body(2), 2000, true);
    await flush();
    expect(f.calls).toEqual([`read ${PATH}`, `write ${PATH} expected=null`]);
    f.hang(false);
    w.offer(body(3), 1000 + PROBE_WRITE_DEADLINE_MS + 1, true);
    await flush();
    expect(f.calls.slice(2)).toEqual([`read ${PATH}`, `write ${PATH} expected=null`]);
    expect(JSON.parse(f.file()!).n).toBe(3);
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "host-call", api: `writeTextFile(${PATH})`, cause: `no answer within ${PROBE_WRITE_DEADLINE_MS} ms` }]);
  });

  test("a rejected write is recorded, and the next one re-reads the file", async () => {
    const f = fakeIo();
    const w = new ProbeWriter(f.io);
    w.offer(body(1), 1000, true);
    await flush();
    f.setFile("someone else\n");
    w.offer(body(2), 1100, true);
    await flush();
    expect(w.errors().map((e) => e.error)).toEqual([{ kind: "host-call", api: `writeTextFile(${PATH})`, cause: "stale snapshot" }]);
    w.offer(body(2), 1200, true);
    await flush();
    expect(f.calls.slice(-2)).toEqual([`read ${PATH}`, `write ${PATH} expected=current`]);
    expect(JSON.parse(f.file()!).n).toBe(2);
  });
});
