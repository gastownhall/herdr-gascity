// "Needs you" toasts: one per new pending interaction of a city.
//
// The source is the city's pending list in the shared store (gc's
// `/pending`, refetched on events and at the session cadence), so one
// notifier per city store serves every copy: two copies of a city never
// post the same toast twice. A pending item is gc's (session, request id)
// pair; the notifier remembers every pair it has seen, so a refetch, a
// resync after missed events or a reconnect after an outage — which bring
// back the same pairs — posts nothing. The first list a store sees is the
// baseline: what was already pending when the city was opened is shown by
// the panel's "N need you", not toasted. A session gets at most one toast
// per TOAST_INTERVAL_MS; a new request inside that window is remembered and
// not toasted.
//
// Pure: the registry calls `observe` from a copy's tick, and host.ts posts.

import type * as T from "../gc/types.gen.ts";
import { cleanLine } from "../vm/sanitize.ts";

/** At most one toast per session this often. */
export const TOAST_INTERVAL_MS = 30_000;
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

/** The toast text for one item. */
export function toastText(n: NeedsYou): { title: string; body: string } {
  return { title: `${n.label} needs you`, body: cleanLine(`${n.kind} · session ${n.session} · city ${n.city}`) };
}

/** Follows one city's pending list. */
export class NeedsYouNotifier {
  private baseline = false;
  private lastList: object | null = null;
  private readonly seen = new Set<string>();
  private readonly lastToast = new Map<string, number>();

  constructor(private readonly city: string) {}

  /**
   * The items to toast now, given the store's current pending list (null:
   * not fetched yet) and session list. Call on every tick; an unchanged list
   * returns nothing at once.
   */
  observe(pending: { items: readonly T.CityPendingEntry[] } | null, sessions: { items: readonly T.SessionResponse[] } | null, now: number): NeedsYou[] {
    if (pending === null || pending === this.lastList) return [];
    this.lastList = pending;
    const out: NeedsYou[] = [];
    for (const p of pending.items) {
      const key = `${p.session_id}\u0000${p.request_id}`;
      if (this.seen.has(key)) continue;
      this.remember(key);
      if (!this.baseline) continue;
      const last = this.lastToast.get(p.session_id);
      if (last !== undefined && now - last < TOAST_INTERVAL_MS) continue;
      this.lastToast.set(p.session_id, now);
      const s = sessions?.items.find((x) => x.id === p.session_id);
      const label = cleanLine(s?.alias || s?.template || p.session_id);
      out.push({ city: this.city, session: p.session_id, requestId: p.request_id, label, kind: cleanLine(p.kind) });
    }
    this.baseline = true;
    return out;
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size <= SEEN_LIMIT) return;
    const oldest = this.seen.values().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
  }
}
