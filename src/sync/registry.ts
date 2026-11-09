// The module-level registry of shared city stores.
//
// herdr runs a mod's module code once and shares it by every copy; each copy
// has its own instance and tasks. So the registry keeps one CityStore per
// (API URL, city) and one Endpoint per API URL for the whole app, and copies
// subscribe to them. Several copies of the same city add no gc load.
//
// herdr gives every async host operation (fetch, cx.sleep, cx.timer) to the
// copy whose code is running when it starts, and never settles it once that
// copy closes. So nothing here sleeps or resumes another copy's work: each
// subscribed copy drives its store by calling `tick()` from a periodic timer
// it creates in its own init, and a step starts only inside such a tick.
//
// How a copy uses it (main.ts, in a later change):
//
//   init(props, cx):
//     this.sub = registry.subscribe({ apiUrl, city });   // a Result
//     this.rev = this.sub.tick();                        // first step, in this copy's turn
//     a periodic timer of this copy (herdr's cx.timer.every, TICK_MS, with a
//     handler):  const rev = this.sub.tick(); if (rev !== this.rev) { this.rev = rev; cx.notify(); }
//   render: reads this.sub.snapshot() only, and may call
//     registry.setOnScreen(mayBeOnScreen(…));
//   close: this.sub.unsubscribe() — it starts nothing.
//
// App-wide side effects (toasts) register once with `onEvents`, not per copy.
// The visibility rule (visibility.ts) is per app: `setOnScreen` applies to
// every store at their next tick.

import type { GcClient, HostFetch } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { err, ok, type Result } from "../result.ts";
import { FetchBudget, type BudgetStats } from "./budget.ts";
import { systemClock, type Clock } from "./clock.ts";
import { Endpoint } from "./endpoint.ts";
import type { Domain } from "./invalidate.ts";
import { CityStore, type CityKey, type CitySnapshot, type ErrorEntry, type EventBatch } from "./store.ts";

/** How often each copy should call `tick()`: the granularity of the 300 ms debounce and of "retry now". */
export const TICK_MS = 250;

/** What the registry is built from; tests inject fakes. */
export interface SyncDeps {
  /** herdr's global fetch (through host.ts). */
  fetch: HostFetch;
  clock?: Clock;
  /** [0, 1) for backoff jitter; default Math.random. */
  random?: () => number;
  /** Every failure a store records, for the app log; the store also keeps them in its snapshot. */
  onError?: (key: CityKey, entry: ErrorEntry) => void;
}

/** One copy's subscription to one city store. */
export interface Subscription {
  readonly key: CityKey;
  /** The store's current snapshot (shared by every copy of the city). */
  snapshot(): CitySnapshot;
  /**
   * Call from this copy's own periodic timer (every TICK_MS) and once in
   * init: runs the store's next step if one is due. Returns the snapshot's
   * rev, so the copy can notify when it changed.
   */
  tick(): number;
  /** Watches a session's output (an open detail pane); returns the release. Released on unsubscribe too. */
  watchPeek(sessionId: string): () => void;
  /** "Retry now": re-arms held domains and makes a backing-off endpoint's probe due. */
  retryNow(): void;
  /** Refetches these domains at the next tick (e.g. after a mutation whose outcome is unknown). */
  refresh(domains: readonly Domain[]): void;
  /**
   * A client for this city's endpoint whose requests pass the app-wide budget
   * at mutation priority (ahead of every queued read). It never retries.
   */
  client(): GcClient;
  /** Ends the subscription (the copy's close). Starts no work. Idempotent. */
  unsubscribe(): void;
}

function storeId(apiUrl: string, city: string): string {
  return `${apiUrl}\u0000${city}`;
}

/** The app's shared city stores. */
export class SyncRegistry {
  private readonly budget: FetchBudget;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly stores = new Map<string, { store: CityStore; subs: number }>();
  private readonly listeners = new Set<(batch: EventBatch) => void>();
  private onScreen = false;

  constructor(private readonly deps: SyncDeps) {
    this.clock = deps.clock ?? systemClock;
    this.budget = new FetchBudget(deps.fetch, this.clock);
    this.random = deps.random ?? Math.random;
  }

  /** Subscribes a copy to a city on a loopback gc API; `not-loopback` otherwise. */
  subscribe(key: CityKey): Result<Subscription, GcError> {
    const endpoint = this.endpointFor(key.apiUrl);
    if (!endpoint.ok) return endpoint;
    const id = storeId(endpoint.value.baseUrl, key.city);
    let entry = this.stores.get(id);
    if (!entry) {
      const store = new CityStore({ apiUrl: endpoint.value.baseUrl, city: key.city }, {
        endpoint: endpoint.value,
        clock: this.clock,
        onScreen: this.onScreen,
        emit: (batch) => {
          for (const l of [...this.listeners]) l(batch);
        },
        onError: (k, e) => this.deps.onError?.(k, e),
      });
      entry = { store, subs: 0 };
      this.stores.set(id, entry);
    }
    entry.subs++;
    return ok(this.subscription(id, entry.store, endpoint.value));
  }

  /** Sets the app-wide "a gascity view may be on screen" (visibility.ts) for every store. */
  setOnScreen(onScreen: boolean): void {
    this.onScreen = onScreen;
    for (const { store } of this.stores.values()) store.setOnScreen(onScreen);
  }

  /** Registers an app-wide listener for new events of every store; returns the removal. */
  onEvents(listener: (batch: EventBatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Live stores. */
  storeCount(): number {
    return this.stores.size;
  }

  /** The fetch budget's counters. */
  budgetStats(): BudgetStats {
    return this.budget.stats();
  }

  private endpointFor(apiUrl: string): Result<Endpoint, GcError> {
    const made = Endpoint.create(apiUrl, this.budget, this.clock, this.random);
    if (!made.ok) return err(made.error);
    const existing = this.endpoints.get(made.value.baseUrl);
    if (existing) return ok(existing);
    this.endpoints.set(made.value.baseUrl, made.value);
    return made;
  }

  private subscription(id: string, store: CityStore, endpoint: Endpoint): Subscription {
    const owner = {};
    const peeks = new Set<() => void>();
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      for (const release of [...peeks]) release();
      peeks.clear();
      store.abandonStartedBy(owner);
      const entry = this.stores.get(id);
      if (entry && --entry.subs <= 0) {
        this.stores.delete(id);
        store.dispose();
        if (endpoint.removeListener(store) === 0) {
          endpoint.dispose();
          this.endpoints.delete(endpoint.baseUrl);
        }
      }
    };
    return {
      key: store.key,
      snapshot: () => store.snapshot(),
      tick: () => {
        if (active) {
          this.budget.reclaim();
          store.tick(owner);
        }
        return store.snapshot().rev;
      },
      watchPeek: (sessionId) => {
        if (!active) return () => {};
        const release = store.watchPeek(sessionId);
        const once = () => {
          peeks.delete(once);
          release();
        };
        peeks.add(once);
        return once;
      },
      retryNow: () => {
        if (active) store.retryNow();
      },
      refresh: (domains) => {
        if (active) store.refresh(domains);
      },
      client: () => endpoint.client("mutation"),
      unsubscribe,
    };
  }
}

let shared: SyncRegistry | null = null;

/**
 * The app's registry, created on first use. It lives in module scope, so all
 * copies share it, and a mod reload (which re-runs the module) starts a new one.
 */
export function sharedRegistry(create: () => SyncRegistry): SyncRegistry {
  shared ??= create();
  return shared;
}
