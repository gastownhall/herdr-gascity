// The mod against a real scratch gc city, on Linux, with no GPU and no
// herdr-app: the built gascity/main.js runs in bun inside a live stand-in for
// herdr (herdr.ts), two copies of it, with herdr's constrained fetch.
//
// Run: GC_BIN=/abs/path/to/gc bun run test:integration
// (gc built from the commit in api/PIN; tmux, curl and bash on PATH). The
// scratch city, its supervisor and every terminal run under a temporary
// directory with their own HOME, GC_HOME, XDG dirs and tmux socket; teardown
// stops exactly the processes this run started.
//
// Scenario: discovery → the city → a session started through the mod
// (running within 90 s) → `submit close <bead>` to the deterministic agent →
// the bead in the closed ring (within 60 s) → suspend through gc → Open
// terminal (the mod wakes it through gc before the attach tab opens) → the
// HC_SCOPE audit of that terminal, then the tree killed and the session still
// running; then the race path (the session suspended just before the recorded
// attach argv runs, with the city's tmux server running and killed). Then the checks themselves are shown to
// catch what they guard against, and the negative cases: an unknown city, a
// sling gc never answers, the supervisor dying, a city that requires signed
// write grants and a read-only bind. The fetch budget never exceeds 2.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_MARKER, ScratchCity } from "../../canary/city.ts";
import { carrying, commandLine, readProcessTable } from "../../canary/proc.ts";
import { auditReport, auditScope, type ScopeAudit } from "../../canary/scope-audit.ts";
import { HC_SCRUB } from "../../src/terminal/argv.ts";
import { overBudget, wakeBeforeAttach, type AttachMoment } from "./checks.ts";
import { LiveHerdr, type LiveCopy } from "./herdr.ts";
import { startHoldingProxy, type HoldingProxy } from "./proxy.ts";
import { PtyTerminals, type Terminal } from "./terminals.ts";

const BUNDLE = join(import.meta.dir, "..", "..", "gascity", "main.js");
const CITY = "canary";
const AGENT = "canary.canary-agent";
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const GC_BIN = process.env.GC_BIN ?? "";
const SHELL = process.env.INTEGRATION_SHELL ?? "/bin/bash";
const runId = randomBytes(4).toString("hex");
const root = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "hg-it-"));
const logDir = join(root, "logs");
mkdirSync(logDir, { recursive: true });

/** What the run measured and found; written to logs/report.json. */
const report: Record<string, unknown> = { runId, root, gcBin: GC_BIN, shell: SHELL, steps: [] as unknown[] };
const steps = report.steps as unknown[];

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    writeFileSync(join(logDir, "integration.log"), `${stamped}\n`, { flag: "a" });
  } catch {
    // the log is best effort; the assertions are not
  }
}

/** Polls `probe` every `everyMs` until it returns a value (not null/undefined/false), or throws after `ms` with `what` and the last state. */
async function waitFor<T>(what: string, ms: number, probe: () => T | null | undefined | false | Promise<T | null | undefined | false>, everyMs = 100, last: () => string = () => ""): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}${last() ? `; last: ${last()}` : ""}`);
    await sleep(everyMs);
  }
}

// ---- the probe document (vm/probe.ts), as the canary reads it ------------------------

interface ProbeDoc {
  ts: string;
  connection: { text: string; tone: string };
  banners: string[];
  discovery: { source: string; url: string; version: string } | null;
  city: string | null;
  city_phase: string;
  visibility: { on_screen: boolean };
  sessions: { id: string; label: string; status: string; status_kind: string; attached: boolean }[];
  board: null | {
    ready: { cards: { id: string; title: string }[] };
    closed: { recent: { id: string; title: string; seq: number; close_reason: string | null }[] };
  };
  detail: null | { session: string; status: string; output: string | null };
  actions: { id: number; action: string; title: string; state: string; detail: string; request_id: string | null }[];
  exec_log: { kind: string; argv: string[] }[];
  errors: unknown[];
  fetch_in_flight_max: number;
  commands: { command: string; result: string; detail: string }[];
}

/** This host's IPv4 addresses that are not loopback. */
function nonLoopbackIPv4(): string[] {
  return Object.values(networkInterfaces()).flat().filter((i) => i !== undefined && i.family === "IPv4" && !i.internal).map((i) => i!.address);
}

function probePath(appHome: string): string {
  return join(appHome, "data", "gascity-probe", "probe.json");
}

function readProbe(appHome: string): ProbeDoc | null {
  try {
    const text = readFileSync(probePath(appHome), "utf8");
    return text.trim() === "" ? null : (JSON.parse(text) as ProbeDoc);
  } catch {
    return null;
  }
}

function keepProbe(appHome: string, name: string): void {
  if (existsSync(probePath(appHome))) copyFileSync(probePath(appHome), join(logDir, `probe-${name}.json`));
}

// ---- the run's shared state ----------------------------------------------------------

let city: ScratchCity;
let terminals: PtyTerminals;
let app: LiveHerdr;
const apps: { name: string; app: LiveHerdr; appHome: string }[] = [];
let proxy: HoldingProxy | null = null;
let sessionId = "";
let attachArgv: string[] = [];
/** The latest tab.new and gc's answer at that moment. */
let lastTab: { terminal: Terminal; at: number; running: Promise<boolean> } | null = null;
let tornDown = false;
/** gc event → the copy drawing the change, per sample. */
const lags: { what: string; ms: number }[] = [];

async function gcSession(id: string): Promise<{ state: string; running: boolean; attached: boolean; reason?: string }> {
  const r = await city.api("GET", city.cityPath(`/session/${enc(id)}`));
  if (r.status !== 200) throw new Error(`GET session ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { state: string; running: boolean; attached: boolean; reason?: string };
}

function newApp(name: string, settings: Record<string, unknown>, source = readFileSync(BUNDLE, "utf8")): { app: LiveHerdr; appHome: string } {
  const appHome = join(root, `app-home-${name}`);
  mkdirSync(appHome, { recursive: true });
  const a = new LiveHerdr({
    source,
    appHome,
    home: city.env.HOME!,
    execEnv: city.env,
    terminals,
    shared: { "gascity.settings": settings },
    log: (l) => log(`[${name}] ${l}`),
    onTabNew: (terminal) => {
      const at = Date.now();
      lastTab = { terminal, at, running: sessionId === "" ? Promise.resolve(false) : gcSession(sessionId).then((s) => s.running, () => false) };
    },
  });
  apps.push({ name, app: a, appHome });
  return { app: a, appHome };
}

/** Delivers a command to the app's shown copies (the mod's tab is selected first, as the canary does). */
function send(a: LiveHerdr, command: string): void {
  a.selectTab(a.modTab);
  a.do(command);
}

async function waitConnected(appHome: string, ms = 60_000): Promise<ProbeDoc> {
  return waitFor("the mod connected to the canary city", ms, () => {
    const p = readProbe(appHome);
    return p && p.city === CITY && p.city_phase === "city-running" && p.connection.text === "connected" ? p : null;
  }, 200, () => JSON.stringify(readProbe(appHome)?.connection ?? null));
}

/** The session's row in a probe, with the probe's time and connection, for a timeout message. */
function sessionRow(appHome: string): string {
  const p = readProbe(appHome);
  return JSON.stringify({ ts: p?.ts ?? null, connection: p?.connection ?? null, row: p?.sessions.find((s) => s.id === sessionId) ?? null, sessions: p?.sessions.length ?? null });
}

/** gc's lifecycle states and the chip the mod draws for each (src/vm/status.ts). */
const LIFECYCLE_LABEL: Readonly<Record<string, string>> = { creating: "starting" };

/**
 * Waits until the copy's row for the session shows it not running: a
 * lifecycle chip whose label is the state gc's own session list reports at
 * that moment. Not the word "suspended": gc reports a suspended session
 * "suspended" at first and "asleep" (still user-hold) from its next
 * background tick on.
 */
async function waitShownNotRunning(appHome: string, who: string): Promise<void> {
  let gcState = "";
  await waitFor(`${who} to show the session not running, as gc lists it`, 15_000, async () => {
    const r = await city.api("GET", city.cityPath("/sessions?limit=100"));
    const item = ((r.body as { items?: { id: string; state: string; running: boolean }[] }).items ?? []).find((x) => x.id === sessionId);
    if (!item || item.running) return null;
    gcState = item.state;
    const row = readProbe(appHome)?.sessions.find((x) => x.id === sessionId);
    return row && row.status_kind === "lifecycle" && row.status === (LIFECYCLE_LABEL[gcState] ?? gcState) ? row : null;
  }, 200, () => `gc lists it ${gcState || "(not yet read)"}; ${sessionRow(appHome)}`);
}

function newestAction(p: ProbeDoc | null, kind: string): ProbeDoc["actions"][number] | undefined {
  return p?.actions.filter((a) => a.action === kind).sort((a, b) => b.id - a.id)[0];
}

/** The ts of the newest gc event of `type` about `subject`, after `afterSeq`. */
async function eventTime(type: string, subject: string, afterSeq = 0): Promise<{ seq: number; ts: number } | null> {
  const r = await city.api("GET", city.cityPath("/events?limit=100"));
  const items = ((r.body as { items?: { seq: number; type: string; subject?: string; ts: string }[] }).items ?? []);
  const e = items.find((x) => x.type === type && x.subject === subject && x.seq > afterSeq);
  return e ? { seq: e.seq, ts: Date.parse(e.ts) } : null;
}

async function latestSeq(): Promise<number> {
  const r = await city.api("GET", city.cityPath("/events?limit=1"));
  return (r.body as { total?: number }).total ?? 0;
}

function audit(t: Terminal, label: string): ScopeAudit {
  const a = auditScope(readProcessTable(), t.pid, t.scope);
  for (const line of auditReport(a)) log(`audit ${label}: ${line}`);
  steps.push({ step: `audit ${label}`, token: a.token, root: a.root, tree: a.tree, inside: a.inside, leaks: a.leaks, unreadable: a.unreadable });
  return a;
}

/** Terminal output without escape sequences, carriage returns as newlines. */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]/g, "").replace(/\r/g, "\n");
}

/**
 * The audit, sampled every 100 ms from now until `done` (or `ms`), then once
 * more 3 s later: a process that carries the token for a moment is caught too.
 * Returns every leak seen (by pid) and how many samples were taken.
 */
async function auditWhile(t: Terminal, label: string, done: () => Promise<boolean>, ms: number): Promise<{ leaks: ScopeAudit["leaks"]; samples: number }> {
  const leaks = new Map<number, ScopeAudit["leaks"][number]>();
  let samples = 0;
  const sample = () => {
    samples++;
    for (const l of auditScope(readProcessTable(), t.pid, t.scope).leaks) leaks.set(l.pid, l);
  };
  const deadline = Date.now() + ms;
  for (;;) {
    sample();
    if (await done().catch(() => false)) break;
    if (Date.now() > deadline) throw new Error(`${label}: the attach did not settle within ${ms / 1000} s`);
    await sleep(100);
  }
  const settle = Date.now() + 3_000;
  while (Date.now() < settle) {
    sample();
    await sleep(100);
  }
  const final = audit(t, label);
  for (const l of final.leaks) leaks.set(l.pid, l);
  return { leaks: [...leaks.values()], samples: samples + 1 };
}

async function suspendAndWait(id: string): Promise<void> {
  const r = await city.api("POST", city.cityPath(`/session/${enc(id)}/suspend`));
  expect(r.status).toBe(200);
  await waitFor(`gc to report session ${id} not running`, 30_000, async () => !(await gcSession(id)).running, 250);
}

async function wakeAndWait(id: string): Promise<void> {
  const r = await city.api("POST", city.cityPath(`/session/${enc(id)}/wake`));
  expect(r.status).toBe(200);
  await waitFor(`gc to report session ${id} running`, 60_000, async () => (await gcSession(id)).running, 250);
}

async function teardown(): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  proxy?.stop();
  for (const a of apps) await a.app.closeAll().catch(() => undefined);
  await terminals?.killAll().catch(() => undefined);
  const signalled = city ? await city.teardown() : [];
  report.teardown = signalled;
  for (const s of signalled) log(`teardown: ${s}`);
}

beforeAll(async () => {
  if (!GC_BIN.startsWith("/") || !existsSync(GC_BIN)) {
    throw new Error("set GC_BIN to the absolute path of a gc built from the commit in api/PIN (see README, Integration test)");
  }
  log(`run ${runId} under ${root}`);
  city = await ScratchCity.prepare({ gcBin: GC_BIN, root, name: CITY, runId, log });
  await city.startSupervisor();
  await city.init();
  const version = await city.api("GET", "/health");
  report.gc = version.body;
  terminals = new PtyTerminals({ env: city.env, shell: SHELL, cwd: city.env.HOME!, logDir, runId });
  app = newApp("main", { gcBin: GC_BIN }).app;
}, 240_000);

afterAll(async () => {
  await teardown().catch((e: unknown) => log(`teardown failed: ${String(e)}`));
  for (const a of apps) {
    keepProbe(a.appHome, `${a.name}-final`);
    writeFileSync(join(logDir, `fetch-${a.name}.json`), JSON.stringify(a.app.meter.log, null, 1));
    writeFileSync(join(logDir, `runs-${a.name}.json`), JSON.stringify({ runs: a.app.runs, execs: a.app.execs, toasts: a.app.toasts, violations: a.app.violations, taskErrors: a.app.taskErrors }, null, 1));
  }
  writeFileSync(join(logDir, "report.json"), JSON.stringify(report, null, 2));
  log(`report: ${join(logDir, "report.json")}`);
}, 120_000);

describe("the mod against a scratch gc city", () => {
  let copies: LiveCopy[] = [];
  const main = () => join(root, "app-home-main");

  test("discovers gc and the city; two copies share one store", async () => {
    copies = [app.addCopy(), app.addCopy()];
    send(app, "probe:on");
    const p = await waitConnected(main());
    expect(p.discovery?.source).toBe("supervisor-config");
    expect(p.discovery?.url).toBe(city.apiUrl);
    // The gc-reported step ran the one allowlisted exec.
    expect(app.execs.every((e) => e.allowed)).toBe(true);
    // One shared store: one event poll every 2 s on screen for both copies together.
    const from = Date.now();
    await sleep(8_000);
    const polls = app.meter.log.filter((r) => r.startedAt >= from && r.url.includes(`/v0/city/${CITY}/events?`) && r.url.includes("limit=50"));
    steps.push({ step: "shared store", eventPollsIn8s: polls.length });
    expect(polls.length).toBeGreaterThanOrEqual(3);
    expect(polls.length).toBeLessThanOrEqual(5);
    // Both copies render the city from the shared store.
    for (const c of copies) expect(c.text()).toContain(CITY);
    keepProbe(main(), "connected");
  }, 90_000);

  test("starts a session through the mod: running within 90 s", async () => {
    const alias = `canary-${runId}`;
    const t0 = Date.now();
    send(app, `session-new:${CITY}:${AGENT}:${alias}`);
    const found = await waitFor("gc to list the new session", 90_000, async () => {
      const r = await city.api("GET", city.cityPath("/sessions?limit=100"));
      return ((r.body as { items?: { id: string; alias?: string }[] }).items ?? []).find((s) => s.alias === alias || s.alias?.endsWith(`.${alias}`)) ?? null;
    }, 500);
    sessionId = found.id;
    await waitFor("the session running, in gc and in the mod's view", Math.max(1, 90_000 - (Date.now() - t0)), async () => {
      const row = readProbe(main())?.sessions.find((s) => s.id === sessionId);
      return row && row.status_kind !== "lifecycle" && (await gcSession(sessionId)).running ? row : null;
    }, 250, () => JSON.stringify(readProbe(main())?.sessions ?? null));
    const elapsed = Date.now() - t0;
    steps.push({ step: "session running", sessionId, ms: elapsed });
    log(`session ${sessionId} running after ${elapsed} ms`);
    expect(elapsed).toBeLessThanOrEqual(90_000);
    // gc may list the session running before the mod's next outcome poll (0.5, 1, 2, then every 2 s) learns the create is done.
    await waitFor("the session.new action done in the mod", 15_000, () => newestAction(readProbe(main()), "session.new")?.state === "done", 200,
      () => JSON.stringify(newestAction(readProbe(main()), "session.new") ?? null));
  }, 120_000);

  test("submit 'close <bead>' reaches the agent; the bead is in the closed ring within 60 s", async () => {
    const title = `canary ${runId}`;
    send(app, `bead-new:${CITY}:${enc(title)}`);
    const card = await waitFor("the new bead on the board", 30_000, () => readProbe(main())?.board?.ready.cards.find((c) => c.title === title), 200);
    send(app, `session:${sessionId}`);
    const cursor = await latestSeq();
    const t0 = Date.now();
    send(app, `submit:${CITY}:${sessionId}:${enc(`close ${card.id} ${runId}`)}`);
    // When the copy's view first draws it in the closed column (what a person sees)…
    let firstSeen = 0;
    await waitFor("the bead drawn in the closed column", 60_000, () => {
      const hit = copies[0]!.textAt("gascity-col-closed")?.includes(`${card.id} ·`);
      if (hit) firstSeen = Date.now();
      return hit;
    }, 50);
    // …and what the probe file reports for it.
    const closed = await waitFor("the bead in the probe's closed ring", 10_000, () => readProbe(main())?.board?.closed.recent.find((x) => x.id === card.id), 100,
      () => JSON.stringify(readProbe(main())?.board?.closed ?? null));
    const elapsed = firstSeen - t0;
    expect(elapsed).toBeLessThanOrEqual(60_000);
    expect(closed.close_reason).toBe(`canary ${runId}`);
    const submit = await waitFor("the submit's outcome", 30_000, () => {
      const x = newestAction(readProbe(main()), "session.submit");
      return x && x.state !== "pending" ? x : null;
    }, 200);
    expect(submit.state).toBe("done");
    // The agent got the text as typed input on its tmux session (gc's submit, not /messages).
    const output = await waitFor("the agent's output in the session detail", 30_000, () => {
      const d = readProbe(main())?.detail;
      return d?.session === sessionId && d.output?.includes(`CANARY DONE ${card.id} ${runId}`) ? d.output : null;
    }, 250);
    expect(output).toContain(`CANARY WORKING ${card.id}`);
    const event = await eventTime("bead.closed", card.id, cursor);
    expect(event).not.toBeNull();
    const lag = firstSeen - event!.ts;
    steps.push({ step: "submit close", bead: card.id, msToClosedRing: elapsed, eventToView: lag, submit: submit.detail });
    log(`bead ${card.id} closed: in the ring ${elapsed} ms after submit, ${lag} ms after gc's bead.closed event`);
    lags.push({ what: `bead.closed ${card.id}`, ms: lag });
  }, 150_000);

  // The on-screen cadence bounds how long a gc change takes to be drawn: the
  // event poll runs 2 s after the previous one ended, the copy's tick (250 ms)
  // picks up its answer, refetches wait 300 ms to coalesce, and the refetched
  // data is drawn on the next tick: about 2.8 s at worst plus the requests
  // themselves, about 1.5 s on average. So the median of several samples must
  // be within 3 s (the target), and none may exceed 4 s.
  test("changes by another client show within 3 s of gc's event (median of several; none over 4 s)", async () => {
    for (let i = 0; i < 5; i++) {
      // Land the changes at different points of the poll cycle.
      await sleep(Math.floor(Math.random() * 2_000));
      const r = await city.api("POST", city.cityPath("/beads"), { title: `external ${runId} ${i}` });
      expect(r.status).toBeLessThan(300);
      const id = (r.body as { id: string }).id;
      let seenAt = 0;
      await waitFor("the other client's bead drawn in the ready column", 15_000, () => {
        const hit = copies[0]!.textAt("gascity-col-ready")?.includes(`${id} ·`);
        if (hit) seenAt = Date.now();
        return hit;
      }, 50);
      const event = await eventTime("bead.created", id);
      expect(event).not.toBeNull();
      lags.push({ what: `bead.created ${id}`, ms: seenAt - event!.ts });
    }
    const sorted = lags.map((l) => l.ms).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const max = sorted[sorted.length - 1]!;
    steps.push({ step: "event to view", samples: lags, medianMs: median, maxMs: max });
    log(`event to view: median ${median} ms, max ${max} ms over ${sorted.length} samples`);
    expect(sorted.length).toBeGreaterThanOrEqual(6);
    expect(median).toBeLessThanOrEqual(3_000);
    expect(max).toBeLessThanOrEqual(4_000);
  }, 90_000);

  test("Open terminal on a suspended session wakes it through gc, then attaches; the HC_SCOPE audit finds no leak", async () => {
    await suspendAndWait(sessionId);
    const suspendedAt = Date.now();
    await waitShownNotRunning(main(), "the mod");
    steps.push({ step: "suspended in the view", ms: Date.now() - suspendedAt });
    lastTab = null;
    send(app, `attach:${CITY}:${sessionId}`);
    const tab = await waitFor("the mod to open the attach tab", 70_000, () => lastTab, 100);
    const moment: AttachMoment = { sessionId, at: tab.at, wasRunning: false, runningAtTabNew: await tab.running };
    const broken = wakeBeforeAttach(moment, app.meter.log);
    steps.push({ step: "wake before attach", moment, broken });
    expect(broken).toEqual([]);
    attachArgv = tab.terminal.inner;
    expect(attachArgv.slice(0, HC_SCRUB.length)).toEqual([...HC_SCRUB]);
    expect(attachArgv.slice(HC_SCRUB.length)).toEqual([GC_BIN, "--city", city.cityDir, "session", "attach", sessionId]);
    const action = await waitFor("the mod to confirm the attach", 30_000, () => {
      const a = newestAction(readProbe(main()), "session.attach");
      return a && a.state !== "pending" ? a : null;
    }, 250);
    expect(action.state).toBe("done");
    expect(action.detail).toContain("opened in a new tab");
    // tab.new made the attach tab active; the canary selects the mod's tab again.
    app.selectTab(app.modTab);
    const record = terminals.record(tab.terminal);
    expect((record.program as { shell: boolean }).shell).toBe(false);
    await waitFor("gc to report a terminal attached", 15_000, async () => (await gcSession(sessionId)).attached, 250);
    const a = audit(tab.terminal, "woken session");
    expect(a.leaks).toEqual([]);
    expect(a.inside.length).toBeGreaterThan(0);
    // A holder loss: the attach terminal's whole tree dies. The session keeps running.
    await terminals.kill(tab.terminal);
    await sleep(3_000);
    const after = await gcSession(sessionId);
    steps.push({ step: "after the attach tree died", session: after });
    expect(after.running).toBe(true);
    keepProbe(main(), "attached");
  }, 150_000);

  // The race: the session falls asleep between the mod's wake and the attach.
  // At the pinned gc, the attach then goes into gc's start path itself (it
  // scans for orphaned runtimes, makes a pane) and gives up within
  // milliseconds ("session not found"); with the city's tmux server gone it
  // starts a fresh server first. The audit samples /proc the whole time.
  // Once the pin includes gastownhall/gascity#9011 (attach lets the controller
  // wake the session), these flip to asserting the attach started nothing.
  for (const variant of ["city tmux server running", "city tmux server killed"] as const) {
    test(`race path (${variant}): the recorded attach argv right after a new suspend reaches gc's start path; no leak`, async () => {
      expect(attachArgv.length).toBeGreaterThan(0);
      await suspendAndWait(sessionId);
      if (variant === "city tmux server killed") {
        const k = await city.run(["tmux", "-L", city.socket, "kill-server"], 10_000);
        expect(k.code).toBe(0);
        expect((await city.run(["tmux", "-L", city.socket, "list-sessions"], 5_000)).code).not.toBe(0);
      }
      const t = terminals.launch(attachArgv, { tab: "race", space: "s1" });
      log(`race path (${variant}): ${t.address} pid ${t.pid} HC_SCOPE=${t.scope}`);
      const a = await auditWhile(t, `race path, ${variant}`, async () =>
        (await gcSession(sessionId)).running || (terminals.record(t).program as { shell: boolean }).shell, 60_000);
      const output = plain(t.output());
      // The attach reached gc's start path (else the audit proved nothing).
      expect(output).toContain(`scanning for orphaned runtimes for ${sessionId}`);
      if (variant === "city tmux server killed") expect(output).toContain("no tmux server running");
      expect(a.leaks).toEqual([]);
      const before = await gcSession(sessionId);
      await terminals.kill(t);
      await sleep(3_000);
      const after = await gcSession(sessionId);
      steps.push({ step: `race path, ${variant}`, samples: a.samples, before, after, output: output.slice(-2000) });
      expect(after.running).toBe(before.running);
      if (!after.running) await wakeAndWait(sessionId);
    }, 150_000);
  }

  test("the audit catches a process outside the terminal's tree carrying its token; the env -u prefix prevents it", async () => {
    // A program that starts a tmux server (a daemon, outside the terminal's
    // tree) from the terminal's environment, as an in-process session start
    // of the city's runtime would: on its own test socket, under this run's TMUX_TMPDIR.
    const results: Record<string, number> = {};
    for (const [label, prefix] of [["no prefix", [] as string[]], ["env -u prefix", [...HC_SCRUB]]] as const) {
      const socket = `leak-${runId}-${label === "no prefix" ? "a" : "b"}`;
      const t = terminals.launch([...prefix, "tmux", "-L", socket, "new-session", "-d", "-s", "leak", "sleep 600"], { tab: "leak", space: "s1" });
      await waitFor(`the ${label} tmux server`, 15_000, async () => (await city.run(["tmux", "-L", socket, "has-session", "-t", "leak"], 5_000)).code === 0, 250);
      const a = audit(t, `daemon, ${label}`);
      results[label] = a.leaks.length;
      await terminals.kill(t);
      await city.run(["tmux", "-L", socket, "kill-server"], 5_000);
    }
    steps.push({ step: "audit negative", leaks: results });
    expect(results["no prefix"]).toBeGreaterThan(0);
    expect(results["env -u prefix"]).toBe(0);
  }, 60_000);

  test("a mod that skips the wake fails the wake-before-attach check", async () => {
    const source = readFileSync(BUNDLE, "utf8");
    const from = 'case "not-running":\n        break;\n    }\n    const woke = await wakeSession(';
    expect(source.includes(from)).toBe(true);
    const brokenSource = source.replace(from, 'case "not-running":\n        return ok({ kind: "watch", watch: openNow(), wrote: false });\n    }\n    const woke = await wakeSession(');
    const { app: broken, appHome } = newApp("no-wake", { gcBin: GC_BIN }, brokenSource);
    broken.addCopy();
    send(broken, "probe:on");
    await waitConnected(appHome);
    await waitFor("the broken copy to list the session", 15_000, () => readProbe(appHome)?.sessions.some((s) => s.id === sessionId), 200);
    await suspendAndWait(sessionId);
    await waitShownNotRunning(appHome, "the broken copy");
    lastTab = null;
    send(broken, `attach:${CITY}:${sessionId}`);
    const tab = await waitFor("the broken mod to open a tab", 30_000, () => lastTab, 100);
    const moment: AttachMoment = { sessionId, at: tab.at, wasRunning: false, runningAtTabNew: await tab.running };
    const violations = wakeBeforeAttach(moment, broken.meter.log);
    steps.push({ step: "no-wake variant", moment, violations });
    log(`no-wake variant: ${violations.join("; ")}`);
    expect(violations.some((v) => v.includes("did not wake it"))).toBe(true);
    await sleep(2_000);
    await terminals.kill(tab.terminal);
    await broken.closeAll();
    if (!(await gcSession(sessionId)).running) await wakeAndWait(sessionId);
  }, 120_000);

  test("negative: a city gc does not have shows why", async () => {
    const { app: a, appHome } = newApp("unknown-city", { gcBin: GC_BIN });
    a.addCopy({ city: "no-such-city" });
    send(a, "probe:on");
    const p = await waitFor("the unknown-city banner", 30_000, () => {
      const doc = readProbe(appHome);
      return doc?.connection.text.includes('city "no-such-city" is not registered with gc') ? doc : null;
    }, 200, () => JSON.stringify(readProbe(appHome)?.connection ?? null));
    steps.push({ step: "unknown city", connection: p.connection });
    await a.closeAll();
  }, 60_000);

  test("negative: a sling gc never answers is an unknown outcome, refreshed before a retry", async () => {
    proxy = startHoldingProxy(city.apiUrl, (m, path) => m === "POST" && path.endsWith("/sling"), 45_000);
    const { app: a, appHome } = newApp("sling-timeout", { gcBin: GC_BIN, apiUrl: proxy.url });
    a.addCopy();
    send(a, "probe:on");
    await waitConnected(appHome);
    const title = `sling ${runId}`;
    const made = await city.api("POST", city.cityPath("/beads"), { title });
    const bead = (made.body as { id: string }).id;
    await waitFor("the bead on the proxied board", 20_000, () => readProbe(appHome)?.board?.ready.cards.some((c) => c.id === bead), 200);
    send(a, `sling:${CITY}:${bead}:${AGENT}:confirm`);
    const unknown = await waitFor("the sling's outcome unknown", 45_000, () => {
      const x = newestAction(readProbe(appHome), "bead.sling");
      return x && x.state === "unknown" ? x : null;
    }, 200, () => JSON.stringify(newestAction(readProbe(appHome), "bead.sling") ?? null));
    expect(unknown.detail).toContain("unknown");
    const refreshed = await waitFor("the board refreshed before a retry is offered", 30_000, () => {
      const x = newestAction(readProbe(appHome), "bead.sling");
      return x && x.detail.includes("has been refreshed") ? x : null;
    }, 200);
    const slings = a.meter.log.filter((r) => r.method === "POST" && r.url.endsWith("/sling"));
    expect(slings.length).toBe(1);
    expect(slings[0]!.error ?? "").toContain("timed out");
    const ended = slings[0]!.endedAt!;
    expect(ended - slings[0]!.startedAt).toBeGreaterThanOrEqual(29_000);
    const refetch = a.meter.log.find((r) => r.method === "GET" && r.startedAt >= ended && r.url.includes("/work/ready"));
    expect(refetch).toBeDefined();
    steps.push({ step: "sling timeout", unknown: unknown.detail, refreshed: refreshed.detail, held: proxy.held.length });
    await a.closeAll();
  }, 150_000);

  test("negative: the supervisor dies mid-run: banner, degraded budget, then back", async () => {
    const stoppedAt = Date.now();
    // A crash, not gc's graceful stop (which first takes the city off /v0/cities).
    await city.stopSupervisor("crash");
    const p = await waitFor("the unreachable banner", 30_000, () => {
      const doc = readProbe(main());
      return doc && /reconnecting in|not reachable/.test(doc.connection.text) ? doc : null;
    }, 200, () => JSON.stringify(readProbe(main())?.connection ?? null));
    await sleep(15_000);
    const failures = app.meter.log.filter((r) => r.startedAt >= stoppedAt && r.error !== null);
    expect(failures.length).toBeGreaterThan(0);
    // Once every request started before the first failure has ended, at most one is in flight.
    const firstFail = Math.min(...failures.map((r) => r.endedAt!));
    const settled = Math.max(firstFail, ...app.meter.log.filter((r) => r.startedAt < firstFail).map((r) => r.endedAt ?? Date.now()));
    const over = overBudget(app.meter.log, settled, Date.now(), 1);
    steps.push({ step: "supervisor died", banner: p.connection, requestsWhileDown: app.meter.log.filter((r) => r.startedAt >= settled).length, overBudget: over.length });
    expect(over).toEqual([]);
    await city.startSupervisor();
    await city.waitRunning();
    send(app, "refresh");
    await waitConnected(main(), 90_000);
  }, 200_000);

  test("negative: a hardened city (signed write grants): reads work, a change fails with the write-grant reason", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
    // gc's graceful stop first takes the city off /v0/cities, then stops answering: the chip must end up
    // saying gc is unreachable (or the city's store is reconnecting), never that the city is not registered.
    await city.stopSupervisor();
    const down = await waitFor("the stopped supervisor read as unreachable", 60_000, () => {
      const doc = readProbe(main());
      return doc && /reconnecting in|not reachable/.test(doc.connection.text) ? doc : null;
    }, 200, () => JSON.stringify(readProbe(main())?.connection ?? null));
    expect(down.connection.text).not.toContain("not registered");
    steps.push({ step: "graceful supervisor stop", chip: down.connection, phase: down.city_phase });
    await city.startSupervisor({ kind: "write-grants", verifyKey: `m7:${raw}` });
    await city.waitRunning();
    send(app, "refresh");
    await waitConnected(main(), 90_000);
    send(app, `bead-new:${CITY}:${enc(`hardened ${runId}`)}`);
    const failed = await waitFor("the create to fail", 30_000, () => {
      const x = newestAction(readProbe(main()), "bead.create");
      return x && x.title.includes(`hardened ${runId}`) && x.state !== "pending" ? x : null;
    }, 200);
    expect(failed.state).toBe("failed");
    expect(failed.detail).toContain("this city requires a signed write grant");
    // The refusal is the city's, not only the action's: the header's chip and banner say so.
    const p = await waitFor("the write-grant chip and banner", 10_000, () => {
      const doc = readProbe(main());
      return doc && doc.connection.text === "connected, read-only" && doc.banners.some((b) => b.includes("requires signed write grants")) ? doc : null;
    }, 200, () => JSON.stringify({ connection: readProbe(main())?.connection ?? null, banners: readProbe(main())?.banners ?? null }));
    steps.push({ step: "hardened city", action: failed.detail, chip: p.connection, banners: p.banners });
    expect(p.city_phase).toBe("city-running");
  }, 200_000);

  test("negative: a read-only bind: reads work, a change fails with gc's read-only reason", async () => {
    await city.stopSupervisor();
    // Still loopback only (see SupervisorMode "read-only"); the mod is given the URL, as supervisor.toml's bind is not one it dials.
    await city.startSupervisor({ kind: "read-only" });
    await city.waitRunning();
    for (const ip of nonLoopbackIPv4()) {
      const reached = await fetch(`http://${ip}:${city.port}/health`, { signal: AbortSignal.timeout(2_000) }).then(() => true, () => false);
      expect(reached).toBe(false);
    }
    const { app: a, appHome } = newApp("read-only", { gcBin: GC_BIN, apiUrl: city.apiUrl });
    a.addCopy();
    send(a, "probe:on");
    await waitConnected(appHome, 90_000);
    send(a, `bead-new:${CITY}:${enc(`read-only ${runId}`)}`);
    const failed = await waitFor("the create to fail", 30_000, () => {
      const x = newestAction(readProbe(appHome), "bead.create");
      return x && x.title.includes(`read-only ${runId}`) && x.state !== "pending" ? x : null;
    }, 200);
    expect(failed.state).toBe("failed");
    expect(failed.detail).toContain("gc serves this API read-only (read_only:");
    const p = await waitFor("the read-only chip and banner", 10_000, () => {
      const doc = readProbe(appHome);
      return doc && doc.connection.text === "read-only server" && doc.banners.some((b) => b.includes("gc serves this API read-only (read_only:")) ? doc : null;
    }, 200, () => JSON.stringify({ connection: readProbe(appHome)?.connection ?? null, banners: readProbe(appHome)?.banners ?? null }));
    steps.push({ step: "read-only bind", action: failed.detail, chip: p.connection, banners: p.banners });
    await a.closeAll();
    await city.stopSupervisor();
    await city.startSupervisor();
  }, 200_000);

  test("the fetch budget never exceeded 2; no host rule broken; no task failed", () => {
    const budget = apps.map((a) => ({ app: a.name, max: a.app.meter.max, probe: readProbe(a.appHome)?.fetch_in_flight_max ?? null }));
    steps.push({ step: "fetch budget", budget });
    for (const b of budget) {
      expect(b.max).toBeLessThanOrEqual(2);
      if (b.probe !== null) expect(b.probe).toBeLessThanOrEqual(2);
    }
    for (const a of apps) {
      expect(a.app.violations).toEqual([]);
      expect(a.app.taskErrors).toEqual([]);
      // Every run() was a tab.new of an attach argv or a tab.select.
      for (const r of a.app.runs) expect(["tab.new", "tab.select"]).toContain(r.name);
    }
  });

  test("teardown stops everything this run started, and only that", async () => {
    await teardown();
    const left = carrying(readProcessTable(), RUN_MARKER, runId).filter((p) => p.pid !== process.pid);
    expect(left.map((p) => `${p.pid} ${commandLine(p)}`)).toEqual([]);
  }, 120_000);
});
