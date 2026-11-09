// Drives one copy's city machine: resolves the endpoint, lists the cities,
// applies the person's city choice. It holds the machine but never a gpui
// context: each run gets `notify` and `sleep` from the task it runs in.
// Periodic /v0/cities refresh belongs to the shared sync store; it feeds the
// machine through `apply`.

import type { Result } from "../result.ts";
import { createGcClient } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { listCities } from "../gc/ops.ts";
import { initialMachine, step, type CityEvent, type CityMachine, type CopyContext } from "./city.ts";
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

/** The longest list of host errors kept for the panel. */
const HOST_ERROR_LIMIT = 20;

export class DiscoveryController {
  machine: CityMachine;
  /** Host calls that failed outside the machine (e.g. remembering the city); shown, newest last. */
  hostErrors: GcError[] = [];
  private generation = 0;

  constructor(private readonly host: DiscoveryHost, copy: CopyContext) {
    this.machine = initialMachine(copy);
  }

  /** Applies one event. */
  apply(event: CityEvent): void {
    this.machine = step(this.machine, event);
  }

  /**
   * Discovers from scratch: endpoint, then cities. A newer run supersedes an
   * older one; the older one's late results are not applied, since they
   * describe a discovery the person already replaced.
   */
  async run(task: DiscoveryTask): Promise<void> {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.apply({ type: "discover" });
    task.notify();

    const resolved = await resolveEndpoint({ ...this.host, sleep: (ms) => task.sleep(ms) });
    if (!current()) return;
    this.apply({ type: "resolved", result: resolved });
    task.notify();
    if (!resolved.ok) return;

    const client = createGcClient({ baseUrl: resolved.value.url, fetch: this.host.fetch });
    const cities = client.ok ? await listCities(client.value) : client;
    if (!current()) return;
    this.apply({ type: "cities", result: cities });
    task.notify();
  }

  /** The person chose a city; an unpinned copy remembers it. */
  select(city: string): void {
    const before = this.machine;
    this.apply({ type: "select", city });
    if (this.machine === before) return;
    const remembered = this.host.rememberCity(city);
    if (!remembered.ok) this.hostErrors = [...this.hostErrors, remembered.error].slice(-HOST_ERROR_LIMIT);
  }
}
