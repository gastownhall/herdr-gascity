// Test harness for the built mod bundle, after herdr-app's own mod tests
// (herdr-app v0.1.14 `scripts/worktree.test.ts`, `scripts/agents.test.ts`):
// the bundle's host imports are replaced by injected fakes, the source is
// evaluated with `new Function`, and gpui-kit builders are a Proxy that
// records ids, text, children and handlers instead of laying anything out.
//
// `new Function` is fine here: this is test code under bun, never shipped.
// The authority lint (scripts/authority.ts) forbids it in `src/` and in the
// bundle.

import { readFile } from "node:fs/promises";

/** One recorded element: its id, children, handlers and every builder call. */
export interface RecordedNode {
  id: string;
  children: (RecordedNode | string)[];
  handlers: Record<string, (...args: unknown[]) => unknown>;
  calls: { method: string; args: unknown[] }[];
}

const HANDLER = /^on_/;

/** A gpui-kit element builder that records instead of drawing. */
export function element(): any {
  const node: RecordedNode = { id: "", children: [], handlers: {}, calls: [] };
  const el: any = new Proxy(node, {
    get: (_, method) => {
      if (method === "node") return node;
      if (typeof method !== "string") return undefined;
      return (...args: any[]) => {
        node.calls.push({ method, args });
        if (method === "id") node.id = String(args[0]);
        else if (method === "child") node.children.push(args[0]?.node ?? args[0]);
        else if (method === "children") node.children.push(...args[0].map((c: any) => c?.node ?? c));
        else if (method === "when" && args[0]) args[1](el);
        else if (HANDLER.test(method)) node.handlers[method] = args[args.length - 1];
        return el;
      };
    },
  });
  return el;
}

/** The recorded node behind an element (or the node itself). */
export function nodeOf(el: any): RecordedNode {
  return el?.node ?? el;
}

/** All text under a node, space-joined, in document order. */
export function textOf(node: RecordedNode | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join(" ");
}

/** The first node with this id, depth-first, or undefined. */
export function findById(node: RecordedNode | string, id: string): RecordedNode | undefined {
  if (typeof node === "string") return undefined;
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Every argument list passed to `method` on this node. */
export function callsTo(node: RecordedNode, method: string): unknown[][] {
  return node.calls.filter((c) => c.method === method).map((c) => c.args);
}

/** Host modules by specifier: "herdr", "gpui-kit", "gpui-base". */
export type HostModules = Record<string, Record<string, unknown>>;

const NAMESPACE_IMPORT = /^import \* as (\w+) from "([^"]+)";$/;
const NAMED_IMPORT = /^import \{([^}]*)\} from "([^"]+)";$/;
const DEFAULT_IMPORT = /^import (\w+) from "([^"]+)";$/;
const DEFAULT_EXPORT_LIST = /^export \{\s*(\w+) as default\s*\};$/m;
const DEFAULT_EXPORT_CLASS = /^export default class (\w+)/m;

/**
 * Turns an ES module's source into a function body that takes the host
 * modules and returns the default export. Only the import/export shapes a
 * herdr mod bundle uses are accepted; anything else throws, so a new shape is
 * noticed instead of evaluated wrongly.
 */
export function moduleBody(source: string): string {
  const out: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*import[\s{*"]/.test(line)) {
      out.push(line);
      continue;
    }
    // esbuild prints a long named import across several lines.
    let statement = line.trim();
    while (!statement.endsWith(";") && i + 1 < lines.length) statement += " " + lines[++i]!.trim();
    statement = statement.replace(/\s+/g, " ").replace("{ ", "{").replace(" }", "}");
    let m: RegExpMatchArray | null;
    if ((m = statement.match(NAMESPACE_IMPORT))) {
      out.push(`const ${m[1]} = __host(${JSON.stringify(m[2])}, []);`);
    } else if ((m = statement.match(NAMED_IMPORT))) {
      const specifiers = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      const imported = specifiers.map((s) => s.split(" as ")[0]!);
      const bindings = specifiers.map((s) => s.replace(/^(\w+) as (\w+)$/, "$1: $2"));
      out.push(`const {${bindings.join(", ")}} = __host(${JSON.stringify(m[2])}, ${JSON.stringify(imported)});`);
    } else if ((m = statement.match(DEFAULT_IMPORT))) {
      out.push(`const ${m[1]} = __host(${JSON.stringify(m[2])}, ["default"]).default;`);
    } else {
      throw new Error(`harness: unsupported import shape: ${statement}`);
    }
  }
  let body = out.join("\n");
  let name: string | undefined;
  const list = body.match(DEFAULT_EXPORT_LIST);
  if (list) {
    name = list[1];
    body = body.replace(DEFAULT_EXPORT_LIST, "");
  } else {
    const cls = body.match(DEFAULT_EXPORT_CLASS);
    if (cls) {
      name = cls[1];
      body = body.replace(DEFAULT_EXPORT_CLASS, `class ${name}`);
    }
  }
  if (!name) throw new Error("harness: module has no default export");
  if (/^\s*export\b/m.test(body)) throw new Error("harness: unsupported export shape");
  return `"use strict";\n${body}\nreturn ${name};`;
}

/**
 * Evaluates a module's source (strict, like an ES module) against the given
 * host modules; returns its default export. A named import the host module
 * lacks throws before any module code runs, as herdr's module linker refuses
 * to load such a mod.
 */
export function evaluateModule(source: string, modules: HostModules, globals: Record<string, unknown> = {}): any {
  const host = (specifier: string, names: readonly string[]) => {
    const mod = modules[specifier];
    if (!mod) throw new Error(`harness: no fake for host module "${specifier}"`);
    for (const name of names) {
      if (!(name in mod)) throw new SyntaxError(`module "${specifier}" does not provide an export named "${name}"`);
    }
    return mod;
  };
  // Script globals (fetch, localStorage) are parameters, so the module sees
  // the fakes and never bun's own globals.
  const names = Object.keys(globals);
  return new Function("__host", ...names, moduleBody(source))(host, ...names.map((n) => globals[n]));
}

/**
 * The context `init`, `close`, click handlers and tasks get (gpui-kit
 * `AsyncContext`): counts notifies, runs `spawn`ed tasks at once and keeps
 * their promises for `settle()`, records `sleep`s, which never resolve (no
 * fake timer passes on its own), and keeps `timer.every` handlers, which run
 * only when the test calls `fireTimers()` (none after `cancelAll()`, as
 * herdr cancels a closed copy's tasks).
 */
export function asyncContext() {
  const tasks: Promise<unknown>[] = [];
  let timers: { ms: number; handler: (cx: unknown) => void }[] = [];
  const cx = {
    kind: "async" as const,
    notifies: 0,
    sleeps: [] as number[],
    timerPeriods: [] as number[],
    notify() { cx.notifies++; },
    timer: {
      every(ms: number, handler: (cx: unknown) => void) {
        cx.timerPeriods.push(ms);
        timers.push({ ms, handler });
        return { cancel() {}, is_done: () => false };
      },
    },
    /** Runs every periodic timer handler once, as one period passing. */
    fireTimers() {
      for (const t of [...timers]) t.handler(cx);
    },
    /** herdr closed the copy: its timers never fire again. */
    cancelAll() {
      timers = [];
    },
    spawn(body: (cx: unknown) => unknown) {
      tasks.push(Promise.resolve().then(() => body(cx)));
      return { id: tasks.length };
    },
    sleep(ms?: number): Promise<void> {
      cx.sleeps.push(ms ?? 0);
      return new Promise(() => {});
    },
    /** Waits until every spawned task (including ones spawned meanwhile) has finished; rethrows a task's rejection. */
    async settle(): Promise<void> {
      for (let seen = -1; seen !== tasks.length;) {
        seen = tasks.length;
        await Promise.all(tasks);
      }
    },
  };
  return cx;
}

/** The context `render` gets. Notifying from render would re-render forever, so it throws. */
export function renderContext() {
  return {
    kind: "render" as const,
    notify(): never { throw new Error("harness: cx.notify() during render"); },
  };
}

/** The fake gpui-kit and gpui-base modules: a View base class and recording builders. */
export function fakeGpui(): HostModules {
  return {
    "gpui-kit": { View: class {}, div: element },
    "gpui-base": { v_flex: element, h_flex: element },
  };
}

/** A herdr theme with some of the colour names herdr documents. */
export const FAKE_THEME: Readonly<Record<string, string>> = Object.freeze({
  background: "#101010", foreground: "#f0f0f0", muted: "#808080", dim: "#606060",
  accent: "#3080ff", border: "#303030", surface: "#181818", blocked: "#ff5050",
});

/** herdr's exec result. */
export interface FakeExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The home directory of the fake host. */
export const FAKE_HOME = "/home/person";

/**
 * Options for the fake host: the copy's props (absent = unpinned, so props()
 * is null), the theme, exports to drop, shared values, files readTextFile
 * sees, what exec answers.
 */
export interface FakeHostOptions {
  props?: unknown;
  theme?: Record<string, string>;
  omit?: string[];
  shared?: Record<string, unknown>;
  files?: Record<string, string>;
  /** readTextFile rejects with this message. */
  readTextFileRejects?: string;
  exec?: (command: string, args: string[], options: unknown) => Promise<FakeExecResult>;
  /** panes() and focused(): by default one gascity pane in the focused tab (on screen). */
  panes?: unknown[];
  focus?: unknown;
  /** Files writeTextFile writes (compare-and-swap against this map). */
  written?: Map<string, string>;
}

/** By default gc runs and, like today's gc, reports no api_url. */
const DEFAULT_EXEC = () => Promise.resolve({ code: 0, stdout: '{"running":true}', stderr: "" });

/** A fake `herdr` module whose every call is recorded. */
export function fakeHerdr(options: FakeHostOptions = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const all: Record<string, (...args: unknown[]) => unknown> = {
    theme: () => ({ ...(options.theme ?? FAKE_THEME) }),
    // herdr returns the props a copy was opened with, and null for an unpinned copy.
    props: () => (options.props === undefined ? null : structuredClone(options.props)),
    shared: (key) => (options.shared && Object.hasOwn(options.shared, key as string) ? structuredClone(options.shared[key as string]) : null),
    home: () => FAKE_HOME,
    readTextFile: (path) => {
      if (options.readTextFileRejects !== undefined) return Promise.reject(new Error(options.readTextFileRejects));
      const files = options.files ?? {};
      return Promise.resolve(Object.hasOwn(files, path as string) ? files[path as string] : null);
    },
    exec: (command, args, opts) => (options.exec ?? DEFAULT_EXEC)(command as string, args as string[], opts),
    panes: () => structuredClone(options.panes ?? [{ pane: "p1", tab: "t1", mod: "gascity", title: "gascity", focused: true }]),
    focused: () => structuredClone(options.focus === undefined ? { space: "s1", tab: "t1", pane: "p1", terminal: null } : options.focus),
    layout: () => ({ type: "column", children: [] }),
    appHome: () => `${FAKE_HOME}/.config/herdr-app`,
    writeTextFile: (path, text, expected) => {
      const files = options.written ?? new Map<string, string>();
      if ((files.get(path as string) ?? null) !== expected) return Promise.reject(new Error("stale snapshot"));
      files.set(path as string, text as string);
      return Promise.resolve(null);
    },
    updates: () => ({ app: { version: "0.1.14" } }),
  };
  const module: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(all)) {
    if (options.omit?.includes(name)) continue;
    module[name] = (...args: unknown[]) => { calls.push({ name, args }); return fn(...args); };
  }
  return { module, calls };
}

export const BUNDLE_PATH = new URL("../gascity/main.js", import.meta.url);

/** A scripted answer of the fake fetch. */
export type FakeReply = { status: number; body: unknown } | { rejects: string } | "hang";

/** Options for the script globals: fetch replies by URL, the copy's localStorage, globals to drop. */
export interface FakeGlobalsOptions {
  /** Reply for each exact URL; any other URL is refused, as by a closed port. */
  replies?: Record<string, FakeReply>;
  /** Consulted when no exact URL matches. */
  route?: (url: string) => FakeReply | undefined;
  storage?: Record<string, string>;
  /** localStorage.setItem throws this message. */
  storageThrows?: string;
  omitGlobals?: string[];
}

/** herdr's script globals the mod uses: a fetch that plays scripted replies, a localStorage, and a Date whose clock the test moves. */
export function fakeGlobals(options: FakeGlobalsOptions = {}) {
  const clock = { t: Date.UTC(2026, 10, 9, 12, 0, 0) };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.t);
      else super(...(args as [number]));
    }
    static override now(): number {
      return clock.t;
    }
  }
  const fetched: { url: string; init: unknown }[] = [];
  const storage = new Map(Object.entries(options.storage ?? {}));
  const all: Record<string, unknown> = {
    fetch: (url: string, init: unknown) => {
      fetched.push({ url, init });
      const reply = options.replies?.[url] ?? options.route?.(url) ?? { rejects: "error sending request: Connection refused (os error 111)" };
      if (reply === "hang") return new Promise(() => {});
      if ("rejects" in reply) return Promise.reject(new Error(reply.rejects));
      const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return Promise.resolve({ status: reply.status, ok: reply.status >= 200 && reply.status < 300, url, text: () => Promise.resolve(body) });
    },
    Date: FakeDate,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.storageThrows !== undefined) throw new Error(options.storageThrows);
        storage.set(key, String(value));
      },
      removeItem: (key: string) => { storage.delete(key); },
    },
  };
  const globals: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(all)) globals[name] = options.omitGlobals?.includes(name) ? undefined : value;
  return { globals, fetched, storage, clock };
}

/**
 * Loads the committed bundle (or `source`) with fake host modules and
 * constructs one copy, called the way herdr calls a root view: `init(undefined,
 * asyncCx)` (props come from `props()`), then `render(renderCx)`.
 */
export async function loadMod(options: FakeHostOptions & FakeGlobalsOptions & { source?: string } = {}) {
  const source = options.source ?? await readFile(BUNDLE_PATH, "utf8");
  const herdr = fakeHerdr(options);
  const host = fakeGlobals(options);
  const Mod = evaluateModule(source, { ...fakeGpui(), herdr: herdr.module }, host.globals);
  /** One copy of the mod: herdr shares module code by every copy; each has its own instance and tasks. */
  const copy = () => {
    const view = new Mod();
    const cx = asyncContext();
    const render = (): RecordedNode => nodeOf(view.render(renderContext()));
    return {
      view,
      cx,
      init: () => view.init?.(undefined, cx),
      render,
      /** Waits for every task the copy spawned. */
      settle: () => cx.settle(),
      /** One period of the copy's periodic timers (moving the clock by `ms`), then waits for its tasks and their fetches. */
      tick: async (ms = 250) => {
        host.clock.t += ms;
        cx.fireTimers();
        await cx.settle();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      },
      /** herdr closes the copy: close(cx), then its tasks are cancelled. */
      close: async () => {
        await view.close?.(cx);
        cx.cancelAll();
      },
      /** Clicks the element with this id in a fresh render, with the async context as the handler's cx. */
      click: (id: string) => {
        const node = findById(render(), id);
        if (!node?.handlers.on_click) throw new Error(`harness: no clickable element "${id}"`);
        node.handlers.on_click({}, cx);
      },
    };
  };
  return {
    ...copy(),
    /** Another copy sharing this module (and so its registry). */
    copy,
    herdrCalls: herdr.calls,
    fetched: host.fetched,
    storage: host.storage,
  };
}
