// The probe writer: writes the probe document (vm/probe.ts) to
// `<app home>/data/gascity-probe/probe.json` for the canary, only while the
// probe is on (shared "gascity.probe" is true). One writer per app in module
// scope.
//
// One copy owns the file: the first copy to offer a document while the probe
// is on, until it closes (`release`) or the probe goes off; then the next copy
// to offer takes over. Every copy's document differs (its open detail, its
// refresh count), so with several copies taking turns the file would be
// rewritten on every tick.
//
// herdr's writeTextFile is a compare-and-swap: it takes the text it expects
// to replace (null to create). The writer remembers what it last wrote; the
// first write, and any after a failure, reads the file first.
//
// herdr refuses a text over 1 MiB (PROBE_MAX_BYTES, UTF-8). A document over
// it is cut down by one fixed rule until it fits, and the cut is listed in
// the document's `truncated` and recorded once in the diagnostics:
//   1. the free text goes: the open session's output and pending prompt, and
//      the open bead's description (null);
//   2. then every list is halved, again and again, keeping its most relevant
//      half (sessions and board cards in the order shown, the newest actions,
//      errors and closes, the newest exec log entries);
//   3. if even that does not fit, only the schema, versions and `truncated`
//      are written.
//
// When the probe goes off, the file is emptied (it holds agent output and
// pending prompts): herdr offers a mod no way to delete a file, so the writer
// replaces it with empty text, compare-and-swap like any write. A file that
// is already absent or empty is left alone.
//
// Like every host operation, a write belongs to the copy whose tick started
// it and never settles if that copy closes. So at most one write is in
// flight, a write with no answer by PROBE_WRITE_DEADLINE_MS is given up (and
// the file re-read before the next), and a new write is started only from a
// copy's own tick (`offer`, `off`).

import type { GcError } from "./gc/errors.ts";
import { ok, type Result } from "./result.ts";
import type { SyncError } from "./sync/store.ts";
import type { ProbeBody } from "./vm/probe.ts";

/** An unchanged document is still rewritten this often, so `ts` shows the mod is alive. */
export const PROBE_HEARTBEAT_MS = 5_000;
/** A write with no answer by then is given up. */
export const PROBE_WRITE_DEADLINE_MS = 5_000;
/** herdr's writeTextFile limit, in UTF-8 bytes. */
export const PROBE_MAX_BYTES = 1024 * 1024;
/** Probe write failures kept for the diagnostics. */
const ERROR_LIMIT = 20;

/** The host calls the writer needs (host.ts). */
export interface ProbeIo {
  path(): string;
  read(path: string): Promise<Result<string | null, GcError>>;
  write(path: string, text: string, expected: string | null): Promise<Result<null, GcError>>;
}

/** A failed or cut-down probe write, for the diagnostics. */
export interface ProbeError {
  at: number;
  source: "probe";
  error: SyncError;
}

/** The size of `text` in UTF-8 bytes. */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The written document: the body, or what is left of it, plus the writer's fields. */
type Written = Partial<ProbeBody> & { schema: ProbeBody["schema"]; truncated?: string[]; seq: number; ts: string };

function serialize(doc: Written): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Halves a list, keeping its first half (`keep` "first") or its last (newest-last lists). */
function half<T>(list: readonly T[], keep: "first" | "last" = "first"): T[] {
  const n = Math.floor(list.length / 2);
  return keep === "first" ? list.slice(0, n) : list.slice(list.length - n);
}

/** Every list of the document, halved once. */
function halveLists(b: ProbeBody): ProbeBody {
  return {
    ...b,
    sessions: half(b.sessions),
    actions: half(b.actions),
    exec_log: half(b.exec_log, "last"),
    errors: half(b.errors),
    board: b.board === null ? null : {
      ...b.board,
      ready: { ...b.board.ready, cards: half(b.board.ready.cards) },
      in_progress: { ...b.board.in_progress, cards: half(b.board.in_progress.cards) },
      closed: { ...b.board.closed, recent: half(b.board.closed.recent), earlier: half(b.board.closed.earlier) },
      errors: half(b.board.errors),
    },
  };
}

function listsEmpty(b: ProbeBody): boolean {
  const lists: (readonly unknown[])[] = [b.sessions, b.actions, b.exec_log, b.errors];
  if (b.board) lists.push(b.board.ready.cards, b.board.in_progress.cards, b.board.closed.recent, b.board.closed.earlier, b.board.errors);
  return lists.every((l) => l.length === 0);
}

/** The text to write for `body`, cut down by the module's rule to fit `limit`, and what was cut. */
export function fitProbe(body: ProbeBody, extra: { seq: number; ts: string }, limit = PROBE_MAX_BYTES): { text: string; truncated: string[] } {
  const whole = serialize({ ...body, ...extra });
  if (utf8Bytes(whole) <= limit) return { text: whole, truncated: [] };
  const truncated: string[] = [];
  let b: ProbeBody = body;
  if (b.detail !== null && (b.detail.output !== null || b.detail.pending !== null)) {
    b = { ...b, detail: { ...b.detail, output: null, pending: null } };
    truncated.push("detail.output", "detail.pending");
  }
  if (b.bead_detail !== null && b.bead_detail.description !== null) {
    b = { ...b, bead_detail: { ...b.bead_detail, description: null } };
    truncated.push("bead_detail.description");
  }
  const sizes = (x: ProbeBody) => `sessions ${x.sessions.length}, actions ${x.actions.length}, exec_log ${x.exec_log.length}, errors ${x.errors.length}`;
  const before = sizes(b);
  for (let halvings = 0; ; halvings++) {
    const notes = halvings === 0 ? truncated : [...truncated, `every list halved ${halvings} times (${before} -> ${sizes(b)})`];
    const text = serialize({ ...b, truncated: notes, ...extra });
    if (utf8Bytes(text) <= limit) return { text, truncated: notes };
    if (listsEmpty(b)) break;
    b = halveLists(b);
  }
  const all = [...truncated, "everything but the schema and versions"];
  return { text: serialize({ schema: body.schema, mod_version: body.mod_version, herdr_version: body.herdr_version, truncated: all, ...extra }), truncated: all };
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
  /** The copy whose documents are written, while the probe is on. */
  private owner: object | null = null;
  /** The probe is off and the file is known to be absent or empty. */
  private cleared = false;
  /** What the last cut-down document lost ("" when the last write was whole). */
  private lastCut = "";

  constructor(private readonly io: ProbeIo) {}

  /** Recent write failures and cut-down documents, oldest first. */
  errors(): readonly ProbeError[] {
    return this.failures;
  }

  /**
   * Called from a copy's own tick while the probe is on: writes `body` if
   * `owner` owns the file (or nobody does) and the document changed or a
   * heartbeat is due.
   */
  offer(owner: object, body: ProbeBody, now: number): void {
    if (this.busy(now)) return;
    if (this.owner !== null && this.owner !== owner) return;
    this.owner = owner;
    this.cleared = false;
    const json = JSON.stringify(body);
    if (json === this.lastBody && now - this.lastWriteAt < PROBE_HEARTBEAT_MS) return;
    const fitted = fitProbe(body, { seq: ++this.seq, ts: new Date(now).toISOString() });
    const cut = fitted.truncated.join("; ");
    if (cut !== "" && cut !== this.lastCut) {
      this.record(now, { kind: "probe-truncated", limitBytes: PROBE_MAX_BYTES, dropped: fitted.truncated });
    }
    this.lastCut = cut;
    this.swap(now, () => fitted.text, (text) => {
      this.expected = text;
      this.lastBody = json;
      this.lastWriteAt = now;
    });
  }

  /** Called from a copy's own tick while the probe is off: empties a file that still holds a document. */
  off(now: number): void {
    this.owner = null;
    this.lastBody = null;
    this.lastCut = "";
    if (this.cleared || this.busy(now)) return;
    this.swap(now, (current) => (current === null || current === "" ? null : ""), (text) => {
      this.expected = text;
      this.cleared = true;
    });
  }

  /** The copy closes: it no longer owns the file (the next copy to offer takes over). Starts nothing. */
  release(owner: object): void {
    if (this.owner === owner) this.owner = null;
  }

  /** A write is in flight (one with no answer by the deadline is given up and recorded). */
  private busy(now: number): boolean {
    if (!this.inFlight) return false;
    if (now - this.inFlight.startedAt < PROBE_WRITE_DEADLINE_MS) return true;
    this.fail(now, { kind: "host-call", api: `writeTextFile(${this.io.path()})`, cause: `no answer within ${PROBE_WRITE_DEADLINE_MS} ms` });
    this.inFlight = null;
    return false;
  }

  /**
   * One compare-and-swap: `next` gets what the file holds and returns the text
   * to write, or null to leave it as it is; `done` gets what the file holds after.
   */
  private swap(now: number, next: (current: string | null) => string | null, done: (text: string | null) => void): void {
    const token = ++this.tokens;
    this.inFlight = { token, startedAt: now };
    const path = this.io.path();
    const known = this.expected;
    const current: Promise<Result<string | null, GcError>> = known === undefined ? this.io.read(path) : Promise.resolve(ok(known));
    void current
      .then(async (r): Promise<Result<string | null, GcError>> => {
        if (!r.ok) return r;
        const text = next(r.value);
        if (text === null) return ok(r.value);
        const w = await this.io.write(path, text, r.value);
        return w.ok ? ok(text) : w;
      })
      .then((r) => {
        if (this.inFlight?.token !== token) return;
        this.inFlight = null;
        if (r.ok) done(r.value);
        else this.fail(now, r.error);
      });
  }

  private fail(at: number, error: GcError): void {
    this.expected = undefined;
    this.record(at, error);
  }

  private record(at: number, error: SyncError): void {
    this.failures = [...this.failures, { at, source: "probe" as const, error }].slice(-ERROR_LIMIT);
  }
}

let shared: ProbeWriter | null = null;

/** The app's probe writer, created on first use (module scope, shared by every copy). */
export function sharedProbeWriter(create: () => ProbeWriter): ProbeWriter {
  shared ??= create();
  return shared;
}
