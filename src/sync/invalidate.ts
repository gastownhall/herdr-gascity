// The invalidation map: which gc event types make which store domains stale.
// (The closed list follows the beads bead events carry: store.ts.) Anything not listed
// maps to nothing: the 60 s safety sweep covers it, and an unknown event type
// is not an error.
//
// Every bead event that can move a bead onto, off or within the board
// refreshes both board columns, so an event-confirmed column is never older
// than gc's last word on it. A session's start and end are session.created
// and session.closed; a closed session's pending prompt goes with it, so
// session.closed also refreshes pending. `bead.*` on a known session's bead
// still refreshes sessions (gc changes session beads without a session.*
// event, e.g. metadata). gc emits no rig/agent suspension events, so those
// show at the sweep.

import type { TypedEventStreamEnvelope } from "../gc/types.gen.ts";

/** The city data the store keeps, each refetched as a unit. */
export const ALL_DOMAINS = ["rigs", "agents", "sessions", "pending", "ready", "inProgress"] as const;
export type Domain = (typeof ALL_DOMAINS)[number];

/** What a batch of events makes stale. */
export interface Invalidation {
  domains: Set<Domain>;
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

/** A session starting or ending. */
export const SESSION_LIFECYCLE: ReadonlySet<string> = new Set(["session.created", "session.closed"]);

/**
 * Every event type handled by its exact name (not by a prefix): a test checks
 * each against gc's event names in the pinned spec, so a rename in gc fails it
 * at the next re-pin.
 */
export const HANDLED_BY_NAME: readonly string[] = [...SESSION_REFRESH, ...BOARD_CHANGES, ...PENDING, ...SESSION_LIFECYCLE];

/** Maps events (any order) to the refetches they call for. */
export function invalidationFor(events: readonly TypedEventStreamEnvelope[], known: KnownIds): Invalidation {
  const inv: Invalidation = { domains: new Set(), cities: false };
  for (const e of events) {
    const t = e.type;
    const subject = e.subject;
    if (PENDING.has(t)) {
      inv.domains.add("pending");
    } else if (SESSION_LIFECYCLE.has(t)) {
      inv.domains.add("sessions");
      inv.domains.add("agents");
      if (t === "session.closed") inv.domains.add("pending");
    } else if (t.startsWith("session.") || t.startsWith("request.result.session.") || SESSION_REFRESH.has(t)) {
      inv.domains.add("sessions");
      inv.domains.add("agents");
    } else if (t.startsWith("bead.")) {
      if (subject !== undefined && known.sessionIds.has(subject)) inv.domains.add("sessions");
      if (BOARD_CHANGES.has(t)) {
        inv.domains.add("ready");
        inv.domains.add("inProgress");
      }
    } else if (t.startsWith("city.")) {
      inv.cities = true;
      inv.domains.add("rigs");
      inv.domains.add("agents");
    }
  }
  return inv;
}
