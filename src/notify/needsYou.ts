// "Needs you" toasts: one per new pending interaction of a city.
//
// The source is the city's pending list in the shared store (gc's
// `/pending`, refetched on events and at the session cadence), so one
// notifier per city store serves every copy: two copies of a city never
// post the same toast twice. A pending item is gc's (session, request id)
// pair; the notifier remembers every pair it has posted, so a refetch, a
// resync after missed events or a reconnect after an outage — which bring
// back the same pairs — posts nothing. The first list a store sees is the
// baseline: what was already pending when the city was opened is shown by
// the panel's "N need you", not toasted.
//
// A session gets at most one toast per TOAST_INTERVAL_MS. A newer prompt
// inside that window waits, and is toasted once the window has passed if gc
// still lists it (back-to-back permission prompts are common: dropping the
// second would leave the agent stalled in silence). A burst posts at most
// BURST_LIMIT toasts and one summary for the rest. A toast the host could
// not post waits for its session's window and is tried again.
//
// Pure: the registry calls `observe` from a copy's tick, and host.ts posts.

import type * as T from "../gc/types.gen.ts";
import { cleanLine } from "../vm/sanitize.ts";

/** At most one toast per session this often. */
export const TOAST_INTERVAL_MS = 30_000;
/** Toasts posted at once; the rest of a burst get one summary toast. */
export const BURST_LIMIT = 3;
/** Seen pairs kept (oldest forgotten first). */
export const SEEN_LIMIT = 1000;

/** A new pending interaction to toast; display text is cleaned. */
export interface NeedsYou {
  city: string;
  /** gc's session id. */
  session: string;
  requestId: string;
  /** The session as the panel names it (alias, else template, else id), cleaned. */
  label: string;
  /** gc's pending kind (permission, question, …), cleaned. */
  kind: string;
}

/** What to post now for one city: toasts, and how many more prompts one summary toast covers (0: none). */
export interface NeedsYouBatch {
  city: string;
  toasts: NeedsYou[];
  more: number;
}

/** The toast text for one item. */
export function toastText(n: NeedsYou): { title: string; body: string } {
  return { title: `${n.label} needs you`, body: cleanLine(`${n.kind} · session ${n.session} · city ${n.city}`) };
}

/** The summary toast's text. */
export function summaryText(city: string, more: number): { title: string; body: string } {
  return { title: `${more} more sessions need you`, body: cleanLine(`city ${city}`) };
}

/** The city's pending list as the notifier reads it. */
export interface PendingRead {
  items: readonly T.CityPendingEntry[];
  /** gc's list may lack entries (partial), or some could not be read: nothing is taken as resolved. */
  partial?: boolean | undefined;
  unreadable?: readonly unknown[];
}

const keyOf = (n: { session: string; requestId: string }) => `${n.session}\u0000${n.requestId}`;

/** Follows one city's pending list. */
export class NeedsYouNotifier {
  private baseline = false;
  private lastList: object | null = null;
  /** Pairs posted, covered by a summary, or in the baseline. */
  private readonly posted = new Set<string>();
  /** Pairs to post once their session's window has passed, oldest first. */
  private readonly waiting = new Map<string, NeedsYou>();
  private readonly lastToast = new Map<string, number>();

  constructor(private readonly city: string) {}

  /**
   * What to post now, given the store's current pending list (null: not
   * fetched yet) and session list. Call on every tick: a waiting prompt
   * becomes due with time alone.
   */
  observe(pending: PendingRead | null, sessions: { items: readonly T.SessionResponse[] } | null, now: number): NeedsYouBatch {
    const batch: NeedsYouBatch = { city: this.city, toasts: [], more: 0 };
    if (pending === null) return batch;
    if (pending !== this.lastList) {
      this.lastList = pending;
      this.take(pending, sessions);
    }
    const due: [string, NeedsYou][] = [];
    const taken = new Set<string>();
    for (const [key, n] of this.waiting) {
      if (taken.has(n.session)) continue;
      const last = this.lastToast.get(n.session);
      if (last !== undefined && now - last < TOAST_INTERVAL_MS) continue;
      taken.add(n.session);
      due.push([key, n]);
    }
    for (const [key, n] of due) {
      this.waiting.delete(key);
      this.remember(key);
      this.lastToast.set(n.session, now);
    }
    batch.toasts = due.slice(0, BURST_LIMIT).map(([, n]) => n);
    batch.more = Math.max(0, due.length - BURST_LIMIT);
    return batch;
  }

  /** Toasts the host could not post: tried again once their session's window has passed. */
  failed(items: readonly NeedsYou[], now: number): void {
    for (const n of items) {
      const key = keyOf(n);
      this.posted.delete(key);
      this.waiting.set(key, n);
      this.lastToast.set(n.session, now);
    }
  }

  private take(pending: PendingRead, sessions: { items: readonly T.SessionResponse[] } | null): void {
    const present = new Set<string>();
    for (const p of pending.items) {
      const key = keyOf({ session: p.session_id, requestId: p.request_id });
      present.add(key);
      if (this.posted.has(key) || this.waiting.has(key)) continue;
      if (!this.baseline) {
        this.remember(key);
        continue;
      }
      const s = sessions?.items.find((x) => x.id === p.session_id);
      const label = cleanLine(s?.alias || s?.template || p.session_id);
      this.waiting.set(key, { city: this.city, session: p.session_id, requestId: p.request_id, label, kind: cleanLine(p.kind) });
    }
    // A prompt answered before its turn came is not toasted; a list that may lack entries resolves nothing.
    if (!pending.partial && (pending.unreadable?.length ?? 0) === 0) {
      for (const key of [...this.waiting.keys()]) if (!present.has(key)) this.waiting.delete(key);
    }
    this.baseline = true;
  }

  private remember(key: string): void {
    this.posted.add(key);
    if (this.posted.size <= SEEN_LIMIT) return;
    const oldest = this.posted.values().next().value;
    if (oldest !== undefined) this.posted.delete(oldest);
  }
}
