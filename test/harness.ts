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

/** Which builder made an element: gpui-kit's div, or gpui-base's row (h_flex) or column (v_flex). */
export type ElementKind = "div" | "h_flex" | "v_flex";

/** One recorded element: its builder, id, children, handlers and every builder call. */
export interface RecordedNode {
  kind: ElementKind;
  id: string;
  children: (RecordedNode | string)[];
  handlers: Record<string, (...args: unknown[]) => unknown>;
  calls: { method: string; args: unknown[] }[];
}

const HANDLER = /^on_/;

/** A gpui-kit element builder that records instead of drawing. */
export function element(kind: ElementKind = "div"): any {
  const node: RecordedNode = { kind, id: "", children: [], handlers: {}, calls: [] };
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
export function asyncContext(scope: (body: () => unknown) => unknown = (body) => body(), parked: () => number = () => 0) {
  const tasks: { done: boolean; failed: { error: unknown } | null }[] = [];
  const focusHandles: { focused: boolean; focusCalls: number }[] = [];
  let timers: { ms: number; handler: (cx: unknown) => void }[] = [];
  const cx = {
    kind: "async" as const,
    notifies: 0,
    /** Every focus handle the copy made (gpui-kit cx.focus_handle()). */
    focusHandles,
    focus_handle() {
      const state = { focused: false, focusCalls: 0 };
      focusHandles.push(state);
      return {
        focus() { state.focused = true; state.focusCalls++; },
        is_focused: () => state.focused,
        release: () => true,
      };
    },
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
      const task: (typeof tasks)[number] = { done: false, failed: null };
      tasks.push(task);
      void Promise.resolve().then(() => scope(() => body(cx))).then(
        () => { task.done = true; },
        (error: unknown) => { task.done = true; task.failed = { error }; },
      );
      return { id: tasks.length };
    },
    sleep(ms?: number): Promise<void> {
      cx.sleeps.push(ms ?? 0);
      return new Promise(() => {});
    },
    /**
     * Waits until every spawned task (including ones spawned meanwhile) has
     * finished, except the ones parked in nextCommand() (the copy's command
     * loop never ends); rethrows a task's rejection.
     */
    async settle(): Promise<void> {
      for (let round = 0; round < 10_000; round++) {
        const failed = tasks.find((t) => t.failed !== null)?.failed;
        if (failed) throw failed.error;
        if (tasks.filter((t) => !t.done).length <= parked()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("harness: a spawned task never finished");
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

/** A fake gpui-base InputState: its value, its event handlers, and a way for a test to type and press Enter. */
export interface FakeInputState {
  placeholder: string | undefined;
  value(): string;
  set_value(next: string): void;
  on(event: string, handler: (event: unknown, cx: unknown) => void): boolean;
  /** The person types `text` (replacing the value); the `change` handlers run, as for a real input. */
  type(text: string): void;
  /** The person presses Enter: the `submit` handlers run with `cx`. */
  submit(cx: unknown): void;
}

/** The fake gpui-kit and gpui-base modules: a View base class, recording builders, and text inputs. `inputs` lists every InputState created. */
export function fakeGpui(inputs: FakeInputState[] = []): HostModules {
  const InputState = {
    new: (options?: { placeholder?: string; value?: string }): FakeInputState => {
      let value = options?.value ?? "";
      const handlers: Record<string, ((event: unknown, cx: unknown) => void)[]> = {};
      const state: FakeInputState = {
        placeholder: options?.placeholder,
        value: () => value,
        set_value: (next) => {
          value = next;
        },
        on: (event, handler) => {
          (handlers[event] ??= []).push(handler);
          return true;
        },
        type: (text) => {
          value = text;
          for (const h of handlers.change ?? []) h({}, null);
        },
        submit: (cx) => {
          for (const h of handlers.submit ?? []) h({}, cx);
        },
      };
      inputs.push(state);
      return state;
    },
  };
  /** Input.new records its state as an `input` call on the element. */
  const Input = { new: (state: FakeInputState) => element().input(state) };
  return {
    "gpui-kit": { View: class {}, div: () => element("div") },
    "gpui-base": { v_flex: () => element("v_flex"), h_flex: () => element("h_flex"), Input, InputState },
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
  /** spaces(): by default one local space s1 (active) holding tab t1. */
  spaces?: unknown[];
  /** terminals(): by default none. */
  terminals?: unknown[];
  focus?: unknown;
  /** Files writeTextFile writes (compare-and-swap against this map). */
  written?: Map<string, string>;
}

/** By default gc runs and, like today's gc, reports no api_url. */
const DEFAULT_EXEC = () => Promise.resolve({ code: 0, stdout: '{"running":true}', stderr: "" });

/**
 * herdr's per-copy command queues: nextCommand() belongs to the copy whose
 * code is running when it is called (the harness sets `current` around a
 * copy's init, its spawned tasks' first turn and a delivered command's turn).
 */
export class CommandRouter {
  current: string | null = null;
  private readonly waiting = new Map<string, ((command: string) => void)[]>();

  /** herdr.nextCommand() for the copy in `current`. */
  next(): Promise<string> {
    const owner = this.current;
    if (owner === null) throw new Error("harness: nextCommand() outside a copy's turn");
    return new Promise((resolve) => {
      const list = this.waiting.get(owner) ?? [];
      list.push(resolve);
      this.waiting.set(owner, list);
    });
  }

  /** Whether copy `owner` waits for a command. */
  waits(owner: string): boolean {
    return this.parked(owner) > 0;
  }

  /** How many of copy `owner`'s tasks wait for a command. */
  parked(owner: string): number {
    return this.waiting.get(owner)?.length ?? 0;
  }

  /** Delivers `command` to copy `owner` and runs its turn; throws when it does not wait for one. */
  async deliver(owner: string, command: string): Promise<void> {
    const resolve = this.waiting.get(owner)?.shift();
    if (!resolve) throw new Error(`harness: copy ${owner} is not waiting for a command`);
    const prev = this.current;
    this.current = owner;
    try {
      resolve(command);
      for (let i = 0; i < 50; i++) await Promise.resolve();
    } finally {
      this.current = prev;
    }
  }

  /** Runs `body` as copy `owner`'s code. */
  as<T>(owner: string, body: () => T): T {
    const prev = this.current;
    this.current = owner;
    try {
      return body();
    } finally {
      this.current = prev;
    }
  }
}

/** A fake `herdr` module whose every call is recorded. */
export function fakeHerdr(options: FakeHostOptions = {}, router = new CommandRouter()) {
  const calls: { name: string; args: unknown[] }[] = [];
  const shared = new Map<string, unknown>(Object.entries(options.shared ?? {}));
  const toasts: { title: string; body?: string; level?: string; action?: { name: string; args?: Record<string, unknown> } }[] = [];
  const all: Record<string, (...args: unknown[]) => unknown> = {
    theme: () => ({ ...(options.theme ?? FAKE_THEME) }),
    // herdr returns the props a copy was opened with, and null for an unpinned copy.
    props: () => (options.props === undefined ? null : structuredClone(options.props)),
    shared: (key) => (shared.has(key as string) ? structuredClone(shared.get(key as string)) : null),
    setShared: (key, value) => {
      shared.set(key as string, structuredClone(value));
      return null;
    },
    notify: (n) => {
      toasts.push(structuredClone(n) as (typeof toasts)[number]);
      return `toast-${toasts.length}`;
    },
    nextCommand: () => router.next(),
    run: () => null,
    closeOverlay: () => null,
    home: () => FAKE_HOME,
    readTextFile: (path) => {
      if (options.readTextFileRejects !== undefined) return Promise.reject(new Error(options.readTextFileRejects));
      const files = options.files ?? {};
      return Promise.resolve(Object.hasOwn(files, path as string) ? files[path as string] : null);
    },
    exec: (command, args, opts) => (options.exec ?? DEFAULT_EXEC)(command as string, args as string[], opts),
    panes: () => structuredClone(options.panes ?? [{ pane: "p1", tab: "t1", mod: "gascity", title: "gascity", focused: true }]),
    focused: () => structuredClone(options.focus === undefined ? { space: "s1", tab: "t1", pane: "p1", terminal: null } : options.focus),
    spaces: () => structuredClone(options.spaces ?? [{ id: "s1", machine: null, active: true, tabs: [{ id: "t1", active: true }] }]),
    terminals: () => structuredClone(options.terminals ?? []),
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
  /** Host calls that throw (the test sets and clears them): export name → message. */
  const failing = new Map<string, string>();
  const module: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(all)) {
    if (options.omit?.includes(name)) continue;
    module[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      const fail = failing.get(name);
      if (fail !== undefined) throw new Error(fail);
      return fn(...args);
    };
  }
  return { module, calls, shared, toasts, router, failing };
}

export const BUNDLE_PATH = new URL("../gascity/main.js", import.meta.url);

/** A scripted answer of the fake fetch. */
export type FakeReply = { status: number; body: unknown } | { rejects: string } | "hang";

/** Options for the script globals: fetch replies by URL, the copy's localStorage, globals to drop. */
export interface FakeGlobalsOptions {
  /** Reply for each exact URL; any other URL is refused, as by a closed port. */
  replies?: Record<string, FakeReply>;
  /** Consulted when no exact URL matches; `init` is the request herdr's fetch got (method, headers, body). */
  route?: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => FakeReply | undefined;
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
      const reply = options.replies?.[url] ?? options.route?.(url, init as { method: string; headers: Record<string, string>; body?: string }) ?? { rejects: "error sending request: Connection refused (os error 111)" };
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
  const router = new CommandRouter();
  const herdr = fakeHerdr(options, router);
  const host = fakeGlobals(options);
  const inputs: FakeInputState[] = [];
  const Mod = evaluateModule(source, { ...fakeGpui(inputs), herdr: herdr.module }, host.globals);
  let copies = 0;
  /**
   * One copy of the mod: herdr shares module code by every copy; each has its
   * own instance, tasks and command queue. `props` are this copy's (default:
   * the module options'); herdr opens the overlay window with {overlay: <id>}.
   */
  const copy = (copyOptions: { props?: unknown } = {}) => {
    const name = `copy-${++copies}`;
    const view = new Mod();
    const cx = asyncContext((body) => router.as(name, body), () => router.parked(name));
    const render = (): RecordedNode => nodeOf(view.render(renderContext()));
    return {
      name,
      view,
      cx,
      init: () => {
        const saved = options.props;
        if ("props" in copyOptions) options.props = copyOptions.props;
        try {
          router.as(name, () => view.init?.(undefined, cx));
        } finally {
          options.props = saved;
        }
      },
      /** herdr delivers `command` to this copy's nextCommand() (as `herdr-app do gascity.<command>` does to a shown copy). */
      command: async (command: string) => {
        await cx.settle();
        await router.deliver(name, command);
        await cx.settle();
      },
      /** Whether this copy waits for a command (its nextCommand loop runs). */
      waitsForCommand: () => router.waits(name),
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
        router.as(name, () => node.handlers.on_click!({}, cx));
      },
      /** herdr laid the copy's root out at this size (logical px): its on_size_change handler runs in this copy's turn. */
      resize: (width: number, height = 700) => {
        const root = render();
        if (!root.handlers.on_size_change) throw new Error("harness: the root does not observe its size");
        router.as(name, () => root.handlers.on_size_change!({ width, height }, cx));
      },
      /** A key pressed while the copy's root holds the keyboard. */
      key: (keystroke: string) => {
        const root = render();
        if (!root.handlers.on_key_down) throw new Error("harness: the root takes no keys");
        router.as(name, () => root.handlers.on_key_down!({ key: keystroke, keystroke }, cx));
      },
    };
  };
  return {
    ...copy(),
    /** Another copy sharing this module (and so its registry). */
    copy,
    herdrCalls: herdr.calls,
    /** herdr's shared state (shared/setShared). */
    shared: herdr.shared,
    /** Toasts posted with notify(), in order. */
    toasts: herdr.toasts,
    /** herdr calls that throw while listed: export name → message. */
    hostFails: herdr.failing,
    fetched: host.fetched,
    storage: host.storage,
    /** Every InputState the copies created, in creation order. */
    inputs,
    clock: host.clock,
  };
}
