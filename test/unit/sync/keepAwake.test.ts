// Keep-awake for the open session pane: the pane pins its session through gc
// while it is open and unpins it when it closes, and only ever unpins a pin it
// made itself. The pins it made are kept in an app-wide shared ledger, so a
// pin left by a crash (or by a copy that closed before its unpin went out) is
// released at the next start.

import { afterEach, describe, expect, test } from "bun:test";
import type * as T from "../../../src/gc/types.gen.ts";
import { sessionPin, sessionUnpin } from "../../../src/actions/session.ts";
import { decodeOwnPins, pinDecision, type OwnPin } from "../../../src/sync/keepAwake.ts";
import { keepAwakeText } from "../../../src/vm/detail.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../../src/sync/registry.ts";
import type { WakeReasons } from "../../../src/sync/store.ts";
import { FakeGc, FakeHost, fixtureBody, type FakeReply, type Owner } from "./fakes.ts";

const API = "http://127.0.0.1:8372";
const CITY = "scratch";

function row(over: Partial<T.SessionResponse> = {}): T.SessionResponse {
  const items = (fixtureBody("get-v0-city-by-city-name-sessions", "wake-reasons") as { items: T.SessionResponse[] }).items;
  return { ...items[0]!, ...over };
}

function wake(reasons: string[], over: Partial<T.SessionResponse> = {}): WakeReasons {
  return { listed: true, reasons, session: row(over) };
}

describe("pinDecision", () => {
  test("a running, active session gc lists without a lifecycle reason and without a pin is pinned", () => {
    expect(pinDecision(wake(["session", "config"]))).toEqual({ pin: true });
  });

  test("a session someone already pinned is left alone", () => {
    expect(pinDecision(wake(["session", "pin"]))).toEqual({ pin: false, why: "already pinned in gc (not by this pane): left as it is" });
  });

  test("gc's lifecycle reason hides the pin: not pinned, and the reason is said", () => {
    expect(pinDecision(wake([], { reason: "held" }))).toEqual({ pin: false, why: "gc shows held, which hides whether it is pinned: not pinned" });
  });

  test("a session that is not running, or not active, is not pinned", () => {
    expect(pinDecision(wake([], { running: false }))).toEqual({ pin: false, why: "not running: not pinned" });
    expect(pinDecision(wake([], { state: "suspended" }))).toEqual({ pin: false, why: "suspended: not pinned" });
  });

  test("a session gc did not list cannot be read, so it is not pinned", () => {
    expect(pinDecision({ listed: false, reasons: [], session: null }))
      .toEqual({ pin: false, why: "gc did not list it under its template, so whether it is pinned cannot be read: not pinned" });
  });
});

describe("decodeOwnPins", () => {
  test("nothing stored is no pins", () => {
    expect(decodeOwnPins(undefined)).toEqual({ pins: [], unreadable: 0 });
    expect(decodeOwnPins(null)).toEqual({ pins: [], unreadable: 0 });
  });

  test("entries that cannot be read are counted, not guessed", () => {
    const good: OwnPin = { apiUrl: API, city: CITY, session: "sc-20" };
    expect(decodeOwnPins([good, { apiUrl: API }, 7])).toEqual({ pins: [good], unreadable: 2 });
    expect(decodeOwnPins("x")).toEqual({ pins: [], unreadable: 1 });
  });
});

describe("keepAwakeText", () => {
  test("says what the pane did", () => {
    expect(keepAwakeText(null)).toBe("Keep awake: not watched");
    expect(keepAwakeText({ kind: "checking" })).toBe("Keep awake: reading gc's wake reasons");
    expect(keepAwakeText({ kind: "pinning" })).toBe("Keep awake: pinning");
    expect(keepAwakeText({ kind: "pinned" })).toBe("Keep awake: pinned by this pane until it closes");
    expect(keepAwakeText({ kind: "not-pinned", why: "not running: not pinned" })).toBe("Keep awake: not running: not pinned");
    expect(keepAwakeText({ kind: "failed", error: { kind: "timeout", url: "http://127.0.0.1:8372/x", ms: 30_000 } }))
      .toBe("Keep awake: failed: no answer from http://127.0.0.1:8372/x within 30 s");
  });
});

// ---- through the registry, against a fake gc ------------------------------------

interface Copy {
  owner: Owner;
  sub: Subscription;
}

let live: Copy[] = [];

afterEach(() => {
  for (const c of live) c.sub.unsubscribe();
  live = [];
});

interface SetupOpts {
  stored?: unknown;
  wakeReasons?: string[];
  row?: Partial<T.SessionResponse>;
  /** gc's answer to a pin or an unpin; read at the time of each request. */
  pin?: FakeReply;
  unpin?: FakeReply;
}

function setup(opts: SetupOpts = {}) {
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  let stored: unknown = opts.stored;
  const writes: unknown[] = [];
  gc.override = (req) => {
    if (req.method === "POST" && req.path.endsWith("/pin")) return opts.pin ?? { status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-pin", "ok") };
    if (req.method === "POST" && req.path.endsWith("/unpin")) return opts.unpin ?? { status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-unpin", "ok") };
    if (req.query.get("wake_reasons") === "true" && (opts.wakeReasons || opts.row)) {
      const body = fixtureBody("get-v0-city-by-city-name-sessions", "wake-reasons") as { items: T.SessionResponse[] };
      return { status: 200, body: { ...body, items: body.items.map((x) => ({ ...x, ...opts.row, wake_reasons: opts.wakeReasons ?? x.wake_reasons })) } };
    }
    return undefined;
  };
  const reg = new SyncRegistry({
    fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5,
    pins: {
      read: () => stored,
      write: (v) => {
        stored = v;
        writes.push(v);
      },
    },
  });
  reg.setOnScreen(true);
  let n = 0;
  const open = async (): Promise<Copy> => {
    const owner = `copy-${++n}`;
    let copy: Copy | null = null;
    await host.run(owner, () => {
      const made = reg.subscribe({ apiUrl: API, city: CITY });
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      const c: Copy = { owner, sub: made.value };
      c.sub.tick();
      host.every(TICK_MS, () => c.sub.tick());
      copy = c;
    });
    await host.runTurns();
    if (!copy) throw new Error("open");
    live.push(copy);
    return copy;
  };
  /** Runs `body` in the copy's own turn (a click). */
  const inTurn = (c: Copy, body: () => void) => host.run(c.owner, body);
  const close = (c: Copy) => host.close(c.owner, () => c.sub.unsubscribe());
  const posts = (suffix: string, since = 0) => gc.seen.slice(since).filter((r) => r.method === "POST" && r.path.endsWith(suffix)).length;
  return { host, gc, open, inTurn, close, posts, stored: () => stored, writes, reg };
}

describe("keep-awake through the registry", () => {
  test("opening the pane pins an eligible session and records the pin; closing it unpins and forgets it", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(t.posts("/session/sc-20/pin")).toBe(1);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    expect(t.stored()).toEqual([{ apiUrl: API, city: CITY, session: "sc-20" }]);
    await t.inTurn(a, () => release());
    await t.host.advance(1000);
    expect(t.posts("/session/sc-20/unpin")).toBe(1);
    expect(t.stored()).toEqual([]);
    expect(a.sub.keepAwake("sc-20")).toBeNull();
  });

  test("the pin is recorded before it is sent, so a crash while it is in flight still leaves a pin to release", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    const pinAt = t.gc.seen.findIndex((r) => r.method === "POST" && r.path.endsWith("/pin"));
    expect(pinAt).toBeGreaterThan(-1);
    expect(t.writes[0]).toEqual([{ apiUrl: API, city: CITY, session: "sc-20" }]);
  });

  test("a session someone already pinned: no pin, and no unpin when the pane closes", async () => {
    const t = setup({ wakeReasons: ["session", "pin"] });
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "not-pinned", why: "already pinned in gc (not by this pane): left as it is" });
    await t.inTurn(a, () => release());
    await t.host.advance(2000);
    expect(t.posts("/pin")).toBe(0);
    expect(t.posts("/unpin")).toBe(0);
    expect(t.stored()).toBeUndefined();
  });

  test("a session with a lifecycle reason is not pinned", async () => {
    const t = setup({ row: { reason: "quarantined" } });
    const a = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    expect(t.posts("/pin")).toBe(0);
    expect(a.sub.keepAwake("sc-20")).toMatchObject({ kind: "not-pinned" });
  });

  test("a pin left from an earlier run is released at start; other cities' pins are left to their stores", async () => {
    const other: OwnPin = { apiUrl: API, city: "elsewhere", session: "x-1" };
    const t = setup({ stored: [{ apiUrl: API, city: CITY, session: "sc-7" }, other] });
    await t.open();
    await t.host.advance(2000);
    expect(t.posts("/session/sc-7/unpin")).toBe(1);
    expect(t.posts("/session/x-1/unpin")).toBe(0);
    expect(t.stored()).toEqual([other]);
  });

  test("reopening the pane before its unpin went out keeps the pin: no unpin, no second pin", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    await t.inTurn(a, () => {
      release();
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(t.posts("/pin")).toBe(1);
    expect(t.posts("/unpin")).toBe(0);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
  });

  test("an unpin that did not land leaves the pin ours: reopening the pane reclaims it, and no later start unpins it under the open pane", async () => {
    const opts: SetupOpts = {};
    const t = setup(opts);
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    // gc now lists the pin; the pane closes while gc cannot be reached, so the unpin does not land.
    opts.wakeReasons = ["session", "pin"];
    opts.unpin = { reject: "connection refused" };
    await t.inTurn(a, () => release());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(1);
    expect(t.stored()).toEqual([{ apiUrl: API, city: CITY, session: "sc-20" }]);
    // gc is back and the pane reopens: gc's "pin" is the mod's own, so the pane holds it as pinned.
    delete opts.unpin;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(3000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    expect(t.posts("/pin")).toBe(1);
    expect(t.posts("/unpin")).toBe(1);
    // Closing it now releases it.
    await t.inTurn(a, () => release());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(2);
    expect(t.stored()).toEqual([]);
  });

  test("the person pinning or unpinning the session takes it over: the pane no longer unpins it", async () => {
    for (const spec of [sessionPin("sc-20"), sessionUnpin("sc-20")]) {
      const t = setup();
      const a = await t.open();
      await t.host.advance(1000);
      let release!: () => void;
      await t.inTurn(a, () => {
        release = a.sub.watchPeek("sc-20");
      });
      await t.host.advance(2000);
      await t.inTurn(a, () => void a.sub.act(spec));
      await t.host.advance(1000);
      expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "not-pinned", why: "pinned or unpinned by hand: left as it is" });
      expect(t.stored()).toEqual([]);
      const before = t.posts("/unpin");
      await t.inTurn(a, () => release());
      await t.host.advance(2000);
      expect(t.posts("/unpin")).toBe(before);
      a.sub.unsubscribe();
    }
  });

  test("a pin gc refuses is forgotten and said; closing the pane sends no unpin", async () => {
    const t = setup({ pin: { status: 409, body: { title: "Conflict", status: 409, detail: "session is closed", code: "session-conflict" } } });
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toMatchObject({ kind: "failed" });
    expect(t.stored()).toEqual([]);
    await t.inTurn(a, () => release());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(0);
  });

  test("a copy that closes with the pane open leaves its pin recorded, for the next start (its turn can send nothing)", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    await t.close(a);
    live = [];
    await t.host.advance(5000);
    expect(t.posts("/unpin")).toBe(0);
    expect(t.stored()).toEqual([{ apiUrl: API, city: CITY, session: "sc-20" }]);
  });

  test("with another copy of the city still open, a closing copy's pin is released by that copy's tick", async () => {
    const t = setup();
    const a = await t.open();
    const b = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    await t.close(a);
    await t.host.advance(2000);
    expect(t.posts("/session/sc-20/unpin")).toBe(1);
    expect(t.stored()).toEqual([]);
    expect(b.sub.keepAwake("sc-20")).toBeNull();
  });

  test("two copies with the pane open share one pin: it is unpinned when the last one closes", async () => {
    const t = setup();
    const a = await t.open();
    const b = await t.open();
    await t.host.advance(1000);
    let ra!: () => void;
    let rb!: () => void;
    await t.inTurn(a, () => {
      ra = a.sub.watchPeek("sc-20");
    });
    await t.inTurn(b, () => {
      rb = b.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(t.posts("/pin")).toBe(1);
    await t.inTurn(a, () => ra());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(0);
    expect(b.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    await t.inTurn(b, () => rb());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(1);
  });

  const UNPINNED = ["session", "config"];
  const PINNED = ["session", "pin"];
  const unpinOk = () => fixtureBody("post-v0-city-by-city-name-session-by-id-unpin", "ok");

  test("a store restarted with the pane still open keeps the session pinned: the leftover unpin lands, then the pane pins it again", async () => {
    const opts: SetupOpts = {};
    const t = setup(opts);
    const a = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    // gc restarts (or the city is switched away and back): the store goes, the pane stays selected.
    opts.wakeReasons = PINNED;
    await t.close(a);
    live = [];
    opts.unpin = { hold: true };
    // The new store queues the leftover unpin and its first tick sends it, before the pane is opened on it.
    const b = await t.open();
    await t.inTurn(b, () => void b.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(1);
    expect(b.sub.keepAwake("sc-20")).toEqual({ kind: "checking" });
    // A wake read taken before the unpin landed still shows the mod's pin: it must not decide.
    opts.wakeReasons = UNPINNED;
    delete opts.unpin;
    t.gc.release(200, unpinOk());
    await t.host.advance(3000);
    expect(b.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    expect(t.posts("/pin")).toBe(2);
    expect(t.stored()).toEqual([{ apiUrl: API, city: CITY, session: "sc-20" }]);
  });

  test("leaving the pane and coming back while its unpin is in flight pins it again once the unpin lands", async () => {
    const opts: SetupOpts = {};
    const t = setup(opts);
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    opts.wakeReasons = PINNED;
    opts.unpin = { hold: true };
    await t.inTurn(a, () => release());
    await t.host.advance(1000);
    expect(t.posts("/unpin")).toBe(1);
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "checking" });
    opts.wakeReasons = UNPINNED;
    delete opts.unpin;
    t.gc.release(200, unpinOk());
    await t.host.advance(3000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    expect(t.posts("/pin")).toBe(2);
  });

  test("a pane closed while its pin is in flight, when that pin fails, sends no unpin and forgets the record", async () => {
    const opts: SetupOpts = { pin: { hold: true } };
    const t = setup(opts);
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinning" });
    await t.inTurn(a, () => release());
    await t.host.advance(1000);
    t.gc.release(409, { title: "Conflict", status: 409, detail: "session is closed", code: "session-conflict" });
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(0);
    expect(t.stored()).toEqual([]);
  });

  test("retrying keep-awake's own pin from the activity log does not hand the session to a person", async () => {
    const opts: SetupOpts = { pin: { reject: "connection refused" } };
    const t = setup(opts);
    const a = await t.open();
    await t.host.advance(1000);
    let release!: () => void;
    await t.inTurn(a, () => {
      release = a.sub.watchPeek("sc-20");
    });
    await t.host.advance(2000);
    const entry = a.sub.activity().entries.find((e) => e.spec.kind === "session.keep-awake");
    expect(entry).toBeDefined();
    delete opts.pin;
    await t.inTurn(a, () => void a.sub.retryAction(entry!.id));
    await t.host.advance(2000);
    expect(t.posts("/pin")).toBe(2);
    // Still the pane's: closing it unpins.
    await t.inTurn(a, () => release());
    await t.host.advance(2000);
    expect(t.posts("/unpin")).toBe(1);
  });

  test("a gascity.pins value that is not a list is left as it is and reported; the pane does not pin", async () => {
    const t = setup({ stored: { note: "someone else's" } });
    const a = await t.open();
    await t.host.advance(1000);
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    expect(t.stored()).toEqual({ note: "someone else's" });
    expect(t.writes).toEqual([]);
    expect(t.posts("/pin")).toBe(0);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "not-pinned", why: "the keep-awake records in gascity.pins cannot be read: not pinned" });
  });

  test("a wake reasons read that failed is retried with the pane's refresh, and the pane then pins", async () => {
    const t = setup();
    const a = await t.open();
    await t.host.advance(1000);
    const base = t.gc.override!;
    t.gc.override = (req) => (req.query.get("wake_reasons") === "true" ? { status: 400, body: { title: "Bad Request", status: 400, detail: "bad template" } } : base(req));
    await t.inTurn(a, () => void a.sub.watchPeek("sc-20"));
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toMatchObject({ kind: "failed" });
    t.gc.override = base;
    await t.inTurn(a, () => a.sub.refreshDetail("sc-20"));
    await t.host.advance(2000);
    expect(a.sub.keepAwake("sc-20")).toEqual({ kind: "pinned" });
    expect(t.posts("/pin")).toBe(1);
  });
});
