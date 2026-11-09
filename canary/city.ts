// A scratch gc city for the integration test and the nightly canary, fully
// isolated from the machine it runs on:
//
//   - its own HOME, GC_HOME and XDG directories under one root directory, and
//     TMUX_TMPDIR there too, so its tmux socket (the city's own `tmux -L`
//     name) can never be the default tmux server or anyone else's;
//   - a free loopback port for the supervisor API;
//   - no inherited TMUX, HC_* or GC_* variables (a gc variable from the
//     caller's shell could point at a live city);
//   - every process it starts carries RUN_MARKER=<run id> in its environment,
//     so teardown signals exactly those processes and nothing else.
//
// The supervisor runs in the foreground (`gc supervisor run`) as this
// process's child, never under a herdr terminal; `gc init --file` registers
// the city with it from canary/city.toml.in and the canary pack.

import { createWriteStream, mkdirSync, readFileSync, writeFileSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { carrying, commandLine, readProcessTable } from "./proc.ts";

/** The environment variable that marks every process a scratch city started. */
export const RUN_MARKER = "HERDR_GASCITY_RUN";

/** The canary pack and the city template, next to this file. */
export const PACK_DIR = join(import.meta.dir, "pack");
export const CITY_TEMPLATE = join(import.meta.dir, "city.toml.in");

/** How the supervisor serves the API. */
export type SupervisorMode =
  /** loopback, mutations allowed */
  | { kind: "loopback" }
  /** loopback, every mutation needs a signed write grant (a hardened city) */
  | { kind: "write-grants"; verifyKey: string }
  /** bound to every interface: gc serves the API read-only */
  | { kind: "any-interface" };

export interface ScratchCityOptions {
  /** The gc program (an absolute path). */
  gcBin: string;
  /** An empty directory that holds everything (home, city, logs). */
  root: string;
  /** The city's name; also part of the tmux socket name. */
  name: string;
  /** A unique id for this run (letters, digits, "-"). */
  runId: string;
  /** Extra PATH entries for gc and the agent (curl, tmux); the caller's PATH follows. */
  path?: string[];
  /** Progress lines. */
  log?: (line: string) => void;
}

const VARIABLE_DROPPED = /^(TMUX|TMUX_PANE|HC_.*|GC_.*|XDG_.*|HERDR_.*)$/;

/** The isolated environment every process of the scratch city gets. */
export function scratchEnv(o: { root: string; runId: string; gcBin: string; path?: string[] }, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !VARIABLE_DROPPED.test(k)) env[k] = v;
  const home = join(o.root, "home");
  Object.assign(env, {
    HOME: home,
    GC_HOME: join(home, ".gc"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(o.root, "run"),
    TMUX_TMPDIR: join(o.root, "tmux"),
    TERM: "xterm-256color",
    PATH: [dirname(o.gcBin), ...(o.path ?? []), base.PATH ?? "/usr/bin:/bin"].join(":"),
    [RUN_MARKER]: o.runId,
  });
  return env;
}

/** A free TCP port on 127.0.0.1 (the OS picks it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

/** Fills the city template's placeholders; every placeholder must be given. */
export function cityToml(template: string, values: Record<"SOCKET" | "PACK_DIR" | "API_URL" | "CITY", string>): string {
  const out = template.replace(/@([A-Z_]+)@/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`city template: no value for @${key}@`);
    return values[key as keyof typeof values];
  });
  return out;
}

/** supervisor.toml for a mode. */
export function supervisorToml(port: number, mode: SupervisorMode): string {
  const lines = ["[supervisor]", `port = ${port}`];
  switch (mode.kind) {
    case "loopback":
      lines.push('bind = "127.0.0.1"');
      break;
    case "write-grants":
      lines.push('bind = "127.0.0.1"', "write_auth_required = true", `write_auth_verify_key = ${JSON.stringify(mode.verifyKey)}`);
      break;
    case "any-interface":
      lines.push('bind = "0.0.0.0"');
      break;
  }
  return `${lines.join("\n")}\n`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Result of a short gc command. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A scratch city and its supervisor. */
export class ScratchCity {
  readonly env: Record<string, string>;
  readonly cityDir: string;
  readonly logDir: string;
  readonly socket: string;
  readonly apiUrl: string;
  private supervisor: ReturnType<typeof Bun.spawn> | null = null;
  private supervisorLog: WriteStream | null = null;

  private constructor(readonly o: ScratchCityOptions, readonly port: number) {
    this.env = scratchEnv(o);
    this.cityDir = join(o.root, "city");
    this.logDir = join(o.root, "logs");
    this.socket = `${o.name}-${o.runId}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60);
    this.apiUrl = `http://127.0.0.1:${port}`;
  }

  /** Makes the directories and picks a port; starts nothing. */
  static async prepare(o: ScratchCityOptions): Promise<ScratchCity> {
    if (!/^[A-Za-z0-9-]+$/.test(o.runId)) throw new Error(`run id ${JSON.stringify(o.runId)}: letters, digits and "-" only`);
    if (!/^[a-z][a-z0-9-]*$/.test(o.name)) throw new Error(`city name ${JSON.stringify(o.name)}: lowercase letters, digits and "-" only`);
    const city = new ScratchCity(o, await freePort());
    for (const d of [city.env.GC_HOME!, city.env.XDG_CONFIG_HOME!, city.env.XDG_STATE_HOME!, city.env.XDG_DATA_HOME!, city.env.XDG_CACHE_HOME!, city.logDir]) {
      mkdirSync(d, { recursive: true });
    }
    for (const d of [city.env.XDG_RUNTIME_DIR!, city.env.TMUX_TMPDIR!]) mkdirSync(d, { recursive: true, mode: 0o700 });
    return city;
  }

  get name(): string {
    return this.o.name;
  }

  private log(line: string): void {
    this.o.log?.(`[city ${this.o.name}] ${line}`);
  }

  /** Runs `gc <args>` (or another program) in the scratch environment and waits for it. */
  async run(argv: string[], timeoutMs = 60_000): Promise<RunResult> {
    const proc = Bun.spawn(argv, { env: this.env, cwd: this.o.root, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return { code, stdout, stderr };
  }

  /** Writes supervisor.toml for `mode`. */
  configure(mode: SupervisorMode): void {
    writeFileSync(join(this.env.GC_HOME!, "supervisor.toml"), supervisorToml(this.port, mode));
  }

  /** Starts `gc supervisor run` as this process's child and waits for /health. */
  async startSupervisor(mode: SupervisorMode = { kind: "loopback" }): Promise<void> {
    if (this.supervisor) throw new Error("the supervisor already runs");
    this.configure(mode);
    this.supervisorLog ??= createWriteStream(join(this.logDir, "supervisor.log"), { flags: "a" });
    this.supervisorLog.write(`\n==== supervisor start (${mode.kind}) ${new Date().toISOString()}\n`);
    const proc = Bun.spawn([this.o.gcBin, "supervisor", "run"], { env: this.env, cwd: this.o.root, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.supervisor = proc;
    for (const stream of [proc.stdout, proc.stderr]) void this.pipe(stream);
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (proc.exitCode !== null) throw new Error(`gc supervisor run exited with ${proc.exitCode}; see ${this.logDir}/supervisor.log`);
      try {
        const r = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error(`the supervisor did not answer /health within 60 s; see ${this.logDir}/supervisor.log`);
      await sleep(250);
    }
    this.log(`supervisor up (${mode.kind}) at ${this.apiUrl}`);
  }

  private async pipe(stream: ReadableStream<Uint8Array> | number | undefined): Promise<void> {
    if (stream === undefined || typeof stream === "number") return;
    for await (const chunk of stream) this.supervisorLog?.write(chunk);
  }

  /**
   * Stops the supervisor this object started: "stop" is gc's graceful
   * shutdown (SIGTERM, then SIGKILL after 20 s), "crash" kills it at once.
   * The city's tmux sessions keep running either way.
   */
  async stopSupervisor(how: "stop" | "crash" = "stop"): Promise<void> {
    const proc = this.supervisor;
    if (!proc) return;
    this.supervisor = null;
    if (how === "crash") {
      proc.kill("SIGKILL");
      await proc.exited;
      this.log("supervisor killed");
      return;
    }
    proc.kill("SIGTERM");
    const killed = await Promise.race([proc.exited.then(() => false), sleep(20_000).then(() => true)]);
    if (killed) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
    this.log(`supervisor stopped${killed ? " (killed after 20 s)" : ""}`);
  }

  /** `gc init --file` from the template, registered with the running supervisor; waits until gc lists the city running. */
  async init(): Promise<void> {
    const toml = cityToml(readFileSync(CITY_TEMPLATE, "utf8"), { SOCKET: this.socket, PACK_DIR: PACK_DIR, API_URL: this.apiUrl, CITY: this.o.name });
    const file = join(this.o.root, "city.toml");
    writeFileSync(file, toml);
    const r = await this.run([this.o.gcBin, "init", "--name", this.o.name, "--file", file, this.cityDir], 180_000);
    writeFileSync(join(this.logDir, "gc-init.log"), `exit ${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n`);
    if (r.code !== 0) throw new Error(`gc init exited ${r.code}: ${r.stderr.trim().slice(-2000)}`);
    await this.waitRunning();
    this.log(`city running at ${this.cityDir} (tmux -L ${this.socket})`);
  }

  /** Waits until /v0/cities lists the city running. */
  async waitRunning(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const r = await fetch(`${this.apiUrl}/v0/cities`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const body = (await r.json()) as { items?: { name: string; running?: boolean }[] };
          if (body.items?.some((c) => c.name === this.o.name && c.running === true)) return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error(`city ${this.o.name} not running within ${timeoutMs / 1000} s`);
      await sleep(500);
    }
  }

  /** A gc API call (the harness's own reads and set-up writes, never the mod's). */
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET") headers["X-GC-Request"] = "herdr-gascity-integration";
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20_000) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(`${this.apiUrl}${path}`, init);
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON: keep the text
    }
    return { status: r.status, body: parsed };
  }

  /** `/v0/city/<name>` + path. */
  cityPath(path: string): string {
    return `/v0/city/${encodeURIComponent(this.o.name)}${path}`;
  }

  /**
   * Stops everything this city started: the supervisor, then the city's own
   * tmux server (by its socket, under this city's TMUX_TMPDIR), then any
   * process still carrying this run's marker. Returns what it had to signal.
   */
  async teardown(): Promise<string[]> {
    const signalled: string[] = [];
    await this.stopSupervisor().catch((e: unknown) => signalled.push(`supervisor stop failed: ${String(e)}`));
    const tmux = await this.run(["tmux", "-L", this.socket, "kill-server"], 10_000).catch(() => null);
    if (tmux && tmux.code === 0) signalled.push(`tmux -L ${this.socket} kill-server`);
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      const left = carrying(readProcessTable(), RUN_MARKER, this.o.runId).filter((p) => p.pid !== process.pid);
      if (left.length === 0) break;
      for (const p of left) {
        try {
          process.kill(p.pid, signal);
          signalled.push(`${signal} ${p.pid} ${commandLine(p, 100)}`);
        } catch {
          // already gone
        }
      }
      await sleep(1000);
    }
    this.supervisorLog?.end();
    this.supervisorLog = null;
    return signalled;
  }
}
