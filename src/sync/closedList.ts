// The recently-closed list a city store keeps, pure. gc has no close time
// and its closed-bead query is sorted by creation, so the list is built from
// what gc says as it happens:
//   - a close (a bead.closed event's bead, or the bead fetched by id for a
//     close whose payload could not be read) lists the bead at the event's
//     seq, but only if gc says it is closed: a bead reopened before the fetch
//     is not listed;
//   - a bead's later state (a bead.updated event's bead, or a refetch) drops
//     it once it is no longer closed, wherever the board would show it;
//   - a deleted bead is dropped;
//   - a dropped bead is also dropped from the one-time seed (`dropped`);
//   - infrastructure beads (ops.ts) take no slot and are only counted.

import { INFRASTRUCTURE_BEAD_TYPES } from "../gc/ops.ts";
import type * as T from "../gc/types.gen.ts";

/** A closed bead, ordered by close time = its bead.closed event's seq. */
export interface ClosedBead {
  readonly seq: number;
  readonly bead: T.Bead;
}

const INFRASTRUCTURE: ReadonlySet<string> = new Set(INFRASTRUCTURE_BEAD_TYPES);
const CLOSED = "closed";

/** The newest closes, newest first, at most `limit`. */
export class ClosedList {
  private list: ClosedBead[] = [];
  private readonly droppedIds = new Set<string>();
  /** Distinct infrastructure beads among the newest closes, oldest first. */
  private infrastructure: string[] = [];

  constructor(private readonly limit: number) {}

  /** Newest close first. */
  recent(): readonly ClosedBead[] {
    return this.list;
  }

  /** Infrastructure beads among the newest closes (at most `limit`): hidden, not listed. */
  hidden(): number {
    return this.infrastructure.length;
  }

  /** gc said this bead is not closed (any more) or gone: the seed must not list it either. */
  dropped(id: string): boolean {
    return this.droppedIds.has(id);
  }

  /** Is the bead on the list? */
  has(id: string): boolean {
    return this.list.some((c) => c.bead.id === id);
  }

  /** gc reported a close at `seq`, with the bead as gc has it now. */
  closed(seq: number, bead: T.Bead): void {
    if (INFRASTRUCTURE.has(bead.issue_type)) {
      this.infrastructure = [...this.infrastructure.filter((id) => id !== bead.id), bead.id].slice(-this.limit);
      return;
    }
    if (bead.status !== CLOSED) {
      this.remove(bead.id);
      return;
    }
    const cur = this.list.find((c) => c.bead.id === bead.id);
    if (cur && cur.seq > seq) return;
    this.droppedIds.delete(bead.id);
    this.list = [...this.list.filter((c) => c.bead.id !== bead.id), { seq, bead }].sort((a, b) => b.seq - a.seq).slice(0, this.limit);
  }

  /** The bead as gc has it now (an update): dropped unless still closed; a listed one is updated in place. */
  current(bead: T.Bead): void {
    if (bead.status !== CLOSED) {
      this.remove(bead.id);
      return;
    }
    this.list = this.list.map((c) => (c.bead.id === bead.id ? { seq: c.seq, bead } : c));
  }

  /** The bead was deleted, or gc no longer has it. */
  remove(id: string): void {
    this.list = this.list.filter((c) => c.bead.id !== id);
    this.droppedIds.add(id);
  }
}
