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
      out.push(`const ${m[1]} = __host(${JSON.stringify(m[2])});`);
    } else if ((m = statement.match(NAMED_IMPORT))) {
      const names = m[1]!.split(",").map((s) => s.trim()).filter(Boolean)
        .map((s) => s.replace(/^(\w+) as (\w+)$/, "$1: $2"));
      out.push(`const {${names.join(", ")}} = __host(${JSON.stringify(m[2])});`);
    } else if ((m = statement.match(DEFAULT_IMPORT))) {
      out.push(`const ${m[1]} = __host(${JSON.stringify(m[2])}).default;`);
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
  return `${body}\nreturn ${name};`;
}

/** Evaluates a module's source against the given host modules; returns its default export. */
export function evaluateModule(source: string, modules: HostModules): any {
  const host = (specifier: string) => {
    const mod = modules[specifier];
    if (!mod) throw new Error(`harness: no fake for host module "${specifier}"`);
    return mod;
  };
  return new Function("__host", moduleBody(source))(host);
}

/** A fake per-callback context that counts notifies. */
export function fakeContext() {
  const cx = { notifies: 0, notify() { cx.notifies++; } };
  return cx;
}

/** The fake gpui-kit and gpui-base modules: a View base class and recording builders. */
export function fakeGpui(): HostModules {
  return {
    "gpui-kit": { View: class {}, div: element },
    "gpui-base": { v_flex: element, h_flex: element },
  };
}

/** A herdr theme with the colour names herdr documents (values are tags, not real colours). */
export const FAKE_THEME: Readonly<Record<string, string>> = Object.freeze({
  background: "#background", foreground: "#foreground", muted: "#muted", dim: "#dim",
  accent: "#accent", border: "#border", surface: "#surface", blocked: "#blocked",
});

/** A fake `herdr` module whose every call is recorded. Pass `omit` to drop exports. */
export function fakeHerdr(options: { props?: Record<string, unknown>; omit?: string[] } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const all: Record<string, (...args: unknown[]) => unknown> = {
    theme: () => ({ ...FAKE_THEME }),
    props: () => ({ ...(options.props ?? {}) }),
  };
  const module: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(all)) {
    if (options.omit?.includes(name)) continue;
    module[name] = (...args: unknown[]) => { calls.push({ name, args }); return fn(...args); };
  }
  return { module, calls };
}

export const BUNDLE_PATH = new URL("../gascity/main.js", import.meta.url);

/** Loads the committed bundle with fake host modules and constructs one copy of the mod. */
export async function loadMod(options: { props?: Record<string, unknown>; omit?: string[] } = {}) {
  const source = await readFile(BUNDLE_PATH, "utf8");
  const herdr = fakeHerdr(options);
  const Mod = evaluateModule(source, { ...fakeGpui(), herdr: herdr.module });
  const view = new Mod();
  const cx = fakeContext();
  return {
    view,
    cx,
    herdrCalls: herdr.calls,
    init: () => view.init?.(options.props ?? {}, cx),
    render: (): RecordedNode => nodeOf(view.render(cx)),
  };
}
