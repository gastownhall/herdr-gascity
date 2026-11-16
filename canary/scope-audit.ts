// The HC_SCOPE process audit.
//
// herdr-core gives every program a herdr terminal runs a sweep token in
// HC_SCOPE and, when that terminal's holder dies, kills every process whose
// environment carries the token, plus their descendants. An attach tab must
// stay a viewer: closing it, or a holder loss, may only end the attach's own
// process tree, never the city's tmux server, an agent pane, the supervisor
// or a store process. So, with a known token in the terminal's environment,
// no process outside that terminal's own process tree may carry it.
//
// A process carries the token when any variable of its starting environment
// holds it (a copy under another name counts too).

import { commandLine, readProcessTable, treeOf, type ProcessEntry } from "./proc.ts";

/** One process that carries the token. */
export interface Carrier {
  pid: number;
  ppid: number;
  command: string;
  /** The variables that hold the token. */
  variables: string[];
}

/** What the audit found. */
export interface ScopeAudit {
  token: string;
  root: number;
  /** The terminal's process tree (the root included). */
  tree: number[];
  /** Carriers inside the tree: expected (the terminal's shell, at least). */
  inside: Carrier[];
  /** Carriers outside the tree: each one is a leak. */
  leaks: Carrier[];
  /** Processes whose environment could not be read (another user's). */
  unreadable: number;
}

function carrierOf(p: ProcessEntry, token: string): Carrier | null {
  if (p.environ === null) return null;
  const variables = [...p.environ].filter(([, v]) => v.includes(token)).map(([k]) => k);
  return variables.length === 0 ? null : { pid: p.pid, ppid: p.ppid, command: commandLine(p), variables };
}

/** Audits `table` for `token`, with `root` the terminal's first process (the shell herdr's wrapper runs). */
export function auditScope(table: readonly ProcessEntry[], root: number, token: string): ScopeAudit {
  if (token.length < 8) throw new Error(`scope token ${JSON.stringify(token)} is too short to be unique`);
  const tree = treeOf(table, root);
  const inside: Carrier[] = [];
  const leaks: Carrier[] = [];
  let unreadable = 0;
  for (const p of table) {
    if (p.environ === null) {
      unreadable++;
      continue;
    }
    const c = carrierOf(p, token);
    if (c === null) continue;
    (tree.has(p.pid) ? inside : leaks).push(c);
  }
  return { token, root, tree: [...tree].sort((a, b) => a - b), inside, leaks, unreadable };
}

/** The audit as report lines. */
export function auditReport(a: ScopeAudit): string[] {
  const lines = [`HC_SCOPE=${a.token}: terminal tree ${a.tree.join(",")} (${a.inside.length} carrier(s) inside), ${a.leaks.length} leak(s), ${a.unreadable} unreadable process(es)`];
  for (const l of a.leaks) lines.push(`  LEAK pid ${l.pid} (parent ${l.ppid}) via ${l.variables.join(",")}: ${l.command}`);
  return lines;
}

const endsWith = (argv: readonly string[], tail: readonly string[]) =>
  argv.length >= tail.length && tail.every((t, i) => argv[argv.length - tail.length + i] === t);

/**
 * The root of the herdr terminal running an attach, and its HC_SCOPE token.
 * `tail` is the attach's argv after gc's program (`--city <path> session
 * attach <id>`); `--no-start` may follow it. herdr's terminal list has no
 * pids, so the attach is found by its argv and the root is its topmost
 * ancestor that carries HC_SCOPE (herdr's wrapper shell).
 */
export function attachRoot(table: readonly ProcessEntry[], tail: readonly string[]): { root: number; token: string } {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const matches = table.filter((p) => endsWith(p.argv, tail) || endsWith(p.argv, [...tail, "--no-start"]));
  if (matches.length === 0) throw new Error(`no process runs ${tail.join(" ")}`);
  const roots = new Map<number, string>();
  for (const m of matches) {
    let top: ProcessEntry | null = null;
    for (let p: ProcessEntry | undefined = m, hops = 0; p !== undefined && hops < 64; p = byPid.get(p.ppid), hops++) {
      if (p.environ?.get("HC_SCOPE")) top = p;
    }
    if (top !== null) roots.set(top.pid, top.environ!.get("HC_SCOPE")!);
  }
  if (roots.size === 0) throw new Error(`no ancestor carries HC_SCOPE for ${tail.join(" ")}: not a herdr terminal`);
  if (roots.size > 1) throw new Error(`${roots.size} terminals run ${tail.join(" ")}: ${[...roots.keys()].join(", ")}`);
  const [root, token] = [...roots][0]!;
  return { root, token };
}

/** CLI: `bun canary/scope-audit.ts --city <path> session attach <id>` audits the live process table; exit 1 on a leak. */
async function main(): Promise<number> {
  const table = readProcessTable();
  const { root, token } = attachRoot(table, process.argv.slice(2));
  const audit = auditScope(table, root, token);
  for (const line of auditReport(audit)) console.log(line);
  if (audit.inside.length === 0) {
    console.log("no carrier inside the terminal's tree: the root was not read right");
    return 1;
  }
  return audit.leaks.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code), (e: unknown) => {
    console.error(`scope-audit: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
}
