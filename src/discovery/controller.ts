// Drives one copy's city machine: resolves the endpoint, lists the cities,
// applies the person's city choice. It holds the machine but never a gpui
// context: each run gets `notify` and `sleep` from the task it runs in.
// Periodic /v0/cities refresh belongs to the shared sync store; it feeds the
// machine through `apply`.
//
// herdr may resume a run in another copy's turn (a fetch settles in the turn
// that started it), so a run that outlived its copy, or was superseded, must
// start nothing more: `cancel` (from the copy's close, or a newer run) drops
// the run's queued requests and from then on every host call of that run
// returns at once without running gc, reading a file or sending a request.

import { err, type Result } from "../result.ts";
import { createGcClient, type HostFetch } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { listCities } from "../gc/ops.ts";
import { initialMachine, step, type CityEvent, type CityMachine, type CopyContext } from "./city.ts";
import { GC_STATUS_ARGS } from "./gcStatus.ts";
import { resolveEndpoint, type ResolveHost } from "./resolve.ts";

/** What the controller needs from the host, besides the task's sleep. */
export interface DiscoveryHost extends Omit<ResolveHost, "sleep"> {
  /** Persists an unpinned copy's chosen city. */
  rememberCity(city: string): Result<null, GcError>;
}

/** The task a run belongs to. */
export interface DiscoveryTask {
  notify(): void;
  sleep(ms: number): Promise<void>;
}

type ProbeFetch = ReturnType<ResolveHost["probeFetch"]>;

/** The longest list of host errors kept for the panel. */
const HOST_ERROR_LIMIT = 20;

/** Why a cancelled run's host call did not run. */
const NOT_RUN = "not run: this discovery was cancelled";

/** A rejection the gc client reads as a request the mod dropped before sending it. */
function droppedRejection(url: string): Error {
  return Object.assign(new Error(`gascity: request to ${url} not sent: this discovery was cancelled`), { hostElapsedMs: 0, cancelled: "abandoned" });
}

export class DiscoveryController {
  machine: CityMachine;
  /** Host calls that failed outside the machine (e.g. remembering the city); shown, newest last. */
  hostErrors: GcError[] = [];
  /** How many host calls of runs have settled so far: a run whose count stops moving has stalled. */
  progress = 0;
  private generation = 0;
  private active = false;
  /** The current run's budgeted fetches, so their queued requests can be dropped. */
  private fetches = new Set<ProbeFetch>();

  constructor(private readonly host: DiscoveryHost, copy: CopyContext) {
    this.machine = initialMachine(copy);
  }

  /** Applies one event. */
  apply(event: CityEvent): void {
    this.machine = step(this.machine, event);
  }

  /** Whether a run is under way (and not cancelled or superseded). */
  running(): boolean {
    return this.active;
  }

  /**
   * Ends the current run: its queued requests are dropped (never sent) and its
   * later host calls start nothing. Starts nothing (it runs from a copy's close).
   */
  cancel(): void {
    this.generation++;
    this.active = false;
    for (const f of this.fetches) f.drop();
    this.fetches = new Set();
  }

  /**
   * Discovers from scratch: endpoint, then cities. A newer run supersedes an
   * older one; the older one's late results are not applied, since they
   * describe a discovery the person already replaced.
   */
  async run(task: DiscoveryTask): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const current = () => generation === this.generation;
    const host = this.guarded(current);
    this.active = true;
    try {
      this.apply({ type: "discover" });
      task.notify();

      const resolved = await resolveEndpoint({ ...host, sleep: (ms) => task.sleep(ms) });
      if (!current()) return;
      this.apply({ type: "resolved", result: resolved });
      task.notify();
      if (!resolved.ok) return;

      const client = createGcClient({ baseUrl: resolved.value.url, fetch: host.probeFetch().fetch });
      const cities = client.ok ? await listCities(client.value) : client;
      if (!current()) return;
      this.apply({ type: "cities", result: cities });
      task.notify();
    } finally {
      if (current()) {
        this.active = false;
        this.fetches = new Set();
      }
    }
  }

  /** The person chose a city; an unpinned copy remembers it. */
  select(city: string): void {
    const before = this.machine;
    this.apply({ type: "select", city });
    if (this.machine === before) return;
    const remembered = this.host.rememberCity(city);
    if (!remembered.ok) this.hostErrors = [...this.hostErrors, remembered.error].slice(-HOST_ERROR_LIMIT);
  }

  /** The host as one run sees it: nothing starts once the run is no longer current; every settled call is progress. */
  private guarded(current: () => boolean): Omit<ResolveHost, "sleep"> {
    const settled = <T>(p: Promise<T>): Promise<T> => p.finally(() => {
      if (current()) this.progress++;
    });
    return {
      settings: () => this.host.settings(),
      gcStatus: (gcBin) => (current()
        ? settled(this.host.gcStatus(gcBin))
        : Promise.resolve(err({ kind: "exec", argv: [gcBin, ...GC_STATUS_ARGS], code: null, stderr: NOT_RUN }))),
      readSupervisorConfig: () => (current()
        ? settled(this.host.readSupervisorConfig())
        : Promise.resolve(err({ kind: "host-call", api: "readTextFile(supervisor.toml)", cause: NOT_RUN }))),
      fetch: this.host.fetch,
      probeFetch: () => {
        const pf = this.host.probeFetch();
        if (current()) this.fetches.add(pf);
        const fetch: HostFetch = (url, init) => (current() ? settled(pf.fetch(url, init)) : Promise.reject(droppedRejection(url)));
        return { fetch, drop: () => pf.drop(), sent: settled(pf.sent) };
      },
    };
  }
}
