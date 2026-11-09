// The probe writer: writes the probe document (vm/probe.ts) to
// `<app home>/data/gascity-probe/probe.json` for the canary, only while the
// probe is on (shared "gascity.probe" is true). One writer per app in module
// scope: the canary opens one copy, and with several the last copy to offer
// a changed document wins (`seq` keeps increasing).
//
// herdr's writeTextFile is a compare-and-swap: it takes the text it expects
// to replace (null to create). The writer remembers what it last wrote; the
// first write, and any after a failure, reads the file first.
//
// Like every host operation, a write belongs to the copy whose tick started
// it and never settles if that copy closes. So at most one write is in
// flight, a write with no answer by PROBE_WRITE_DEADLINE_MS is given up (and
// the file re-read before the next), and a new write is started only from a
// copy's own tick (`offer`).

import type { GcError } from "./gc/errors.ts";
import type { Result } from "./result.ts";
import type { ProbeBody } from "./vm/probe.ts";

/** An unchanged document is still rewritten this often, so `ts` shows the mod is alive. */
export const PROBE_HEARTBEAT_MS = 5_000;
/** A write with no answer by then is given up. */
export const PROBE_WRITE_DEADLINE_MS = 5_000;
/** Probe write failures kept for the diagnostics. */
const ERROR_LIMIT = 20;

/** The host calls the writer needs (host.ts). */
export interface ProbeIo {
  path(): string;
  read(path: string): Promise<Result<string | null, GcError>>;
  write(path: string, text: string, expected: string | null): Promise<Result<null, GcError>>;
}

/** A failed probe write, for the diagnostics. */
export interface ProbeError {
  at: number;
  source: "probe";
  error: GcError;
}

/** The app's probe writer. */
export class ProbeWriter {
  /** What the file holds, as far as the writer knows; undefined: read it before writing. */
  private expected: string | null | undefined = undefined;
  private inFlight: { token: number; startedAt: number } | null = null;
  private tokens = 0;
  private lastBody: string | null = null;
  private lastWriteAt = -Infinity;
  private seq = 0;
  private failures: ProbeError[] = [];

  constructor(private readonly io: ProbeIo) {}

  /** Recent write failures, oldest first. */
  errors(): readonly ProbeError[] {
    return this.failures;
  }

  /** Called from a copy's own tick: writes `body` if the probe is on and the document changed or a heartbeat is due. */
  offer(body: ProbeBody, now: number, enabled: boolean): void {
    if (!enabled) return;
    if (this.inFlight) {
      if (now - this.inFlight.startedAt < PROBE_WRITE_DEADLINE_MS) return;
      this.fail(now, { kind: "host-call", api: `writeTextFile(${this.io.path()})`, cause: `no answer within ${PROBE_WRITE_DEADLINE_MS} ms` });
      this.inFlight = null;
    }
    const json = JSON.stringify(body);
    if (json === this.lastBody && now - this.lastWriteAt < PROBE_HEARTBEAT_MS) return;
    const token = ++this.tokens;
    this.inFlight = { token, startedAt: now };
    const text = `${JSON.stringify({ ...body, seq: ++this.seq, ts: new Date(now).toISOString() }, null, 2)}\n`;
    const path = this.io.path();
    const known = this.expected;
    const expected: Promise<Result<string | null, GcError>> = known === undefined ? this.io.read(path) : Promise.resolve({ ok: true, value: known });
    void expected
      .then((r) => (r.ok ? this.io.write(path, text, r.value) : r))
      .then((r) => {
        if (this.inFlight?.token !== token) return;
        this.inFlight = null;
        if (r.ok) {
          this.expected = text;
          this.lastBody = json;
          this.lastWriteAt = now;
        } else {
          this.fail(now, r.error);
        }
      });
  }

  private fail(at: number, error: GcError): void {
    this.expected = undefined;
    this.failures = [...this.failures, { at, source: "probe" as const, error }].slice(-ERROR_LIMIT);
  }
}

let shared: ProbeWriter | null = null;

/** The app's probe writer, created on first use (module scope, shared by every copy). */
export function sharedProbeWriter(create: () => ProbeWriter): ProbeWriter {
  shared ??= create();
  return shared;
}
