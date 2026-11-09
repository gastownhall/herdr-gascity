// The app-wide fetch budget. herdr's fetch is a blocking call on the GPUI
// background pool: one pool thread per request for its whole duration, and
// herdr's own work runs on the same pool (minimum 2 threads). So every
// gascity request, from every copy and city, passes through one budget:
//   - at most MAX_IN_FLIGHT (2) requests in flight per app;
//   - at most DEGRADED_IN_FLIGHT (1) to an endpoint in degraded mode (it is
//     backing off), so a hung gc pins at most one thread;
//   - queued requests start in priority order (mutation > events > snapshot
//     > peek > sweep), first come first served within a priority.
//
// herdr owns each fetch by the copy whose code was running when it started,
// and when that copy closes the fetch is cancelled: its promise never
// settles. A live copy's fetch always settles within herdr's own 30 s
// timeout, so a slot older than RECLAIM_AFTER_MS belongs to a closed copy: it
// is reclaimed (on every fetchFor and reclaim call) and its caller gets a
// cancellation, not a gc timeout: nothing backs off for it, and a mutation
// becomes outcome-unknown. Nothing here retries.
//
// A caller may tag its requests with a group (a sync step) and drop the
// group's queued requests when nothing waits for them any more, so they are
// never sent. Dropping and forgetting an endpoint never start a request: they
// run from a copy's close, where a new fetch would belong to a closing copy.
//
// Every rejection the caller sees carries `hostElapsedMs`, the host fetch's
// own duration, so time spent queued here never looks like a timeout, and a
// cancellation carries `cancelled` (CancelReason).

import { HERDR_FETCH_TIMEOUT_MS, type HostFetch, type HostRequest, type HostResponse } from "../gc/client.ts";
import type { CancelReason } from "../gc/errors.ts";
import type { Clock } from "./clock.ts";

/** Request priorities, most urgent first. */
export const PRIORITIES = ["mutation", "events", "snapshot", "peek", "sweep"] as const;
export type FetchPriority = (typeof PRIORITIES)[number];

/** gascity fetches in flight per app. */
export const MAX_IN_FLIGHT = 2;
/** fetches in flight to an endpoint in degraded mode. */
export const DEGRADED_IN_FLIGHT = 1;
/** A slot this old has outlived herdr's fetch timeout: its fetch was cancelled with its copy. */
export const RECLAIM_AFTER_MS = HERDR_FETCH_TIMEOUT_MS + 5_000;

interface Queued {
  endpoint: string;
  rank: number;
  seq: number;
  group: object | null;
  start: () => void;
  drop: () => void;
}

interface Running {
  endpoint: string;
  startedAt: number;
  /** Ends the slot and settles the caller; false if it had already ended. */
  end: (outcome: { response: HostResponse } | { error: unknown; cancelled?: CancelReason }) => boolean;
}

/** Budget counters for diagnostics and the probe. */
export interface BudgetStats {
  inFlight: number;
  queued: number;
  /** The most requests ever in flight at once. */
  maxInFlight: number;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
}

/** A rejection the budget hands its callers. */
export type BudgetRejection = Error & { hostElapsedMs: number; cancelled?: CancelReason };

/** A rejection for the caller: herdr's message, how long the host fetch itself ran, and whether the budget cancelled it. */
function timedRejection(cause: unknown, hostElapsedMs: number, cancelled?: CancelReason): BudgetRejection {
  const e = new Error(messageOf(cause)) as BudgetRejection;
  e.hostElapsedMs = hostElapsedMs;
  if (cancelled !== undefined) e.cancelled = cancelled;
  return e;
}

/** The one gate every gascity fetch passes. */
export class FetchBudget {
  private readonly queue: Queued[] = [];
  private readonly running = new Set<Running>();
  private readonly degraded = new Set<string>();
  private highWater = 0;
  private seq = 0;

  constructor(private readonly hostFetch: HostFetch, private readonly clock: Clock) {}

  /**
   * A fetch for `endpoint` (an API base URL) at `priority`, for a GcClient.
   * Requests made with a `group` can be dropped together while still queued.
   */
  fetchFor(endpoint: string, priority: FetchPriority, group: object | null = null): HostFetch {
    const rank = PRIORITIES.indexOf(priority);
    return (url: string, init: HostRequest) =>
      new Promise<HostResponse>((resolve, reject) => {
        this.queue.push({
          endpoint,
          rank,
          seq: this.seq++,
          group,
          start: () => this.start(endpoint, url, init, resolve, reject),
          drop: () => reject(timedRejection(`gascity: request to ${url} dropped before it was sent`, 0, "abandoned")),
        });
        this.reclaim();
      });
  }

  /** Enters or leaves degraded mode for an endpoint; leaving it starts what now fits. */
  setDegraded(endpoint: string, degraded: boolean): void {
    if (degraded) {
      this.degraded.add(endpoint);
      return;
    }
    this.degraded.delete(endpoint);
    this.pump();
  }

  /**
   * Forgets an endpoint nobody uses any more (the last store on it went, from
   * a copy's close): leaves degraded mode without starting anything. Whatever
   * that frees starts at the next reclaim or settled request.
   */
  forgetEndpoint(endpoint: string): void {
    this.degraded.delete(endpoint);
  }

  /**
   * Drops the group's queued requests: each rejects as cancelled
   * ("abandoned") and is never sent. In-flight requests are untouched (their
   * slots stay taken until herdr settles them). Starts nothing. Returns how
   * many were dropped.
   */
  dropQueued(group: object): number {
    const dropped = this.queue.filter((q) => q.group === group);
    if (dropped.length === 0) return 0;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.group === group) this.queue.splice(i, 1);
    for (const q of dropped) q.drop();
    return dropped.length;
  }

  /** Frees every slot older than RECLAIM_AFTER_MS (its copy closed), then starts what fits. */
  reclaim(): void {
    const now = this.clock.now();
    for (const r of [...this.running]) {
      if (now - r.startedAt >= RECLAIM_AFTER_MS) {
        const error = `gascity: request cancelled: no answer after ${now - r.startedAt} ms, so herdr cancelled it with the copy that started it`;
        r.end({ error, cancelled: "copy-closed" });
      }
    }
    this.pump();
  }

  /** Requests in flight to one endpoint. */
  inFlightTo(endpoint: string): number {
    let n = 0;
    for (const r of this.running) if (r.endpoint === endpoint) n++;
    return n;
  }

  stats(): BudgetStats {
    return { inFlight: this.running.size, queued: this.queue.length, maxInFlight: this.highWater };
  }

  private start(endpoint: string, url: string, init: HostRequest, resolve: (r: HostResponse) => void, reject: (e: unknown) => void): void {
    const startedAt = this.clock.now();
    let ended = false;
    const slot: Running = {
      endpoint,
      startedAt,
      end: (outcome) => {
        if (ended) return false;
        ended = true;
        this.running.delete(slot);
        if ("response" in outcome) resolve(outcome.response);
        else reject(timedRejection(outcome.error, this.clock.now() - startedAt, outcome.cancelled));
        this.pump();
        return true;
      },
    };
    this.running.add(slot);
    this.highWater = Math.max(this.highWater, this.running.size);
    let pending: Promise<HostResponse>;
    try {
      pending = this.hostFetch(url, init);
    } catch (cause) {
      pending = Promise.reject(cause);
    }
    pending.then((response) => slot.end({ response }), (error: unknown) => slot.end({ error }));
  }

  private startable(q: Queued): boolean {
    return !this.degraded.has(q.endpoint) || this.inFlightTo(q.endpoint) < DEGRADED_IN_FLIGHT;
  }

  private pump(): void {
    while (this.running.size < MAX_IN_FLIGHT) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i] as Queued;
        if (!this.startable(q)) continue;
        const b = best < 0 ? undefined : this.queue[best];
        if (!b || q.rank < b.rank || (q.rank === b.rank && q.seq < b.seq)) best = i;
      }
      if (best < 0) return;
      const [next] = this.queue.splice(best, 1) as [Queued];
      next.start();
    }
  }
}
