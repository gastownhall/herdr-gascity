// Staleness as typed state: every region knows how old its data
// is and whether it is stale, and why. Stale data is kept and shown greyed,
// never silently cleared or silently kept.
//
// An event-driven domain (rigs, agents, the board) does not change unless an
// event says so, so each successful event poll that left it clean confirms
// it: its age runs from the later of its fetch and that poll.

import type { GcError } from "../gc/errors.ts";

/** Data is never called overdue before this age. */
export const STALE_FLOOR_MS = 10_000;

/** The age after which data refreshed every `intervalMs` is overdue. */
export function staleAfterMs(intervalMs: number): number {
  return Math.max(3 * intervalMs, STALE_FLOOR_MS);
}

/** The parts of a store slot staleness reads. */
export interface SlotMeta {
  fetchedAt: number | null;
  error: GcError | null;
  /** A refetch is wanted (an event or a sweep asked for it). */
  dirty: boolean;
}

/** How current a region's data is. */
export type Freshness =
  | { kind: "never"; error: GcError | null }
  | { kind: "fresh"; ageMs: number }
  | { kind: "stale"; ageMs: number; reason: "error" | "overdue"; error: GcError | null };

/** The domain's refresh interval and, for event-driven domains, the last successful event poll. */
export interface FreshnessInput {
  intervalMs: number;
  confirmedAt: number | null;
}

/** The freshness of one slot at `now`. */
export function freshness(slot: SlotMeta, now: number, input: FreshnessInput): Freshness {
  if (slot.fetchedAt === null) return { kind: "never", error: slot.error };
  const confirmed = !slot.dirty && input.confirmedAt !== null ? Math.max(slot.fetchedAt, input.confirmedAt) : slot.fetchedAt;
  const ageMs = now - confirmed;
  if (slot.error !== null) return { kind: "stale", ageMs, reason: "error", error: slot.error };
  if (ageMs > staleAfterMs(input.intervalMs)) return { kind: "stale", ageMs, reason: "overdue", error: null };
  return { kind: "fresh", ageMs };
}
