// The invalidation map: which gc event types make which store domains stale,
// and which closed beads to fetch for the closed list. Anything not listed
// maps to nothing: the 60 s safety sweep covers it, and an unknown event type
// is not an error.
//
// Every bead event that can move a bead onto, off or within the board
// refreshes both board columns, so an event-confirmed column is never older
// than gc's last word on it. gc emits no session.created/closed, so `bead.*`
// on a session's bead also refreshes sessions; it emits no rig/agent
// suspension events, so those show at the sweep.

import type { TypedEventStreamEnvelope } from "../gc/types.gen.ts";

/** The city data the store keeps, each refetched as a unit. */
export const ALL_DOMAINS = ["rigs", "agents", "sessions", "pending", "ready", "inProgress"] as const;
export type Domain = (typeof ALL_DOMAINS)[number];

/** A closed bead named by a bead.closed event; `seq` orders the closed list by close time. */
export interface ClosedRef {
  id: string;
  seq: number;
}

/** What a batch of events makes stale. */
export interface Invalidation {
  domains: Set<Domain>;
  /** Closed beads, oldest close first, one entry per bead at its latest close. */
  closed: ClosedRef[];
  /** A city.* event: the supervisor's city list may have changed (owned by discovery). */
  cities: boolean;
}

/** What the store already shows, to decide which subjects matter. */
export interface KnownIds {
  sessionIds: ReadonlySet<string>;
}

const SESSION_REFRESH = new Set(["request.failed", "worker.operation"]);
/** Bead events that can move a bead onto, off or within the board's columns. */
const BOARD_CHANGES = new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted", "bead.dead_assignee_reopened"]);

const PENDING = new Set(["session.pending", "session.pending_cleared"]);

/** Maps events (any order) to the refetches they call for. */
export function invalidationFor(events: readonly TypedEventStreamEnvelope[], known: KnownIds): Invalidation {
  const inv: Invalidation = { domains: new Set(), closed: [], cities: false };
  const closed = new Map<string, number>();
  for (const e of events) {
    const t = e.type;
    const subject = e.subject;
    if (PENDING.has(t)) {
      inv.domains.add("pending");
    } else if (t.startsWith("session.") || t.startsWith("request.result.session.") || SESSION_REFRESH.has(t)) {
      inv.domains.add("sessions");
      inv.domains.add("agents");
    } else if (t.startsWith("bead.")) {
      if (subject !== undefined && known.sessionIds.has(subject)) inv.domains.add("sessions");
      if (BOARD_CHANGES.has(t)) {
        inv.domains.add("ready");
        inv.domains.add("inProgress");
      }
      if (t === "bead.closed" && subject !== undefined) closed.set(subject, Math.max(closed.get(subject) ?? -Infinity, e.seq));
    } else if (t.startsWith("city.")) {
      inv.cities = true;
      inv.domains.add("rigs");
      inv.domains.add("agents");
    }
  }
  inv.closed = [...closed].map(([id, seq]) => ({ id, seq })).sort((a, b) => a.seq - b.seq);
  return inv;
}
