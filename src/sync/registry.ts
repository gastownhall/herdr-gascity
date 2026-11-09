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
// How a copy uses it (src/copy.ts):
//
//   init(props, cx): a periodic timer of this copy (herdr's cx.timer.every,
//     TICK_MS); discovery's fetches go through `probeFetch()`;
//   each tick, in the copy's own turn: subscribeCities(apiUrl) once the API
//     is known and tick it; subscribe({ apiUrl, city }) once a running city is
//     chosen and tick it; setOnScreen(mayBeOnScreen(…)); notify on a new rev;
//   render: reads the snapshots only;
//   close: unsubscribe() both — it starts nothing.
//
// App-wide side effects (toasts) register once with `onEvents`, not per copy.
// The visibility rule (visibility.ts) is per app: `setOnScreen` applies to
// every store at their next tick.

import type { ActionSpec, ActivitySnapshot } from "../actions/activity.ts";
import { ActionLedger, newIdempotencyKey } from "../actions/outcome.ts";
import type { GcClient, HostFetch } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { err, ok, type Result } from "../result.ts";
import { FetchBudget, type BudgetStats } from "./budget.ts";
import { systemClock, type Clock } from "./clock.ts";
import { Endpoint, type EndpointListener } from "./endpoint.ts";
import type { Domain } from "./invalidate.ts";
import { CitiesPoller, type CitiesSnapshot } from "./cities.ts";
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
  /** A fresh Idempotency-Key per action; default a random UUID. */
  newKey?: () => string;
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
  /** Watches a session's detail (output, wake reasons, pending prompt); returns the release. Released on unsubscribe too. */
  watchPeek(sessionId: string): () => void;
  /** Watches a bead (an open bead detail): fetched by id, and again on an event about it; returns the release. Released on unsubscribe too. */
  watchBead(beadId: string): () => void;
  /** Refetches a watched session's output, wake reasons and pending prompt at the next tick. */
  refreshDetail(sessionId: string): void;
  /** "Retry now": re-arms held domains and makes a backing-off endpoint's probe due. */
  retryNow(): void;
  /** Refetches these domains at the next tick (e.g. after a mutation whose outcome is unknown). */
  refresh(domains: readonly Domain[]): void;
  /**
   * A client for this city's endpoint whose requests pass the app-wide budget
   * at mutation priority (ahead of every queued read). It never retries.
   */
  client(): GcClient;
  /**
   * Sends a person's action now, in this copy's turn (call it from a click,
   * key or command of this copy), and follows its outcome from this copy's
   * ticks. Returns the action's id in the city's activity log. If this copy
   * closes before the outcome is known, the action becomes unknown.
   */
  act(spec: ActionSpec): number;
  /** The person retries an action (see outcome.ts retryGate); in this copy's turn. */
  retryAction(id: number): Result<number, string>;
  /** Refetches what an action changed ("refresh before retry"). */
  refreshAction(id: number): void;
  /** The city's activity log, shared by every copy of the city. */
  activity(): ActivitySnapshot;
  /** Ends the subscription (the copy's close). Starts no work. Idempotent. */
  unsubscribe(): void;
}

/** One copy's subscription to an API's shared city list. */
export interface CitiesSubscription {
  readonly apiUrl: string;
  snapshot(): CitiesSnapshot;
  /** Call from this copy's own periodic timer; `fast` while this copy shows no running city. Returns the snapshot's rev. */
  tick(fast: boolean): number;
  /** Polls at the next tick. */
  refresh(): void;
  /** Ends the subscription (the copy's close). Starts no work. Idempotent. */
  unsubscribe(): void;
}

/** A fetch through the app-wide budget whose queued requests can be dropped together (discovery's requests). */
export interface ProbeFetch {
  fetch: HostFetch;
  /** Drops this fetch's queued requests (they reject as cancelled); one already sent stays in flight until herdr settles it. Returns how many. */
  drop(): number;
  /** Resolves when this fetch's first request leaves the queue (is sent). */
  sent: Promise<void>;
}

/** "scheme://host[:port]" of a URL: the budget's endpoint key. */
function originOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? url;
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
  private readonly stores = new Map<string, { store: CityStore; ledger: ActionLedger; subs: number }>();
  private readonly pollers = new Map<string, { poller: CitiesPoller; subs: number }>();
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
          if (batch.citiesChanged) this.pollers.get(endpoint.value.baseUrl)?.poller.refresh();
          for (const l of [...this.listeners]) l(batch);
        },
        onError: (k, e) => this.deps.onError?.(k, e),
      });
      const ep = endpoint.value;
      const ledger = new ActionLedger({
        city: key.city,
        clock: this.clock,
        client: (priority, group) => ep.client(priority, group),
        dropQueued: (group) => ep.dropQueued(group),
        refresh: (domains) => store.refresh(domains),
        refreshDetail: (sessionId) => store.refreshDetail(sessionId),
        refreshBead: (beadId) => store.refreshBead(beadId),
        newKey: this.deps.newKey ?? (() => newIdempotencyKey()),
      });
      entry = { store, ledger, subs: 0 };
      this.stores.set(id, entry);
    }
    entry.subs++;
    return ok(this.subscription(id, entry.store, entry.ledger, endpoint.value));
  }

  /** Subscribes a copy to a loopback gc API's shared city list; `not-loopback` otherwise. */
  subscribeCities(apiUrl: string): Result<CitiesSubscription, GcError> {
    const endpoint = this.endpointFor(apiUrl);
    if (!endpoint.ok) return endpoint;
    const ep = endpoint.value;
    let entry = this.pollers.get(ep.baseUrl);
    if (!entry) {
      entry = { poller: new CitiesPoller(ep, this.clock), subs: 0 };
      this.pollers.set(ep.baseUrl, entry);
    }
    entry.subs++;
    const { poller } = entry;
    const owner = {};
    let active = true;
    return ok({
      apiUrl: ep.baseUrl,
      snapshot: () => poller.snapshot(),
      tick: (fast) => {
        if (active) {
          this.budget.reclaim();
          poller.tick(owner, fast);
        }
        return poller.snapshot().rev;
      },
      refresh: () => {
        if (active) poller.refresh();
      },
      unsubscribe: () => {
        if (!active) return;
        active = false;
        poller.abandonStartedBy(owner);
        const e = this.pollers.get(ep.baseUrl);
        if (e && --e.subs <= 0) {
          this.pollers.delete(ep.baseUrl);
          poller.dispose();
          this.releaseEndpoint(ep, poller);
        }
      },
    });
  }

  /**
   * A fetch for discovery's probes (/health, /v0/cities) through the app-wide
   * budget, at snapshot priority, so discovery never adds a third request in
   * flight. A probe that lost its race stays counted until herdr settles it.
   */
  probeFetch(): ProbeFetch {
    const group = {};
    let markSent!: () => void;
    const sent = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    return {
      fetch: (url, init) => this.budget.fetchFor(originOf(url), "snapshot", group, markSent)(url, init),
      drop: () => this.budget.dropQueued(group),
      sent,
    };
  }

  /**
   * Frees fetch slots herdr can no longer settle (their copy closed) and
   * starts what fits; call from a copy's own tick, so a queued request
   * (discovery's) starts in a live copy's turn even with no city subscribed.
   */
  reclaim(): void {
    this.budget.reclaim();
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

  /** Drops an endpoint once its last store or poller has gone (from a close: starts nothing). */
  private releaseEndpoint(endpoint: Endpoint, user: EndpointListener): void {
    if (endpoint.removeListener(user) > 0) return;
    endpoint.dispose();
    this.endpoints.delete(endpoint.baseUrl);
  }

  private subscription(id: string, store: CityStore, ledger: ActionLedger, endpoint: Endpoint): Subscription {
    const owner = {};
    const watches = new Set<() => void>();
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      for (const release of [...watches]) release();
      watches.clear();
      ledger.ownerGone(owner);
      store.abandonStartedBy(owner);
      const entry = this.stores.get(id);
      if (entry && --entry.subs <= 0) {
        this.stores.delete(id);
        ledger.dispose();
        store.dispose();
        this.releaseEndpoint(endpoint, store);
      }
    };
    /** Tracks a store watch so the unsubscribe releases it. */
    const watch = (release: () => void) => {
      const once = () => {
        watches.delete(once);
        release();
      };
      watches.add(once);
      return once;
    };
    return {
      key: store.key,
      snapshot: () => store.snapshot(),
      tick: () => {
        if (active) {
          this.budget.reclaim();
          store.tick(owner);
          ledger.tick(owner);
        }
        return store.snapshot().rev;
      },
      watchPeek: (sessionId) => (active ? watch(store.watchPeek(sessionId)) : () => {}),
      watchBead: (beadId) => (active ? watch(store.watchBead(beadId)) : () => {}),
      refreshDetail: (sessionId) => {
        if (active) store.refreshDetail(sessionId);
      },
      retryNow: () => {
        if (active) store.retryNow();
      },
      refresh: (domains) => {
        if (active) store.refresh(domains);
      },
      client: () => endpoint.client("mutation"),
      act: (spec) => (active ? ledger.start(owner, spec) : -1),
      retryAction: (actionId) => (active ? ledger.retry(owner, actionId, store.snapshot()) : err("this view has closed")),
      refreshAction: (actionId) => {
        if (active) ledger.refreshFor(actionId);
      },
      activity: () => ledger.snapshot(),
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
