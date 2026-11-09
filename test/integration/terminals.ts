// herdr's terminals, played in PTYs: what `tab.new {argv}` does with an argv,
// and what `terminals()` then reports.
//
// herdr-app runs a tab's argv through the person's shell (src/window.rs
// unix_agent_argv): `$SHELL -ic '"$@"; exec "$0" -i' $SHELL <argv>` (`-lic` on
// macOS), so when the program exits the terminal stays alive as an
// interactive shell. herdr-core gives each terminal program a fresh sweep
// token in HC_SCOPE (plus HC_TERMINAL_ID and HC_TERMINAL_SOCKET); the holder
// that runs the PTY does not carry it.
//
// A terminal record has herdr's shape (`hc ls --json` plus `program`): the
// program is named from core's `foreground` (the PTY's foreground process
// group leader, read from /proc like herdr-core does), else the launch argv,
// unwrapping herdr's own shell wrapper (herdr-app src/programs.rs).

import { createWriteStream, readFileSync, readlinkSync, type WriteStream } from "node:fs";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { readProcessTable, treeOf } from "../../canary/proc.ts";

/** The shells herdr-app's program table knows (programs.rs `shells`, the ones that matter on Linux and macOS). */
export const SHELLS: readonly string[] = ["bash", "zsh", "sh", "fish", "dash", "ksh", "nu", "tcsh", "csh"];

/** herdr-app's wrapper: `$SHELL -ic '"$@"; exec "$0" -i' $SHELL <argv>` (login: `-lic` … `-li`). */
export function wrapperArgv(shell: string, argv: readonly string[], login = false): string[] {
  const fish = basename(shell) === "fish";
  const script = fish
    ? (login ? "command $argv[2..]; exec $argv[1] -li" : "command $argv[2..]; exec $argv[1] -i")
    : (login ? '"$@"; exec "$0" -li' : '"$@"; exec "$0" -i');
  return [shell, login ? "-lic" : "-ic", script, shell, ...argv];
}

/** herdr-app's program naming for an argv: shell or not, and the program's name. */
export function programOf(argv: readonly string[]): { key: string; name: string | null; shell: boolean } {
  const first = argv[0];
  if (first === undefined) return { key: "shell", name: null, shell: true };
  const base = basename(first).replace(/^-/, "");
  if (argv.length >= 4 && SHELLS.includes(base) && argv[1]?.startsWith("-") && argv[1].endsWith("c")
    && (argv[2]?.includes('"$@"') || argv[2] === "command $argv[2..]; exec $argv[1] -i")) {
    return programOf(argv.slice(4));
  }
  if (SHELLS.includes(base)) return { key: "shell", name: base, shell: true };
  return { key: "program", name: base, shell: false };
}

/** The PTY's foreground process group (field tpgid of /proc/<pid>/stat), or null. */
function foregroundGroup(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const tpgid = Number(fields[5]);
    return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
  } catch {
    return null;
  }
}

function argvOf(pid: number): string[] | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0").filter((a) => a !== "");
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One terminal a tab runs. */
export interface Terminal {
  address: string;
  tab: string;
  space: string;
  /** What herdr ran: the wrapper around the tab's argv. */
  argv: string[];
  /** The tab's own argv (what the mod asked for). */
  inner: string[];
  /** The terminal's sweep token. */
  scope: string;
  /** The wrapper shell: the terminal's first process. */
  pid: number;
  createdMs: number;
  output: () => string;
  proc: ReturnType<typeof Bun.spawn>;
}

/** The PTY terminals of one fake herdr. */
export class PtyTerminals {
  private readonly list: Terminal[] = [];
  private seq = 0;

  constructor(
    private readonly o: {
      /** The environment herdr's core would give a terminal (before its HC_* variables). */
      env: Record<string, string>;
      /** The person's shell. */
      shell: string;
      cwd: string;
      /** Where each terminal's output is kept. */
      logDir: string;
      runId: string;
    },
  ) {}

  /** Starts `argv` in a new terminal of `tab`, under herdr's wrapper, with a fresh HC_SCOPE token. */
  launch(argv: readonly string[], where: { tab: string; space: string }, scope = this.newScope()): Terminal {
    const address = `t${++this.seq}`;
    const wrapped = wrapperArgv(this.o.shell, argv);
    let text = "";
    const log: WriteStream = createWriteStream(join(this.o.logDir, `terminal-${address}.log`));
    const decoder = new TextDecoder();
    const env = { ...this.o.env, HC_SCOPE: scope, HC_TERMINAL_ID: address, HC_TERMINAL_SOCKET: join(this.o.cwd, "hc-core.sock"), SHELL: this.o.shell };
    const proc = Bun.spawn(wrapped, {
      env,
      cwd: this.o.cwd,
      terminal: {
        cols: 160,
        rows: 48,
        data: (_t: unknown, data: Uint8Array) => {
          const s = decoder.decode(data, { stream: true });
          text = (text + s).slice(-200_000);
          log.write(data);
        },
      },
    } as Parameters<typeof Bun.spawn>[1]);
    const t: Terminal = { address, tab: where.tab, space: where.space, argv: wrapped, inner: [...argv], scope, pid: proc.pid, createdMs: Date.now(), output: () => text, proc };
    void proc.exited.then(() => log.end());
    this.list.push(t);
    return t;
  }

  /** A sweep token like herdr-core's: unique per terminal and run. */
  newScope(): string {
    return `m7-${this.o.runId}-${randomBytes(8).toString("hex")}`;
  }

  /** Every terminal launched, oldest first. */
  all(): readonly Terminal[] {
    return this.list;
  }

  /** The terminal at `address`. */
  get(address: string): Terminal | undefined {
    return this.list.find((t) => t.address === address);
  }

  /** herdr's `terminals()` record for each terminal still listed (the live ones). */
  records(): Record<string, unknown>[] {
    return this.list.filter((t) => alive(t.pid)).map((t) => this.record(t));
  }

  /** One record, as herdr-app reports it. */
  record(t: Terminal): Record<string, unknown> {
    const group = foregroundGroup(t.pid);
    const fgArgv = group === null ? null : argvOf(group);
    let fgCwd: string | null = null;
    try {
      if (group !== null) fgCwd = readlinkSync(`/proc/${group}/cwd`);
    } catch {
      fgCwd = null;
    }
    const foreground = group !== null && fgArgv !== null && fgArgv.length > 0 ? { pid: group, name: basename(fgArgv[0]!), argv: fgArgv, cwd: fgCwd ?? this.o.cwd } : null;
    const program = programOf(foreground?.argv ?? t.argv);
    return {
      address: t.address,
      argv: t.argv,
      labels: { "herdr.space": t.space, "herdr.tab": t.tab },
      cwd: this.o.cwd,
      state: alive(t.pid) ? "live" : "exited",
      created_ms: t.createdMs,
      status: null,
      report: null,
      foreground,
      program: { key: program.key, name: program.name, icon: null, tint: false, tile: null, color: null, shell: program.shell, agent: false },
    };
  }

  /** The terminal's process tree now (its shell and every descendant). */
  tree(t: Terminal): Set<number> {
    return treeOf(readProcessTable(), t.pid);
  }

  /**
   * Ends the terminal the way a holder loss does: HUP, TERM, then KILL to the
   * terminal's whole process tree (and only that tree).
   */
  async kill(t: Terminal): Promise<number[]> {
    const killed = new Set<number>();
    for (const signal of ["SIGHUP", "SIGTERM", "SIGKILL"] as const) {
      const tree = [...this.tree(t)].filter(alive);
      if (tree.length === 0) break;
      for (const pid of tree) {
        try {
          process.kill(pid, signal);
          killed.add(pid);
        } catch {
          // gone already
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    (t.proc as unknown as { terminal?: { close(): void } }).terminal?.close();
    return [...killed];
  }

  /** Kills every terminal still running (teardown). */
  async killAll(): Promise<void> {
    for (const t of this.list) await this.kill(t);
  }
}
