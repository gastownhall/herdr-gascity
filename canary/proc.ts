// The process table as Linux shows it under /proc: parent links, argv and
// the starting environment of every process this user may read. Used by the
// HC_SCOPE audit (scope-audit.ts) and by teardown, which signals only the
// processes that carry this run's marker.
//
// /proc/<pid>/environ is the environment a process was started with; a
// process another user owns is unreadable and is counted, not guessed.

import { readdirSync, readFileSync } from "node:fs";

/** One process: its parent, argv and starting environment (null when unreadable). */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  argv: string[];
  environ: ReadonlyMap<string, string> | null;
}

/** Parses /proc/<pid>/stat's parent pid (the field after the parenthesised command, which may hold spaces or parentheses). */
export function parentOf(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

/** Splits a NUL-separated /proc file (environ, cmdline). */
export function nulFields(raw: string): string[] {
  return raw.split("\0").filter((f) => f !== "");
}

/** An environ file as a map; an entry without "=" is kept with an empty value. */
export function parseEnviron(raw: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const entry of nulFields(raw)) {
    const at = entry.indexOf("=");
    if (at < 0) env.set(entry, "");
    else env.set(entry.slice(0, at), entry.slice(at + 1));
  }
  return env;
}

function readOr(path: string): string | null {
  try {
    return readFileSync(path, "latin1");
  } catch {
    return null;
  }
}

/** Every process /proc lists now. A process that exits while it is read is left out. */
export function readProcessTable(procRoot = "/proc"): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    const stat = readOr(`${procRoot}/${name}/stat`);
    if (stat === null) continue;
    const ppid = parentOf(stat);
    if (ppid === null) continue;
    const cmdline = readOr(`${procRoot}/${name}/cmdline`);
    const environ = readOr(`${procRoot}/${name}/environ`);
    out.push({ pid: Number(name), ppid, argv: cmdline === null ? [] : nulFields(cmdline), environ: environ === null ? null : parseEnviron(environ) });
  }
  return out;
}

/** `root` and every process descended from it. */
export function treeOf(table: readonly ProcessEntry[], root: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const p of table) {
    const list = children.get(p.ppid) ?? [];
    list.push(p.pid);
    children.set(p.ppid, list);
  }
  const tree = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.pop()!;
    for (const c of children.get(next) ?? []) {
      if (!tree.has(c)) {
        tree.add(c);
        queue.push(c);
      }
    }
  }
  return tree;
}

/** The processes whose starting environment has `name` set to exactly `value`. */
export function carrying(table: readonly ProcessEntry[], name: string, value: string): ProcessEntry[] {
  return table.filter((p) => p.environ?.get(name) === value);
}

/** A process's argv as one short line, for reports. */
export function commandLine(p: ProcessEntry, limit = 160): string {
  const line = p.argv.join(" ");
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}
