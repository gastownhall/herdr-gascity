// Open terminal (src/terminal/attach.ts) through the registry's ledger, as a
// copy uses it, under herdr's task-ownership rule (sync/fakes.ts FakeHost),
// against the recorded spaces()/panes()/terminals() fixtures in
// test/fixtures/terminals:
//   - a running session gets no wake; an asleep one is woken through gc's API
//     and polled until gc reports it running, and only then is a tab opened;
//   - a refused wake, or a session still not running at the deadline, opens
//     no tab;
//   - the tab runs `env -u HC_* gc --city <path> session attach <id>` in a
//     local space; a terminal still running that attach is selected instead,
//     one whose program is the shell again (the attach ended) is not, nor one
//     in a remote space;
//   - the outcome is confirmed through terminals(): opened / not-seen /
//     attach-exited, and every outcome is in the activity log.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionEntry, ActionSpec } from "../../../src/actions/activity.ts";
import type { GcError } from "../../../src/gc/errors.ts";
import { decodeScene, type HostScene } from "../../../src/host.schemas.ts";
import { err, ok, type Result } from "../../../src/result.ts";
import { HC_SCRUB } from "../../../src/terminal/argv.ts";
import {
  CONFIRM_WITHIN_MS, EXIT_WATCH_MS, WAKE_DEADLINE_MS, openTerminal, type TerminalHost,
} from "../../../src/terminal/attach.ts";
import type { TerminalBinding } from "../../../src/terminal/binding.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../../src/sync/registry.ts";
import { activityModel } from "../../../src/vm/activity.ts";
import { FakeGc, FakeHost, fixtureBody, type FakeReply, type Owner } from "../sync/fakes.ts";

const API = "http://127.0.0.1:8372";
const CITY = "scratch";
const SESSION_PATH = "/v0/city/scratch/session/sc-20";
const WAKE_PATH = `${SESSION_PATH}/wake`;
const BINDING: TerminalBinding = { kind: "attach-tab", target: { gcBin: "gc", cityPath: "/scratch/city", sessionId: "sc-20" }, noStart: false };
const ARGV = [...HC_SCRUB, "gc", "--city", "/scratch/city", "session", "attach", "sc-20"];

type Raw = { spaces: unknown; panes: unknown; terminals: unknown };

function scene(name: string): Raw {
  return JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "terminals", `${name}.json`), "utf8")) as Raw;
}

/** A terminal record as herdr lists the one a new attach tab runs (in tab `tab` of space s1). */
function attachTerminal(address: string, argv: string[], shell: boolean): unknown {
  const wrapped = ["/bin/zsh", "-ic", '"$@"; exec "$0" -i', "/bin/zsh", ...argv];
  return {
    address, argv: wrapped, labels: {}, cwd: "/home/person", state: "live", created_ms: 2, status: null, report: null,
    program: { key: shell ? "shell" : "program", name: shell ? "zsh" : "gc", icon: null, tint: false, tile: null, color: null, shell, agent: false },
  };
}

/** herdr's spaces/panes/terminals and the two app commands open terminal may run, recorded. */
class FakeTerminalHost implements TerminalHost {
  raw: Raw;
  readonly opened: { space: string; name: string; argv: string[] }[] = [];
  readonly selected: string[] = [];
  /** openTab fails with this cause. */
  openFails: string | null = null;
  /** Who called openTab (the ambient copy). */
  readonly openedBy: (Owner | null)[] = [];
  /** What a new tab does to the scene: by default, it appears in tab t8 of s1 running its argv. */
  onOpen: ((argv: string[]) => void) | null = (argv) => this.addTab("t8", "t9", argv, false);

  constructor(name: string, private readonly host: FakeHost) {
    this.raw = scene(name);
  }

  scene(): Result<HostScene, GcError> {
    return decodeScene(this.raw);
  }

  openTab(tab: { space: string; name: string; argv: string[] }): Result<null, GcError> {
    if (this.openFails !== null) return err({ kind: "host-call", api: "run(tab.new)", cause: this.openFails });
    this.opened.push(structuredClone(tab));
    this.openedBy.push(this.host.current);
    this.onOpen?.(tab.argv);
    return ok(null);
  }

  selectTab(tab: string): Result<null, GcError> {
    this.selected.push(tab);
    return ok(null);
  }

  /** A new tab `tab` in space s1 with one pane holding terminal `address`. */
  addTab(tab: string, address: string, argv: string[], shell: boolean): void {
    const spaces = this.raw.spaces as { id: string; tabs: unknown[] }[];
    spaces.find((s) => s.id === "s1")?.tabs.push({ id: tab, active: true });
    (this.raw.panes as unknown[]).push({ pane: `p-${tab}`, terminal: address, tab });
    (this.raw.terminals as unknown[]).push(attachTerminal(address, argv, shell));
  }

  /** The terminal at `address` now runs the shell (its attach exited). */
  attachExits(address: string): void {
    const t = (this.raw.terminals as { address: string; program: { shell: boolean } }[]).find((x) => x.address === address);
    if (t) t.program.shell = true;
  }
}

interface Copy {
  owner: Owner;
  sub: Subscription;
}

let live: Copy[] = [];
afterEach(() => {
  for (const c of live) c.sub.unsubscribe();
  live = [];
});

/**
 * gc with session sc-20 running or not: `running` is read at each GET of the
 * session; `state` (default active/asleep) overrides gc's lifecycle state;
 * while `hold.gets` is set, GETs of the session are held open (FakeGc.release).
 */
function setup(fixture: string, running: () => boolean, state: () => string | null = () => null) {
  const hold = { gets: false, otherEvents: false };
  const host = new FakeHost();
  const gc = new FakeGc(host);
  gc.emit({ type: "order.fired", subject: "gate-sweep" });
  const session = fixtureBody("get-v0-city-by-city-name-session-by-id", "peek") as Record<string, unknown>;
  let wakeReply: FakeReply = { status: 200, body: fixtureBody("post-v0-city-by-city-name-session-by-id-wake", "ok") };
  gc.override = (req) => {
    if (req.method === "POST" && req.path === WAKE_PATH) return wakeReply;
    if (hold.otherEvents && /^\/v0\/city\/(y|z)\/events$/.test(req.path)) return { hold: true };
    if (req.method === "GET" && req.path === SESSION_PATH) {
      if (hold.gets) return { hold: true };
      const up = running();
      return { status: 200, body: { ...session, running: up, state: state() ?? (up ? "active" : "asleep"), ...(up ? {} : { reason: "idle" }) } };
    }
    return undefined;
  };
  let keys = 0;
  const reg = new SyncRegistry({ fetch: host.wrap(gc.fetch), clock: host, random: () => 0.5, newKey: () => `key-${++keys}` });
  reg.setOnScreen(true);
  const terminals = new FakeTerminalHost(fixture, host);
  const open = async (owner = "copy-1", city = CITY): Promise<Copy> => {
    let copy: Copy | null = null;
    await host.run(owner, () => {
      const made = reg.subscribe({ apiUrl: API, city });
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
  const spec = (binding = BINDING): ActionSpec => openTerminal(binding, "worker/sc-20", { host: terminals, clock: host });
  const act = async (c: Copy, s: ActionSpec = spec()): Promise<number> => {
    let id = -1;
    await host.run(c.owner, () => {
      id = c.sub.act(s);
    });
    return id;
  };
  const entry = (c: Copy, id: number): ActionEntry => {
    const e = c.sub.activity().entries.find((x) => x.id === id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  };
  const row = (c: Copy, id: number) => activityModel(c.sub.activity(), c.sub.snapshot(), host.now()).rows.find((r) => r.id === id);
  const posts = () => gc.seen.filter((r) => r.method === "POST" && r.path === WAKE_PATH);
  const sessionGets = () => gc.seen.filter((r) => r.method === "GET" && r.path === SESSION_PATH);
  const runningBody = { ...session, running: true, state: "active" };
  return {
    host, gc, reg, terminals, open, act, entry, row, posts, sessionGets, spec, hold, runningBody,
    setWake: (r: FakeReply) => {
      wakeReply = r;
    },
  };
}

describe("wake first: no gc runtime is started under a herdr terminal", () => {
  test("a running session gets no wake; the tab opens at once", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.posts()).toHaveLength(0);
    expect(t.sessionGets()).toHaveLength(1);
    expect(t.terminals.opened).toEqual([{ space: "s1", name: "worker/sc-20", argv: ARGV }]);
    expect(t.terminals.openedBy).toEqual(["copy-1"]);
    expect(t.entry(a, id).state.kind).toBe("watching");
  });

  test("an asleep session: wake (with its Idempotency-Key), poll at 0.5 s, 1 s, then every 2 s, open the tab once gc says running", async () => {
    let polls = 0;
    const t = setup("no-attach", () => ++polls >= 4);
    const a = await t.open();
    const woke = t.host.now();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.posts()).toHaveLength(1);
    expect(t.posts()[0]?.init.headers["Idempotency-Key"]).toBe("key-1");
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.row(a, id)?.detail).toContain("waiting for gc to report session sc-20 running");
    await t.host.advance(3500);
    // One GET before the wake, then polls at +0.5 s, +1.5 s and +3.5 s: the last one says running.
    expect(t.sessionGets().map((r) => r.at - woke)).toEqual([0, 500, 1500, 3500]);
    expect(t.terminals.opened).toHaveLength(1);
    expect(t.entry(a, id).state.kind).toBe("watching");
  });

  test("a refused wake opens no tab and says why", async () => {
    const t = setup("no-attach", () => false);
    t.setWake({ status: 409, body: fixtureBody("post-v0-city-by-city-name-session-by-id-wake", "closed-session-conflict") });
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(5000);
    const s = t.entry(a, id).state;
    expect(s).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", sessionId: "sc-20", reason: "wake-refused" } });
    expect(s.kind === "failed" && s.error.kind === "attach-not-started" && s.error.detail).toContain("session sc-76 is closed");
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.sessionGets()).toHaveLength(1);
    expect(t.row(a, id)?.tone).toBe("failed");
  });

  test("still not running at the 60 s deadline: no tab, the last state is shown", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(WAKE_DEADLINE_MS - 1000);
    expect(t.entry(a, id).state.kind).toBe("watching");
    await t.host.advance(2000);
    const s = t.entry(a, id).state;
    expect(s).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", reason: "not-running-after-wake" } });
    expect(s.kind === "failed" && s.error.kind === "attach-not-started" && s.error.detail).toContain("asleep");
    expect(t.terminals.opened).toHaveLength(0);
    const polls = t.sessionGets().length;
    await t.host.advance(10_000);
    expect(t.sessionGets()).toHaveLength(polls);
  });

  test("the view that asked closes while waiting: no tab is ever opened", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    const b = await t.open("copy-2");
    const id = await t.act(a);
    await t.host.advance(1000);
    await t.host.close(a.owner, () => a.sub.unsubscribe());
    expect(t.entry(b, id).state).toMatchObject({ kind: "not-sent" });
    await t.host.advance(WAKE_DEADLINE_MS);
    expect(t.terminals.opened).toHaveLength(0);
  });

  test("--no-start is passed when gc has it", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    await t.act(a, t.spec({ ...BINDING, noStart: true }));
    await t.host.advance(TICK_MS);
    expect(t.terminals.opened[0]?.argv).toEqual([...ARGV, "--no-start"]);
  });
});

describe("the tab opens only from the asking copy's own tick, while the action is live", () => {
  test("a poll in flight at the 60 s deadline that answers running afterwards opens no tab", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    const woke = t.host.now();
    const id = await t.act(a);
    // Polls at +0.5 s, +1.5 s, +3.5 s, then every 2 s: the one at +59.5 s is held past the deadline.
    await t.host.advance(59_000);
    t.hold.gets = true;
    await t.host.advance(woke + 60_500 - t.host.now());
    expect(t.gc.heldCount()).toBe(1);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { reason: "not-running-after-wake" } });
    t.hold.gets = false;
    t.gc.release(200, t.runningBody);
    await t.host.advance(5 * TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { reason: "not-running-after-wake" } });
  });

  test("the asking copy closes with a poll in flight; the late 'running' answer opens no tab in the copy left", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    const b = await t.open("copy-2");
    const id = await t.act(a);
    await t.host.advance(1000);
    t.hold.gets = true;
    await t.host.advance(2000);
    expect(t.gc.heldCount()).toBe(1);
    await t.host.close(a.owner, () => a.sub.unsubscribe());
    expect(t.entry(b, id).state).toMatchObject({ kind: "not-sent" });
    t.hold.gets = false;
    t.gc.release(200, t.runningBody);
    await t.host.advance(20 * TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.entry(b, id).state).toMatchObject({ kind: "not-sent" });
  });

  test("a poll GET the fetch budget started in another copy's turn: the asking copy closes, the answer opens no tab there", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open("A");
    const b = await t.open("B");
    await t.open("C", "y");
    await t.open("D", "z");
    await t.host.advance(3000);
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    // Two other cities' event polls fill the budget, so A's next poll queues…
    t.hold.otherEvents = true;
    for (let i = 0; i < 200 && t.reg.budgetStats().inFlight < 2; i++) await t.host.advance(25);
    t.hold.otherEvents = false;
    t.hold.gets = true;
    for (let i = 0; i < 200 && t.reg.budgetStats().queued < 1; i++) await t.host.advance(25);
    expect(t.reg.budgetStats().queued).toBeGreaterThan(0);
    // …and starts in C's (or D's) turn when one of them answers.
    t.gc.release(200, { items: [], total: 1 });
    await t.host.runTurns();
    const starter = t.host.starts.filter((x) => x.path === SESSION_PATH).at(-1)?.owner;
    expect(starter === "C" || starter === "D").toBe(true);
    await t.host.close(a.owner, () => a.sub.unsubscribe());
    expect(t.entry(b, id).state).toMatchObject({ kind: "not-sent" });
    t.gc.release(200, { items: [], total: 1 });
    await t.host.runTurns();
    t.hold.gets = false;
    t.gc.release(200, t.runningBody);
    await t.host.advance(20 * TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.entry(b, id).state).toMatchObject({ kind: "not-sent" });
  });

  test("a poll answering running opens the tab at the asking copy's next tick, not in the answer's turn", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    await t.open("copy-2");
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    t.hold.gets = true;
    await t.host.advance(2 * TICK_MS);
    expect(t.gc.heldCount()).toBe(1);
    t.hold.gets = false;
    t.gc.release(200, t.runningBody);
    await t.host.runTurns();
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.row(a, id)?.detail).toContain("opening its tab");
    await t.host.advance(TICK_MS);
    expect(t.terminals.openedBy).toEqual(["copy-1"]);
  });
});

describe("gc's lifecycle state, not only `running`", () => {
  for (const state of ["draining", "closing"]) {
    test(`a ${state} session (running) is refused: no wake, no tab`, async () => {
      const t = setup("no-attach", () => true, () => state);
      const a = await t.open();
      const id = await t.act(a);
      await t.host.advance(5 * TICK_MS);
      expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", reason: "session-stopping" } });
      expect(t.posts()).toHaveLength(0);
      expect(t.terminals.opened).toHaveLength(0);
    });
  }

  test("a session gc is still starting (running, start-pending) is not woken: the tab opens once it has settled", async () => {
    let settled = false;
    const t = setup("no-attach", () => true, () => (settled ? null : "start-pending"));
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(2000);
    expect(t.posts()).toHaveLength(0);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.row(a, id)?.detail).toContain("starting: waiting for gc");
    settled = true;
    await t.host.advance(3000);
    expect(t.terminals.opened).toHaveLength(1);
  });

  test("a woken session that turns to draining while polled: no tab", async () => {
    let polls = 0;
    const t = setup("no-attach", () => false, () => (++polls >= 3 ? "draining" : null));
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(5000);
    expect(t.posts()).toHaveLength(1);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { reason: "session-stopping" } });
    expect(t.terminals.opened).toHaveLength(0);
  });
});

describe("where the tab opens, and dedupe", () => {
  test("every tab.new argv starts with the env -u HC_* prefix", async () => {
    for (const fixture of ["no-attach", "attach-ended", "attach-remote", "remote-active"]) {
      const t = setup(fixture, () => true);
      const a = await t.open();
      await t.act(a);
      await t.host.advance(TICK_MS);
      expect(t.terminals.opened).toHaveLength(1);
      expect(t.terminals.opened[0]?.argv.slice(0, HC_SCRUB.length)).toEqual([...HC_SCRUB]);
      a.sub.unsubscribe();
    }
  });

  test("a terminal still running the attach: its tab is selected, no new tab", async () => {
    const t = setup("attach-running", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.terminals.selected).toEqual(["t2"]);
    expect(t.entry(a, id).state).toMatchObject({ kind: "done" });
    expect(t.row(a, id)?.detail).toContain("already open");
  });

  test("a terminal whose program is the shell again (the attach ended) gets a new tab", async () => {
    const t = setup("attach-ended", () => true);
    const a = await t.open();
    await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.selected).toEqual([]);
    expect(t.terminals.opened).toHaveLength(1);
  });

  test("a running attach in a remote space is ignored: a new tab in the local space", async () => {
    const t = setup("attach-remote", () => true);
    const a = await t.open();
    await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.selected).toEqual([]);
    expect(t.terminals.opened.map((o) => o.space)).toEqual(["s1"]);
  });

  test("the active space is remote: the first local space is chosen", async () => {
    const t = setup("remote-active", () => true);
    const a = await t.open();
    await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.opened.map((o) => o.space)).toEqual(["s1"]);
  });

  test("no local space: no tab, and the person is told to open one", async () => {
    const t = setup("remote-only", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", reason: "no-local-space" } });
    expect(t.row(a, id)?.detail).toContain("space.new");
  });

  test("unreadable host data: no tab, a host-decode error", async () => {
    const t = setup("no-attach", () => true);
    t.terminals.raw.spaces = [{ id: "s1", active: true, tabs: [] }];
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.terminals.opened).toHaveLength(0);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "host-decode", api: "spaces" } });
  });
});

describe("confirmed through terminals()", () => {
  test("opened: seen running and still the attach after the watch", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    await t.host.advance(EXIT_WATCH_MS - 1000);
    expect(t.entry(a, id).state.kind).toBe("watching");
    await t.host.advance(2000);
    expect(t.entry(a, id).state).toMatchObject({ kind: "done" });
    expect(t.row(a, id)).toMatchObject({ tone: "done", title: "Open terminal · session sc-20" });
    expect(t.row(a, id)?.detail).toStartWith("opened");
  });

  test("not-seen: no new attach terminal within the confirm window", async () => {
    const t = setup("no-attach", () => true);
    t.terminals.onOpen = null;
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(CONFIRM_WITHIN_MS + 2 * TICK_MS);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", reason: "not-seen-in-terminals" } });
  });

  test("a terminal that already ran the attach before (shell now) is not taken for the new one", async () => {
    const t = setup("attach-ended", () => true);
    t.terminals.onOpen = null;
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(CONFIRM_WITHIN_MS + 2 * TICK_MS);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { reason: "not-seen-in-terminals" } });
  });

  test("attach-exited: the new terminal's program becomes the shell within the watch", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(1000);
    t.terminals.attachExits("t9");
    await t.host.advance(2 * TICK_MS);
    const s = t.entry(a, id).state;
    expect(s).toMatchObject({ kind: "failed", error: { kind: "attach-not-started", reason: "attach-exited" } });
    expect(t.row(a, id)?.detail).toContain("attach failed: see the tab");
  });

  test("seen as the shell straight away (gc refused at once) is attach-exited too", async () => {
    const t = setup("no-attach", () => true);
    t.terminals.onOpen = (argv) => t.terminals.addTab("t8", "t9", argv, true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(2 * TICK_MS);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { reason: "attach-exited" } });
  });

  test("the person closes the new tab during the watch: still opened", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(1000);
    t.terminals.raw.terminals = (t.terminals.raw.terminals as { address: string }[]).filter((x) => x.address !== "t9");
    await t.host.advance(EXIT_WATCH_MS);
    expect(t.entry(a, id).state).toMatchObject({ kind: "done" });
  });

  test("the view closes after the tab opened: logged as opened, not confirmed", async () => {
    const t = setup("no-attach", () => true);
    const a = await t.open();
    const b = await t.open("copy-2");
    const id = await t.act(a);
    await t.host.advance(500);
    await t.host.close(a.owner, () => a.sub.unsubscribe());
    const s = t.entry(b, id).state;
    expect(s.kind).toBe("done");
    expect(s.kind === "done" && s.detail).toContain("not confirmed");
    expect(t.terminals.opened).toHaveLength(1);
  });
});

describe("the activity log", () => {
  test("names the action and shows each step while it is under way", async () => {
    let up = false;
    const t = setup("no-attach", () => up);
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.row(a, id)).toMatchObject({ title: "Open terminal · session sc-20", tone: "pending" });
    up = true;
    await t.host.advance(1000);
    expect(t.row(a, id)?.detail).toContain("tab opened");
    expect(t.row(a, id)?.tone).toBe("pending");
  });

  test("an open already under way is busy: a second click is not sent", async () => {
    const t = setup("no-attach", () => false);
    const a = await t.open();
    await t.act(a);
    await t.host.advance(TICK_MS);
    const model = activityModel(a.sub.activity(), a.sub.snapshot(), t.host.now());
    expect(model.busy.has("session.attach|session:sc-20")).toBe(true);
  });

  test("herdr refuses the tab: failed with herdr's reason, nothing watched", async () => {
    const t = setup("no-attach", () => true);
    t.terminals.openFails = "no space yet: make one first (space.new)";
    const a = await t.open();
    const id = await t.act(a);
    await t.host.advance(TICK_MS);
    expect(t.entry(a, id).state).toMatchObject({ kind: "failed", error: { kind: "host-call", cause: "no space yet: make one first (space.new)" } });
  });

});
