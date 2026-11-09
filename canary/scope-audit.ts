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

import { commandLine, treeOf, type ProcessEntry } from "./proc.ts";

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
