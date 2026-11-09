// A live stand-in for herdr-app that runs the built gascity/main.js in bun,
// in real time, against a real gc:
//
//   - `fetch` is real but constrained like herdr's (gpui-kit shell
//     standard/fetch.rs): options {method, headers, body} only, the headers
//     herdr refuses are refused, a fixed 30 s timeout, an 8 MiB cap on the
//     request and the response, the whole body read before it resolves, and a
//     response with status/ok/url/text()/json() and no headers. Every request
//     is metered: how many were in flight at once, app-wide;
//   - `exec` is real but allowlisted: `<gc> supervisor status --json` only;
//     anything else is a recorded violation and is not run;
//   - `run` is recorded; `tab.new` starts the tab's argv in a PTY under
//     herdr's shell wrapper with a fresh HC_SCOPE token (terminals.ts) and
//     makes the new tab active, as herdr does; `tab.select` selects a tab;
//   - `spaces()`, `panes()`, `focused()` and `terminals()` describe one local
//     space: the mod's tab (one pane per copy) plus the tabs tab.new opened;
//   - commands go only to copies on screen (the mod's tab selected), as
//     `herdr-app do gascity.<command>` does; a copy that is not waiting yet
//     gets them queued;
//   - async ownership follows herdr: a copy's init, timers, spawned tasks and
//     their continuations run as that copy (AsyncLocalStorage), which is what
//     nextCommand(), props() and the per-copy localStorage answer for;
//   - gpui-kit is the test harness's element recorder: notify() re-renders
//     the copy (throttled) and the last tree is kept.

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluateModule, fakeGpui, FAKE_THEME, findById, nodeOf, renderContext, textOf, type RecordedNode } from "../harness.ts";
import type { PtyTerminals, Terminal } from "./terminals.ts";

/** herdr's fetch limits (fetch.rs). */
export const HERDR_FETCH_TIMEOUT_MS = 30_000;
export const HERDR_FETCH_MAX_BYTES = 8 * 1024 * 1024;
const PROHIBITED_HEADERS = new Set(["host", "content-length", "connection", "expect", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

/** One request herdr's fetch ran. */
export interface FetchRecord {
  method: string;
  url: string;
  startedAt: number;
  endedAt: number | null;
  status: number | null;
  error: string | null;
  /** Requests in flight (this one included) when it started. */
  concurrent: number;
}

/** Counts herdr fetches in flight across every copy of one app. */
export class FetchMeter {
  inFlight = 0;
  max = 0;
  readonly log: FetchRecord[] = [];

  /** The most requests in flight at once among those started in [from, to). */
  maxConcurrentBetween(from: number, to = Infinity): number {
    let max = 0;
    for (const r of this.log) if (r.startedAt >= from && r.startedAt < to) max = Math.max(max, r.concurrent);
    return max;
  }
}

/** A fetch with herdr's options, limits and response shape. */
export function herdrFetch(meter: FetchMeter, timeoutMs = HERDR_FETCH_TIMEOUT_MS) {
  return async (url: string, options?: unknown): Promise<{ status: number; ok: boolean; url: string; text(): Promise<string>; json(): Promise<unknown> }> => {
    let method = "GET";
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (options !== undefined && options !== null) {
      if (typeof options !== "object") throw new TypeError("fetch(url, options) expects an object with method, headers and/or body");
      for (const [key, value] of Object.entries(options)) {
        if (key === "method") method = String(value).toUpperCase();
        else if (key === "headers") {
          if (value === null || typeof value !== "object") throw new TypeError("fetch(url, options).headers expects a plain object of string values");
          for (const [name, v] of Object.entries(value)) {
            if (PROHIBITED_HEADERS.has(name.toLowerCase())) throw new TypeError(`fetch(url, options).headers may not set \`${name}\``);
            if (typeof v !== "string") throw new TypeError("fetch(url, options).headers expects string header values");
            headers[name] = v;
          }
        } else if (key === "body") {
          if (value !== undefined && value !== null) body = String(value);
        } else throw new TypeError(`unknown option \`${key}\` for fetch(url, options); expected method, headers or body`);
      }
    }
    if (body !== undefined && Buffer.byteLength(body) > HERDR_FETCH_MAX_BYTES) throw new RangeError(`fetch request body exceeded the ${HERDR_FETCH_MAX_BYTES} byte limit`);
    const record: FetchRecord = { method, url, startedAt: Date.now(), endedAt: null, status: null, error: null, concurrent: ++meter.inFlight };
    meter.max = Math.max(meter.max, meter.inFlight);
    meter.log.push(record);
    try {
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" };
      if (body !== undefined) init.body = body;
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        const why = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError") ? "operation timed out" : cause instanceof Error ? cause.message : String(cause);
        throw new Error(`fetching ${url} failed: error sending request for url (${url}): ${why}`);
      }
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch (cause) {
        const why = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError") ? "operation timed out" : String(cause);
        throw new Error(`reading response from ${response.url} failed: ${why}`);
      }
      if (bytes.byteLength > HERDR_FETCH_MAX_BYTES) throw new Error(`response body from ${response.url} exceeded the ${HERDR_FETCH_MAX_BYTES} byte limit`);
      const text = new TextDecoder().decode(bytes);
      record.status = response.status;
      return { status: response.status, ok: response.status >= 200 && response.status < 300, url: response.url, text: () => Promise.resolve(text), json: () => Promise.resolve(JSON.parse(text)) };
    } catch (e) {
      record.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      record.endedAt = Date.now();
      meter.inFlight--;
    }
  };
}

/** Whether `argv` (program first) is the one exec the mod may run: `<gc> supervisor status --json`. */
export function execAllowed(command: string, args: readonly string[]): boolean {
  return /(^|\/)gc$/.test(command) && args.length === 3 && args[0] === "supervisor" && args[1] === "status" && args[2] === "--json";
}

/** One tab of the local space. */
interface Tab {
  id: string;
  name: string;
  /** The mod's tab holds the copies' panes; an attach tab holds one terminal. */
  terminal: string | null;
}

/** A copy of the mod as herdr runs it. */
export interface LiveCopy {
  name: string;
  pane: string;
  tab: string;
  /** Times notify() was called. */
  notifies(): number;
  /** The last render, or a fresh one. */
  render(): RecordedNode;
  /** All text of a fresh render. */
  text(): string;
  /** The text under the element with this id in a fresh render, or null when it is not drawn. */
  textAt(id: string): string | null;
  close(): Promise<void>;
}

export interface LiveHerdrOptions {
  /** The bundle source (default: the committed gascity/main.js). */
  source: string;
  /** herdr-app's home (probe file, data). */
  appHome: string;
  /** What home() returns (so ~/.gc/supervisor.toml is the scratch city's). */
  home: string;
  /** The environment exec runs gc with (the scratch city's). */
  execEnv: Record<string, string>;
  terminals: PtyTerminals;
  shared?: Record<string, unknown>;
  log: (line: string) => void;
  /** Called after tab.new started a terminal (the test reads gc's state at that moment). */
  onTabNew?: (t: Terminal) => void;
}

/** The fake herdr-app: one local space, the mod's tab, and the tabs it opens. */
export class LiveHerdr {
  readonly meter = new FetchMeter();
  /** Every run(name, args), in order. */
  readonly runs: { at: number; name: string; args: unknown }[] = [];
  /** Every exec the mod asked for, run or refused. */
  readonly execs: { at: number; argv: string[]; allowed: boolean }[] = [];
  readonly toasts: unknown[] = [];
  /** Broken rules: an exec or run outside the allowlist, a host call that threw. */
  readonly violations: string[] = [];
  /** Exceptions from a copy's tasks, timers or renders: each one fails the test. */
  readonly taskErrors: string[] = [];
  readonly shared: Map<string, unknown>;
  private readonly als = new AsyncLocalStorage<string>();
  private readonly copies = new Map<string, { copy: LiveCopy; props: unknown; storage: Map<string, string>; waiting: ((c: string) => void)[]; queued: string[]; closed: boolean }>();
  private readonly tabs: Tab[] = [{ id: "t1", name: "Gas City", terminal: null }];
  private activeTab = "t1";
  private paneSeq = 0;
  private tabSeq = 1;
  private readonly Mod: new () => { init?(p: unknown, cx: unknown): void; render(cx: unknown): unknown; close?(cx: unknown): unknown };

  constructor(private readonly o: LiveHerdrOptions) {
    this.shared = new Map(Object.entries(o.shared ?? {}));
    const herdr = this.hostModule();
    const fetch = herdrFetch(this.meter);
    const self = this;
    const localStorage = {
      getItem: (key: string) => self.store().get(key) ?? null,
      setItem: (key: string, value: string) => void self.store().set(key, String(value)),
      removeItem: (key: string) => void self.store().delete(key),
    };
    this.Mod = evaluateModule(o.source, { ...fakeGpui(), herdr }, { fetch, localStorage });
  }

  /** The tab holding the copies. */
  get modTab(): string {
    return "t1";
  }

  private current(): string {
    const name = this.als.getStore();
    if (name === undefined) throw new Error("herdr: a host call outside any copy's turn");
    return name;
  }

  private store(): Map<string, string> {
    const c = this.copies.get(this.current());
    if (!c) throw new Error("herdr: no such copy");
    return c.storage;
  }

  private record(name: string, args: unknown): void {
    this.runs.push({ at: Date.now(), name, args: structuredClone(args) });
  }

  private hostModule(): Record<string, unknown> {
    const self = this;
    return {
      theme: () => ({ ...FAKE_THEME }),
      props: () => {
        const c = self.copies.get(self.current());
        return c?.props === undefined ? null : structuredClone(c.props);
      },
      shared: (key: string) => (self.shared.has(key) ? structuredClone(self.shared.get(key)) : null),
      setShared: (key: string, value: unknown) => {
        self.shared.set(key, structuredClone(value));
        return null;
      },
      notify: (n: unknown) => {
        self.toasts.push(structuredClone(n));
        return `toast-${self.toasts.length}`;
      },
      nextCommand: () => {
        const c = self.copies.get(self.current());
        if (!c) return Promise.reject(new Error("no copy"));
        const next = c.queued.shift();
        if (next !== undefined) return Promise.resolve(next);
        return new Promise<string>((resolve) => c.waiting.push(resolve));
      },
      run: (name: string, args: unknown) => self.run(name, args),
      closeOverlay: (id: unknown) => {
        self.record("closeOverlay", id);
        return null;
      },
      home: () => self.o.home,
      appHome: () => self.o.appHome,
      readTextFile: async (path: string) => {
        try {
          return readFileSync(path, "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
      },
      writeTextFile: async (path: string, text: string, expected: string | null) => {
        if (!path.startsWith(`${self.o.appHome}/`)) throw new Error(`writeTextFile outside the app home: ${path}`);
        let current: string | null = null;
        try {
          current = readFileSync(path, "utf8");
        } catch {
          current = null;
        }
        if (current !== expected) throw new Error("stale snapshot");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(`${path}.tmp`, text);
        renameSync(`${path}.tmp`, path);
        return null;
      },
      exec: async (command: string, args: string[], opts?: { timeout?: number }) => {
        const argv = [command, ...args];
        const allowed = execAllowed(command, args);
        self.execs.push({ at: Date.now(), argv, allowed });
        if (!allowed) {
          self.violations.push(`exec outside the allowlist: ${JSON.stringify(argv)}`);
          throw new Error(`integration herdr: exec refused: ${JSON.stringify(argv)}`);
        }
        const proc = Bun.spawn(argv, { env: self.o.execEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => proc.kill("SIGKILL"), opts?.timeout ?? 30_000);
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        clearTimeout(timer);
        return { code, stdout, stderr };
      },
      spaces: () => [{
        id: "s1", index: 1, name: "s1", named: false, folder: self.o.home, machine: null, branch: null, active: true, status: null,
        tabs: self.tabs.map((t, i) => ({ id: t.id, index: i + 1, name: t.name, named: true, active: t.id === self.activeTab, status: null, panes: 1, zoomed: false, settled: false, settled_at: null, changed_at: null })),
      }],
      panes: () => self.panes(),
      focused: () => ({ space: "s1", tab: self.activeTab, pane: self.panes().find((p) => p.tab === self.activeTab)?.pane ?? null, terminal: null }),
      terminals: () => self.o.terminals.records(),
      layout: () => ({ type: "column", children: [] }),
      updates: () => ({ app: { version: "0.1.14" } }),
    };
  }

  private panes(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const [, c] of this.copies) {
      if (!c.closed) out.push({ pane: c.copy.pane, terminal: null, mod: "gascity", tab: c.copy.tab, title: "Gas City", focused: false, zoomed: false });
    }
    for (const t of this.tabs) {
      if (t.terminal !== null) out.push({ pane: `p-${t.terminal}`, terminal: t.terminal, tab: t.id, title: t.name, cwd: this.o.home, branch: null, status: null, app: null, program: {}, focused: false, zoomed: false, movable: true });
    }
    return out;
  }

  private run(name: string, args: unknown): null {
    this.record(name, args);
    if (name === "tab.select") {
      const id = (args as { id?: unknown })?.id;
      if (typeof id !== "string" || !this.tabs.some((t) => t.id === id)) throw new Error(`no tab ${String(id)}`);
      this.activeTab = id;
      return null;
    }
    if (name === "tab.new") {
      const a = args as { space?: unknown; name?: unknown; argv?: unknown };
      if (a.space !== "s1" || typeof a.name !== "string" || !Array.isArray(a.argv) || !a.argv.every((x) => typeof x === "string")) {
        this.violations.push(`tab.new with unexpected arguments: ${JSON.stringify(args)}`);
        throw new Error("tab.new: bad arguments");
      }
      const id = `t${++this.tabSeq}`;
      const terminal = this.o.terminals.launch(a.argv as string[], { tab: id, space: "s1" });
      this.tabs.push({ id, name: a.name, terminal: terminal.address });
      this.activeTab = id;
      this.o.log(`tab.new ${id} (${terminal.address}, pid ${terminal.pid}, HC_SCOPE=${terminal.scope}): ${JSON.stringify(a.argv)}`);
      this.o.onTabNew?.(terminal);
      return null;
    }
    this.violations.push(`run outside the allowlist: ${name} ${JSON.stringify(args)}`);
    throw new Error(`integration herdr: run(${name}) is not modelled`);
  }

  /** Selects a tab, as `herdr-app do tab.select --id` does. */
  selectTab(id: string): void {
    if (!this.tabs.some((t) => t.id === id)) throw new Error(`no tab ${id}`);
    this.activeTab = id;
  }

  /** Whether the mod's tab is the active one (its copies are on screen). */
  modShown(): boolean {
    return this.activeTab === this.modTab;
  }

  /** Adds a copy in the mod's tab (a new pane) and runs its init, as herdr does. */
  addCopy(props?: unknown): LiveCopy {
    const name = `copy-${this.copies.size + 1}`;
    const pane = `p${++this.paneSeq}`;
    const view = new this.Mod();
    let notifies = 0;
    let last: RecordedNode | null = null;
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let closed = false;
    const self = this;
    const fail = (where: string, e: unknown) => {
      self.taskErrors.push(`${name} ${where}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    };
    const doRender = (): RecordedNode => self.als.run(name, () => {
      last = nodeOf(view.render(renderContext()));
      return last;
    });
    const scheduleRender = () => {
      if (renderTimer !== null || closed) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        try {
          doRender();
        } catch (e) {
          fail("render", e);
        }
      }, 100);
    };
    const handles: { focused: boolean }[] = [];
    const cx = {
      kind: "async" as const,
      notify: () => {
        notifies++;
        scheduleRender();
      },
      focus_handle: () => {
        const state = { focused: false };
        handles.push(state);
        return { focus: () => { state.focused = true; }, is_focused: () => state.focused, release: () => true };
      },
      sleep: (ms?: number) => new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms ?? 0);
        timers.push(t);
      }),
      spawn: (body: (cx: unknown) => unknown) => {
        if (closed) return { id: 0 };
        void self.als.run(name, () => Promise.resolve().then(() => body(cx))).catch((e: unknown) => fail("task", e));
        return { id: 1 };
      },
      timer: {
        every: (ms: number, handler: (cx: unknown) => void) => {
          let cancelled = false;
          const loop = () => {
            if (cancelled || closed) return;
            try {
              self.als.run(name, () => handler(cx));
            } catch (e) {
              fail("timer", e);
            }
            // herdr measures the interval from the end of the previous call.
            timers.push(setTimeout(loop, ms));
          };
          timers.push(setTimeout(loop, ms));
          return { cancel: () => { cancelled = true; }, is_done: () => cancelled };
        },
      },
    };
    const entry = { copy: null as unknown as LiveCopy, props, storage: new Map<string, string>(), waiting: [] as ((c: string) => void)[], queued: [] as string[], closed: false };
    const copy: LiveCopy = {
      name,
      pane,
      tab: this.modTab,
      notifies: () => notifies,
      render: () => last ?? doRender(),
      text: () => textOf(doRender()),
      textAt: (id: string) => {
        const node = findById(doRender(), id);
        return node === undefined ? null : textOf(node);
      },
      close: async () => {
        await self.als.run(name, async () => view.close?.(cx));
        closed = true;
        entry.closed = true;
        for (const t of timers) clearTimeout(t);
        timers = [];
        if (renderTimer !== null) clearTimeout(renderTimer);
      },
    };
    entry.copy = copy;
    this.copies.set(name, entry);
    try {
      this.als.run(name, () => view.init?.(undefined, cx));
    } catch (e) {
      fail("init", e);
    }
    return copy;
  }

  /**
   * `herdr-app do gascity.<command>`: delivered to every copy on screen; an
   * error when none is (herdr's "no shown copy" toast).
   */
  do(command: string): number {
    if (!this.modShown()) throw new Error(`herdr-app do gascity.${command}: no shown copy (the mod's tab is not selected)`);
    let n = 0;
    for (const [, c] of this.copies) {
      if (c.closed) continue;
      const waiter = c.waiting.shift();
      if (waiter) waiter(command);
      else c.queued.push(command);
      n++;
    }
    this.o.log(`do gascity.${command} -> ${n} copies`);
    return n;
  }

  /** Closes every copy (teardown). */
  async closeAll(): Promise<void> {
    for (const [, c] of this.copies) if (!c.closed) await c.copy.close();
  }
}
