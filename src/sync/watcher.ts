// The event watcher's cursor arithmetic. herdr's fetch hides response
// headers, so X-GC-Index is invisible and the cursor comes from the body. A
// poll is `GET …/events?limit=50` without `index`: it answers at once, newest
// first.
//
// gc reads the page before it reads LatestSeq for `total`, so an event
// appended in between makes `total` name an event the page does not hold.
// The cursor is therefore the newest seq the page shows, never `total`, and
// the raced event arrives with the next poll. gc's event seqs are contiguous
// and survive restarts, so:
//   - a gap is a hole between the cursor and the oldest new event, or an
//     unreadable entry that may be new (it cannot be delivered);
//   - a reset is a `total` below the cursor (the log was replaced).

import type { TypedEventStreamEnvelope } from "../gc/types.gen.ts";

/** Events per short poll. */
export const EVENT_PAGE_LIMIT = 50;

/** Why the watcher lost track: events it could not deliver ("gap"), or gc's log was replaced ("reset"). */
export type Resync = "gap" | "reset";

/** One poll read against the cursor. */
export interface PageReading {
  /** The cursor after this page. */
  cursor: number;
  /** Events newer than the old cursor, oldest first. */
  newer: TypedEventStreamEnvelope[];
  /** Set when some events since the cursor cannot be delivered: refetch everything. */
  resync: Resync | null;
}

/** A decoded page: the readable events (newest first), the page positions of entries that did not decode, and gc's total. */
export interface EventPage {
  items: readonly TypedEventStreamEnvelope[];
  unreadable: readonly number[];
  total: number;
}

/** Reads one page against `cursor`. */
export function readEventPage(cursor: number, page: EventPage): PageReading {
  if (page.total < cursor) return { cursor: page.total, newer: [], resync: "reset" };

  // Walk the page in its order (newest first), keeping the seq of the last
  // readable entry above: an unreadable entry's seq is below it (or at most
  // `total` when nothing readable is above), so it is old only if that bound
  // is at or below the cursor.
  const unreadable = new Set(page.unreadable);
  const length = page.items.length + unreadable.size;
  let next = 0;
  let above: number | null = null;
  let unreadableNew = false;
  for (let position = 0; position < length; position++) {
    if (unreadable.has(position)) {
      const isOld = above === null ? page.total <= cursor : above <= cursor + 1;
      if (!isOld) unreadableNew = true;
      continue;
    }
    above = page.items[next++]?.seq ?? above;
  }

  const newer = page.items.filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq);
  const newest = newer.at(-1)?.seq ?? cursor;
  const hole = newer.length > 0 && (newer[0]?.seq ?? 0) > cursor + 1;
  if (unreadableNew) return { cursor: Math.max(newest, page.total), newer, resync: "gap" };
  return { cursor: newest, newer, resync: hole ? "gap" : null };
}
