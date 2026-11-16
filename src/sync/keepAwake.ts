// Keep-awake for open session panes: while a session's pane is open, the mod
// pins the session in gc (POST …/pin) so gc does not let it sleep, and when
// the last pane of it closes the mod unpins it — but only a pin the mod made.
//
// gc's pin is one ownerless flag, and SessionResponse does not carry it. The
// only place it shows is the "pin" wake reason of the session list read with
// wake_reasons=true, which the open pane reads once (store.ts). So the mod
// pins only a session that read shows as listed, active, running, without a
// lifecycle reason (which hides the pin) and without the "pin" reason: one a
// person has not pinned. Anything else is left as it is, and said.
//
// The pins the mod made are kept in herdr's shared state (app-wide and kept
// across restarts) as a list of { apiUrl, city, session }, written before the
// pin is sent. A store reads its city's entries when it is created and unpins
// them: a pin left by a crash, or by a copy that closed with its pane open
// (a closing copy's turn can send nothing: herdr never settles its requests),
// is released at the next start.
// A pane that opens while its session is still recorded holds that pin as its
// own (an unpin that did not land, e.g. while gc was unreachable), rather
// than taking gc's "pin" for a person's.
//
// A pane that opens while its session's release is in flight waits for it,
// then decides on a wake-reasons read asked after the release ended: one
// asked before it may still show the mod's own pin.
//
// A stored value that is not a list is someone else's: it is never
// overwritten, and the pane does not pin.
//
// A person's own pin or unpin of the session (the panel's actions) takes it
// over: the mod forgets the pin and never unpins it.
//
// Every request goes through the city's action ledger, so it is in the
// activity log with its outcome, and is sent from a live copy's tick.

import { isPending, type ActionEntry, type ActionSpec } from "../actions/activity.ts";
import { keepAwakePin, keepAwakeUnpin } from "../actions/session.ts";
import type { GcError } from "../gc/errors.ts";
import type { Clock } from "./clock.ts";
import type { CityKey, Slot, WakeReasons } from "./store.ts";

/** The shared-state key of the pins the mod made. */
export const PIN_BOOK_KEY = "gascity.pins";

/** One pin the mod made. */
export interface OwnPin {
  readonly apiUrl: string;
  readonly city: string;
  readonly session: string;
}

/** herdr's shared state under PIN_BOOK_KEY, raw (host.ts). */
export interface PinBook {
  read(): unknown;
  write(value: unknown): void;
}

/** What keep-awake did for an open pane. */
export type KeepAwakeState =
  | { kind: "checking" }
  | { kind: "pinning" }
  | { kind: "pinned" }
  | { kind: "not-pinned"; why: string }
  | { kind: "failed"; error: GcError };

/** Whether to pin, from the pane's one read of gc's wake reasons. */
export type PinDecision = { pin: true } | { pin: false; why: string };

/** Pin only a session gc shows as unpinned and awake, where the pin flag is visible. */
export function pinDecision(w: WakeReasons): PinDecision {
  const s = w.session;
  if (!w.listed || s === null) {
    return { pin: false, why: "gc did not list it under its template, so whether it is pinned cannot be read: not pinned" };
  }
  if (s.reason !== undefined && s.reason !== "") return { pin: false, why: `gc shows ${s.reason}, which hides whether it is pinned: not pinned` };
  if (s.state !== "active") return { pin: false, why: `${s.state}: not pinned` };
  if (!s.running) return { pin: false, why: "not running: not pinned" };
  if (w.reasons.includes("pin")) return { pin: false, why: "already pinned in gc (not by this pane): left as it is" };
  return { pin: true };
}

function isOwnPin(v: unknown): v is OwnPin {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.apiUrl === "string" && typeof o.city === "string" && typeof o.session === "string";
}

/** The stored pins; entries that cannot be read are counted, and left as they are on every write. */
export function decodeOwnPins(raw: unknown): { pins: OwnPin[]; unreadable: number } {
  if (raw === undefined || raw === null) return { pins: [], unreadable: 0 };
  if (!Array.isArray(raw)) return { pins: [], unreadable: 1 };
  const pins = raw.filter(isOwnPin);
  return { pins, unreadable: raw.length - pins.length };
}

const HAND = "pinned or unpinned by hand: left as it is";
const BOOK_UNREADABLE = "the keep-awake records in gascity.pins cannot be read: not pinned";

export interface KeepAwakeDeps {
  readonly key: CityKey;
  readonly book: PinBook;
  readonly clock: Clock;
  /** Starts an action through the city's ledger, in `owner`'s turn; returns its id. */
  start(owner: object, spec: ActionSpec): number;
  /** An action of the ledger by id, while it is in the log. */
  action(id: number): ActionEntry | undefined;
  /** The open pane's wake reasons slot. */
  wake(session: string): Slot<WakeReasons> | undefined;
  /** Asks the open pane's wake reasons again. */
  refreshWake(session: string): void;
  /** The stored pins hold `n` entries that cannot be read. */
  onUnreadable(n: number): void;
}

interface Kept {
  refs: number;
  /** Wake reasons fetched at or after this are the pane's own read. */
  since: number;
  state: KeepAwakeState;
  /** The pin in flight (state pinning). */
  pin: number | null;
  /** The failure is the wake reasons read's: a later read (the pane's refresh) decides again. */
  checkFailed: boolean;
}

interface Release {
  /** The unpin, once sent. */
  unpin: number | null;
  /** A pin of ours still in flight: the unpin waits until it has an outcome. */
  after: number | null;
}

/** One city's keep-awake. */
export class KeepAwake {
  private readonly kept = new Map<string, Kept>();
  private readonly releasing = new Map<string, Release>();
  private disposed = false;

  /** Queues the unpin of every pin of this city left from before. */
  constructor(private readonly deps: KeepAwakeDeps) {
    for (const p of this.ownPins()) {
      if (this.mine(p)) this.releasing.set(p.session, { unpin: null, after: null });
    }
  }

  /** What keep-awake did for a session's open pane; null when no pane of it is open. */
  state(session: string): KeepAwakeState | null {
    return this.kept.get(session)?.state ?? null;
  }

  /** A pane of the session opened. */
  open(session: string): void {
    const k = this.kept.get(session);
    if (k) {
      k.refs++;
      return;
    }
    const r = this.releasing.get(session);
    if (r && r.unpin === null && this.has(session)) {
      // Its unpin was not sent yet: the pin stays, and stays ours.
      this.releasing.delete(session);
      this.kept.set(session, { refs: 1, since: this.deps.clock.now(), state: r.after === null ? { kind: "pinned" } : { kind: "pinning" }, pin: r.after, checkFailed: false });
      return;
    }
    this.kept.set(session, { refs: 1, since: this.deps.clock.now(), state: { kind: "checking" }, pin: null, checkFailed: false });
  }

  /** A pane of the session closed: once the last is gone, a pin of ours is unpinned from a live copy's tick. */
  release(session: string): void {
    const k = this.kept.get(session);
    if (!k || --k.refs > 0) return;
    this.kept.delete(session);
    if (k.state.kind === "pinned" || k.state.kind === "pinning") this.releasing.set(session, { unpin: null, after: k.pin });
  }

  /** A person pinned or unpinned the session: it is theirs now. */
  disown(session: string): void {
    this.releasing.delete(session);
    this.forget(session);
    const k = this.kept.get(session);
    if (k) {
      k.state = { kind: "not-pinned", why: HAND };
      k.pin = null;
      k.checkFailed = false;
    }
  }

  /** Called from a live copy's tick: sends what is due, in its turn, and follows outcomes. */
  tick(owner: object): void {
    if (this.disposed) return;
    for (const [session, r] of [...this.releasing]) this.stepRelease(owner, session, r);
    for (const [session, k] of [...this.kept]) this.stepKept(owner, session, k);
  }

  /** The store is gone (its last copy closed): starts nothing; pins still recorded are released at the next start. */
  dispose(): void {
    this.disposed = true;
  }

  private stepRelease(owner: object, session: string, r: Release): void {
    if (r.unpin === null) {
      if (r.after !== null) {
        const pin = this.deps.action(r.after);
        if (pin && isPending(pin.state)) return;
        r.after = null;
        if (pin && (pin.state.kind === "failed" || pin.state.kind === "not-sent")) {
          // The pin never took: there is nothing to unpin.
          this.forget(session);
          this.released(session);
          return;
        }
      }
      if (!this.has(session)) {
        this.released(session);
        return;
      }
      r.unpin = this.deps.start(owner, keepAwakeUnpin(session));
      return;
    }
    const a = this.deps.action(r.unpin);
    if (a && isPending(a.state)) return;
    // Done or refused: nothing of ours is left. Unknown or not sent: it may still
    // be pinned, so it stays recorded for the next start.
    if (!a || a.state.kind === "done" || a.state.kind === "failed") this.forget(session);
    this.released(session);
  }

  /**
   * A release ended. A pane of the session opened meanwhile has waited in
   * checking; the wake reasons it has may predate the unpin, so it decides on
   * a read asked from now on.
   */
  private released(session: string): void {
    this.releasing.delete(session);
    const k = this.kept.get(session);
    if (k?.state.kind !== "checking") return;
    k.since = this.deps.clock.now();
    this.deps.refreshWake(session);
  }

  private stepKept(owner: object, session: string, k: Kept): void {
    if (k.checkFailed && this.deps.wake(session)?.held === false) {
      // The read is asked again: check once more.
      k.checkFailed = false;
      k.state = { kind: "checking" };
    }
    if (k.state.kind === "checking") {
      if (this.releasing.has(session)) return;
      const w = this.deps.wake(session);
      if (!w || w.value === null || w.fetchedAt === null || w.fetchedAt < k.since) {
        if (w?.held && w.error !== null) {
          k.state = { kind: "failed", error: w.error };
          k.checkFailed = true;
        }
        return;
      }
      if (!this.bookWritable()) {
        k.state = { kind: "not-pinned", why: BOOK_UNREADABLE };
        return;
      }
      const d = pinDecision(w.value);
      if (!d.pin && this.has(session)) {
        // Still recorded as ours (an unpin that did not land): whatever pin gc shows is the mod's, held until the pane closes.
        k.state = { kind: "pinned" };
        return;
      }
      if (!d.pin) {
        k.state = { kind: "not-pinned", why: d.why };
        return;
      }
      // Recorded before it is sent: a crash while it is in flight still leaves it to release.
      this.remember(session);
      k.pin = this.deps.start(owner, keepAwakePin(session));
      k.state = { kind: "pinning" };
      return;
    }
    if (k.state.kind !== "pinning" || k.pin === null) return;
    const a = this.deps.action(k.pin);
    if (a && isPending(a.state)) return;
    k.pin = null;
    if (!a || a.state.kind === "done" || a.state.kind === "unknown") {
      // Unknown: it may have landed, so it is treated as ours.
      k.state = { kind: "pinned" };
    } else if (a.state.kind === "failed") {
      this.forget(session);
      k.state = { kind: "failed", error: a.state.error };
    } else if (a.state.kind === "not-sent") {
      this.forget(session);
      k.state = { kind: "not-pinned", why: `the pin was not sent: ${a.state.reason}` };
    }
  }

  private mine(p: OwnPin): boolean {
    return p.apiUrl === this.deps.key.apiUrl && p.city === this.deps.key.city;
  }

  private pin(session: string): OwnPin {
    return { apiUrl: this.deps.key.apiUrl, city: this.deps.key.city, session };
  }

  private ownPins(): OwnPin[] {
    const { pins, unreadable } = decodeOwnPins(this.deps.book.read());
    if (unreadable > 0) this.deps.onUnreadable(unreadable);
    return pins;
  }

  private has(session: string): boolean {
    return this.ownPins().some((p) => this.mine(p) && p.session === session);
  }

  /** The stored value is a list (or nothing yet): one that is not is someone else's, never overwritten. */
  private bookWritable(): boolean {
    const raw = this.deps.book.read();
    if (raw === undefined || raw === null || Array.isArray(raw)) return true;
    this.deps.onUnreadable(1);
    return false;
  }

  /** The stored list as an array, entries that cannot be read kept as they are; null when the stored value is not a list. */
  private stored(): unknown[] | null {
    const raw = this.deps.book.read();
    if (raw === undefined || raw === null) return [];
    return Array.isArray(raw) ? [...raw] : null;
  }

  private same(v: unknown, session: string): boolean {
    return isOwnPin(v) && this.mine(v) && v.session === session;
  }

  private remember(session: string): void {
    const list = this.stored();
    if (list === null) return;
    this.deps.book.write([...list.filter((v) => !this.same(v, session)), this.pin(session)]);
  }

  private forget(session: string): void {
    const list = this.stored();
    if (list === null) return;
    const next = list.filter((v) => !this.same(v, session));
    if (next.length !== list.length) this.deps.book.write(next);
  }
}
