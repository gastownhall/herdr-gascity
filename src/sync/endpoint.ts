// One gc API endpoint as the sync engine sees it: its budgeted clients (one
// per fetch priority) and its health. Health is shared by every city store
// on the endpoint: a transport failure or 5xx on any read puts the endpoint
// into backoff and the budget's degraded mode, and from
// then on exactly one read — the probe — may go out per retry time, from one
// store. The first success clears both and asks every store to resync.

import { createGcClient, type GcClient, type GcClientOptions } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { err, ok, type Result } from "../result.ts";
import { failBackoff, retryBackoffNow, type BackoffState } from "./backoff.ts";
import { PRIORITIES, RECLAIM_AFTER_MS, type FetchBudget, type FetchPriority } from "./budget.ts";
import type { Clock } from "./clock.ts";

/** The endpoint's state as the header shows it. */
export type Connection =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "backing-off"; attempt: number; retryAt: number; cause: GcError };

/** May a store read now: freely, only the probe, or not until `until`? */
export type Gate = { kind: "open" } | { kind: "probe"; token: number } | { kind: "wait"; until: number };

/**
 * A probe not ended by then is presumed lost (herdr never settles a closed
 * copy's fetch; the budget reclaims its slot first), and another may go out.
 */
export const PROBE_DEADLINE_MS = RECLAIM_AFTER_MS + 5_000;

/** What an endpoint tells the stores that use it. */
export interface EndpointListener {
  /** The connection changed; `recovered` when a backoff just ended (every domain should be refetched). */
  endpointChanged(recovered: boolean): void;
}

/** A gc API endpoint shared by the city stores on it. */
export class Endpoint {
  private readonly listeners = new Set<EndpointListener>();
  private backoff: BackoffState | null = null;
  private probe: { token: number; until: number } | null = null;
  private probeTokens = 0;
  private connected = false;

  private constructor(
    readonly baseUrl: string,
    private readonly clients: Readonly<Record<FetchPriority, GcClient>>,
    private readonly budget: FetchBudget,
    private readonly clock: Clock,
    private readonly random: () => number,
  ) {}

  /** An endpoint for a loopback API URL; `not-loopback` otherwise. */
  static create(apiUrl: string, budget: FetchBudget, clock: Clock, random: () => number): Result<Endpoint, GcError> {
    const clients: Partial<Record<FetchPriority, GcClient>> = {};
    let baseUrl = apiUrl;
    for (const p of PRIORITIES) {
      const made = createGcClient({ baseUrl: apiUrl, fetch: (url, init) => budget.fetchFor(baseUrl, p)(url, init), now: () => clock.now() });
      if (!made.ok) return err(made.error);
      baseUrl = made.value.baseUrl;
      clients[p] = made.value;
    }
    return ok(new Endpoint(baseUrl, clients as Record<FetchPriority, GcClient>, budget, clock, random));
  }

  /**
   * The client whose requests queue at `priority`. With a `group` (a sync
   * step), its queued requests can be dropped together (dropQueued).
   */
  client(priority: FetchPriority, group: object | null = null): GcClient {
    if (group === null) return this.clients[priority];
    const options: GcClientOptions = {
      baseUrl: this.baseUrl,
      fetch: (url, init) => this.budget.fetchFor(this.baseUrl, priority, group)(url, init),
      now: () => this.clock.now(),
    };
    const made = createGcClient(options);
    // baseUrl came out of createGcClient in create(), so this cannot fail; if
    // it ever did, every call reports why instead of throwing.
    return made.ok ? made.value : { baseUrl: this.baseUrl, call: () => Promise.resolve(made) };
  }

  /** Drops the group's queued requests (they reject as cancelled and are never sent). Starts nothing. Returns how many. */
  dropQueued(group: object): number {
    return this.budget.dropQueued(group);
  }

  addListener(l: EndpointListener): void {
    this.listeners.add(l);
  }

  /** Removes a listener; returns how many remain. */
  removeListener(l: EndpointListener): number {
    this.listeners.delete(l);
    return this.listeners.size;
  }

  connection(): Connection {
    if (this.backoff) return { kind: "backing-off", attempt: this.backoff.attempt, retryAt: this.backoff.retryAt, cause: this.backoff.cause };
    return this.connected ? { kind: "connected" } : { kind: "connecting" };
  }

  /** Whether reads are open at `now`, without claiming the probe: "open", "probe" (one is due; token 0) or "wait". */
  peekGate(now: number): Gate {
    if (!this.backoff) return { kind: "open" };
    if (this.probe && now < this.probe.until) return { kind: "wait", until: this.probe.until };
    if (now < this.backoff.retryAt) return { kind: "wait", until: this.backoff.retryAt };
    return { kind: "probe", token: 0 };
  }

  /**
   * Whether a store may read at `now`. While backing off, the first store to
   * ask after the retry time gets "probe" and must call endProbe(token) when
   * its one read is done; the others wait for the probe's outcome or its
   * deadline.
   */
  gate(now: number): Gate {
    const g = this.peekGate(now);
    if (g.kind !== "probe") return g;
    this.probe = { token: ++this.probeTokens, until: now + PROBE_DEADLINE_MS };
    return { kind: "probe", token: this.probe.token };
  }

  /** Ends the probe granted with `token`; a stale token (an expired probe) is ignored. */
  endProbe(token: number): void {
    if (this.probe?.token === token) this.probe = null;
  }

  /** gc answered a read (any answer that does not back off). */
  succeeded(): void {
    const recovered = this.backoff !== null;
    const changed = recovered || !this.connected;
    this.backoff = null;
    this.probe = null;
    this.connected = true;
    if (recovered) this.budget.setDegraded(this.baseUrl, false);
    if (changed) this.notify(recovered);
  }

  /** A read failed in a way that backs off (backoff.ts backsOff): back off (again). */
  failed(cause: GcError): void {
    this.backoff = failBackoff(this.backoff, this.clock.now(), cause, this.random);
    this.budget.setDegraded(this.baseUrl, true);
    this.notify(false);
  }

  /** "Retry now": the next read is due at once. */
  retryNow(): void {
    if (!this.backoff) return;
    this.backoff = retryBackoffNow(this.backoff, this.clock.now());
    this.notify(false);
  }

  /** Forgets the endpoint in the budget when the last user goes (from a copy's close: starts nothing). */
  dispose(): void {
    this.budget.forgetEndpoint(this.baseUrl);
  }

  private notify(recovered: boolean): void {
    for (const l of [...this.listeners]) l.endpointChanged(recovered);
  }
}
