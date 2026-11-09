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
// settles. herdr's own 30 s timeout has freed the pool thread by then, so a
// slot older than RECLAIM_AFTER_MS is reclaimed (on every fetchFor, pump and
// reclaim call) and its caller gets a timeout rejection: a read backs off, a
// mutation becomes outcome-unknown. Nothing here retries.
//
// Every rejection the caller sees carries `hostElapsedMs`, the host fetch's
// own duration, so time spent queued here never looks like a timeout.

import { HERDR_FETCH_TIMEOUT_MS, type HostFetch, type HostRequest, type HostResponse } from "../gc/client.ts";
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
  start: () => void;
}

interface Running {
  endpoint: string;
  startedAt: number;
  /** Ends the slot and settles the caller; false if it had already ended. */
  end: (outcome: { response: HostResponse } | { error: unknown }) => boolean;
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

/** A rejection for the caller: herdr's message, plus how long the host fetch itself ran. */
function timedRejection(cause: unknown, hostElapsedMs: number): Error & { hostElapsedMs: number } {
  const e = new Error(messageOf(cause)) as Error & { hostElapsedMs: number };
  e.hostElapsedMs = hostElapsedMs;
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

  /** A fetch for `endpoint` (an API base URL) at `priority`, for a GcClient. */
  fetchFor(endpoint: string, priority: FetchPriority): HostFetch {
    const rank = PRIORITIES.indexOf(priority);
    return (url: string, init: HostRequest) =>
      new Promise<HostResponse>((resolve, reject) => {
        this.queue.push({
          endpoint,
          rank,
          seq: this.seq++,
          start: () => this.start(endpoint, url, init, resolve, reject),
        });
        this.reclaim();
      });
  }

  /** Enters or leaves degraded mode for an endpoint. */
  setDegraded(endpoint: string, degraded: boolean): void {
    if (degraded) this.degraded.add(endpoint);
    else this.degraded.delete(endpoint);
    this.pump();
  }

  /** Frees every slot older than RECLAIM_AFTER_MS, then starts what fits. */
  reclaim(): void {
    const now = this.clock.now();
    for (const r of [...this.running]) {
      if (now - r.startedAt >= RECLAIM_AFTER_MS) {
        r.end({ error: `gascity: request timed out: no answer after ${now - r.startedAt} ms (herdr cancelled it with its copy)` });
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
        else reject(timedRejection(outcome.error, this.clock.now() - startedAt));
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
