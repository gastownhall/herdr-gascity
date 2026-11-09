// The shared city list: one `GET /v0/cities` poll per gc API per app,
// whatever the number of copies. Every 10 s while no subscribed copy shows a
// running city (so a city that is starting appears soon), every 60 s once one
// does, and at the next tick after a city.* event.
//
// It follows the same ownership rule as the city stores (store.ts): it owns
// no timer, each subscribed copy calls `tick` from its own periodic timer, a
// poll starts only inside such a tick, and closing the copy that started a
// poll abandons it (its queued request is dropped, a late answer ignored)
// without starting anything. A poll with no answer by POLL_DEADLINE_MS is
// abandoned the same way.
//
// While the endpoint backs off, the poll waits for the probe like any read;
// if no city store is probing (no copy shows a running city), the poll takes
// the probe itself.

import type { GcError } from "../gc/errors.ts";
import { listCities } from "../gc/ops.ts";
import type { CityList } from "../discovery/city.ts";
import type { Result } from "../result.ts";
import { backsOff } from "./backoff.ts";
import { RECLAIM_AFTER_MS } from "./budget.ts";
import type { Clock } from "./clock.ts";
import type { Endpoint, EndpointListener } from "./endpoint.ts";

/** The poll interval while no copy shows a running city. */
export const CITIES_FAST_MS = 10_000;
/** The poll interval once a copy shows a running city. */
export const CITIES_SLOW_MS = 60_000;
/** A poll with no answer by then is abandoned (the budget reclaims a cancelled request first). */
export const POLL_DEADLINE_MS = RECLAIM_AFTER_MS + 5_000;

/** The shared city list, immutable; a new object (and rev) per change. */
export interface CitiesSnapshot {
  readonly rev: number;
  /** The last good list. */
  readonly value: CityList | null;
  readonly fetchedAt: number | null;
  /** The last poll's failure, if it failed. */
  readonly error: GcError | null;
}

interface Poll {
  starter: object;
  startedAt: number;
  probe: number | null;
}

/** One gc API's shared city list. */
export class CitiesPoller implements EndpointListener {
  private snap: CitiesSnapshot = { rev: 0, value: null, fetchedAt: null, error: null };
  private last: number | null = null;
  private wanted = false;
  private poll: Poll | null = null;
  private disposed = false;

  constructor(private readonly endpoint: Endpoint, private readonly clock: Clock) {
    endpoint.addListener(this);
  }

  snapshot(): CitiesSnapshot {
    return this.snap;
  }

  /**
   * Called by a subscribed copy in its own turn; `fast` when that copy shows
   * no running city. Starts a poll if one is due and none is running.
   */
  tick(starter: object, fast: boolean): void {
    if (this.disposed) return;
    const now = this.clock.now();
    if (this.poll) {
      if (now - this.poll.startedAt <= POLL_DEADLINE_MS) return;
      this.abandon();
    }
    const interval = fast ? CITIES_FAST_MS : CITIES_SLOW_MS;
    if (!this.wanted && this.last !== null && now < this.last + interval) return;
    const gate = this.endpoint.gate(now);
    if (gate.kind === "wait") return;
    const poll: Poll = { starter, startedAt: now, probe: gate.kind === "probe" ? gate.token : null };
    this.poll = poll;
    this.wanted = false;
    this.last = now;
    void listCities(this.endpoint.client("snapshot", poll)).then((r) => this.settle(poll, r));
  }

  /** Polls at the next tick (a city.* event, "retry now"). */
  refresh(): void {
    this.wanted = true;
  }

  /** The copy `starter` closes: drop the poll it started. Starts nothing. */
  abandonStartedBy(starter: object): void {
    if (this.poll?.starter === starter) {
      this.abandon();
      this.wanted = true;
    }
  }

  dispose(): void {
    this.abandon();
    this.disposed = true;
    this.endpoint.removeListener(this);
  }

  endpointChanged(recovered: boolean): void {
    if (recovered) this.wanted = true;
  }

  private abandon(): void {
    const poll = this.poll;
    if (!poll) return;
    this.poll = null;
    if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
    this.endpoint.dropQueued(poll);
  }

  private settle(poll: Poll, r: Result<CityList, GcError>): void {
    if (poll.probe !== null) this.endpoint.endProbe(poll.probe);
    if (this.poll !== poll || this.disposed) return;
    this.poll = null;
    const now = this.clock.now();
    if (r.ok) {
      this.endpoint.succeeded();
      this.snap = { rev: this.snap.rev + 1, value: r.value, fetchedAt: now, error: null };
      return;
    }
    if (r.error.kind === "cancelled") {
      this.wanted = true;
      return;
    }
    if (backsOff(r.error)) this.endpoint.failed(r.error);
    else this.endpoint.succeeded();
    this.snap = { ...this.snap, rev: this.snap.rev + 1, error: r.error };
  }
}
