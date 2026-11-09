// One copy of the mod: its city machine (discovery), its subscriptions to
// the shared sync registry, and its UI state. main.ts is the thin View
// around it.
//
// herdr's ownership rule decides the shape. Every async host operation
// belongs to the copy whose code starts it and never settles once that copy
// closes, so:
//   - discovery runs in a task of this copy (init, or a "retry now" click);
//   - everything shared (the city list poll, the city store's steps, the
//     probe write) starts only from this copy's own periodic timer: `tick`;
//   - the city list and the city store are subscribed from a tick as soon as
//     the API and a running city are known, and unsubscribed when they
//     change;
//   - `close` only unsubscribes: it starts nothing, and work this copy had
//     started is abandoned to the next tick of a surviving copy.
// Rendering reads `view`, which builds the view-models from the machine and
// the shared snapshots; it never fetches.

import type { CityScopedError } from "./discovery/city.ts";
import { selectedCity } from "./discovery/city.ts";
import type { DiscoveryController, DiscoveryTask } from "./discovery/controller.ts";
import type { GcError } from "./gc/errors.ts";
import type { HostDecodeError } from "./host.schemas.ts";
import type { ProbeWriter } from "./probe.ts";
import type { Result } from "./result.ts";
import type { Clock } from "./sync/clock.ts";
import type { CitiesSubscription, Subscription, SyncRegistry } from "./sync/registry.ts";
import { ALL_DOMAINS } from "./sync/invalidate.ts";
import { mayBeOnScreen, type VisibilityInput } from "./sync/visibility.ts";
import { MOD_VERSION } from "./version.ts";
import { agentsModel, type AgentsModel } from "./vm/agents.ts";
import { beadDetailModel, boardModel, type BeadDetailModel, type BoardModel } from "./vm/board.ts";
import { detailModel, type DetailModel } from "./vm/detail.ts";
import { diagnosticsModel, type DiagnosticLine } from "./vm/diagnostics.ts";
import { headerModel, type HeaderModel } from "./vm/header.ts";
import { probeDocument, type ExecRecord } from "./vm/probe.ts";

/** What a copy reads from herdr, besides discovery's host (host.ts). */
export interface CopyHost {
  visibility(): Result<VisibilityInput, HostDecodeError>;
  probeEnabled(): boolean;
  herdrVersion(): string | null;
  execLog(): readonly ExecRecord[];
}

export interface CopyDeps {
  registry: SyncRegistry;
  discovery: DiscoveryController;
  host: CopyHost;
  clock: Clock;
  probe: ProbeWriter;
}

/** Everything render draws for one copy. */
export interface CopyView {
  header: HeaderModel;
  /** Null until a running city is subscribed. */
  agents: AgentsModel | null;
  /** Null until a running city is subscribed. */
  board: BoardModel | null;
  beadDetail: BeadDetailModel;
  detail: DetailModel;
  diagnostics: DiagnosticLine[];
  diagnosticsOpen: boolean;
  refreshCount: number;
  onScreen: boolean;
}

const CITY_SCOPED: ReadonlySet<GcError["kind"]> = new Set(["city-not-running", "write-grant-required", "read-grant-required", "read-only", "api-missing"]);

function isCityScoped(e: GcError | null): e is CityScopedError {
  return e !== null && CITY_SCOPED.has(e.kind);
}

/** The host errors a copy keeps for its banners. */
const HOST_ERROR_LIMIT = 20;

/** One copy of the mod. */
export class CopyController {
  private selected: string | null = null;
  private selectedBead: string | null = null;
  private readonly collapsed = new Set<string>();
  private diagnosticsOpen = false;
  private refreshCount = 0;
  private onScreen = true;
  private cities: CitiesSubscription | null = null;
  private citiesRev = -1;
  private city: Subscription | null = null;
  private peek: { id: string; release: () => void } | null = null;
  private beadWatch: { id: string; release: () => void } | null = null;
  private signature = "";
  private closed = false;
  /** City-scoped errors already fed to the machine (each failure is a new object). */
  private applied = new WeakSet<object>();

  constructor(private readonly deps: CopyDeps) {}

  /** Discovers gc's API and the cities; run it in a task of this copy (init). */
  discover(task: DiscoveryTask): Promise<void> {
    return this.deps.discovery.run(task);
  }

  /**
   * This copy's periodic timer (every TICK_MS) and nothing else calls this:
   * subscribes and unsubscribes as the machine says, ticks the shared city
   * list and city store, and writes the probe. Returns true when the view
   * should be redrawn.
   */
  tick(): boolean {
    if (this.closed) return false;
    const { registry, discovery, clock } = this.deps;
    this.readVisibility();
    registry.setOnScreen(this.onScreen);

    const before = discovery.machine.state;
    this.followCities("endpoint" in before ? before.endpoint.url : null, before.phase !== "city-running");
    // The city list may just have moved the machine.
    const state = discovery.machine.state;
    const endpoint = "endpoint" in state ? state.endpoint : null;
    const running = state.phase === "city-running" && endpoint !== null ? state.city.name : null;
    this.followCity(endpoint !== null && running !== null ? { apiUrl: endpoint.url, city: running } : null);
    this.followDetail();
    this.followBead();

    const s = this.city?.snapshot();
    if (s && running !== null) {
      for (const slot of [s.rigs, s.agents, s.sessions, s.pending, s.events]) {
        const error = slot.error;
        if (!isCityScoped(error) || this.applied.has(error)) continue;
        this.applied.add(error);
        discovery.apply({ type: "city-error", city: running, error });
      }
      // The city went away: drop the subscription now rather than at the next tick.
      if (discovery.machine.state.phase !== "city-running") this.followCity(null);
    }

    if (this.deps.host.probeEnabled()) this.writeProbe(clock.now());

    const signature = [
      this.machineVersion(), this.citiesRev, this.city?.snapshot().rev ?? -1, this.onScreen, this.selected, this.selectedBead,
    ].join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    return true;
  }

  /** The copy closes: unsubscribe everything. Starts nothing. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peek?.release();
    this.peek = null;
    this.beadWatch?.release();
    this.beadWatch = null;
    this.city?.unsubscribe();
    this.city = null;
    this.cities?.unsubscribe();
    this.cities = null;
  }

  /** The view-models for render (and the probe). */
  view(now: number): CopyView {
    const { discovery } = this.deps;
    const s = this.city?.snapshot() ?? null;
    const agents = s ? agentsModel({ snapshot: s, now, selected: this.selected, collapsed: this.collapsed }) : null;
    const board = s ? boardModel({ snapshot: s, now, selected: this.selectedBead }) : null;
    const live = s && agents ? { connection: s.connection, now, needsYou: agents.needsYou, age: agents.region.age } : null;
    const citiesError = this.cities?.snapshot().error;
    return {
      header: headerModel(discovery.machine, discovery.hostErrors, live),
      agents,
      board,
      beadDetail: s ? beadDetailModel({ snapshot: s, now, selected: this.selectedBead }) : { kind: "none" },
      detail: s ? detailModel({ snapshot: s, now, selected: this.selected }) : { kind: "none" },
      diagnostics: diagnosticsModel({
        entries: [
          ...(s?.errors ?? []),
          ...(citiesError ? [{ at: this.cities?.snapshot().fetchedAt ?? now, source: "cities", error: citiesError }] : []),
          ...this.deps.probe.errors(),
        ],
        drift: [...(agents?.drift ?? []), ...(board?.drift ?? [])],
        unreadable: [...(agents?.unreadable.map((u) => u.text) ?? []), ...(board?.unreadable ?? [])],
      }),
      diagnosticsOpen: this.diagnosticsOpen,
      refreshCount: this.refreshCount,
      onScreen: this.onScreen,
    };
  }

  // ---- actions (buttons; later also keys and commands) -------------------------

  /**
   * "Retry now". With a running city: refetch everything now, including held
   * data, a backing-off endpoint's probe and the open detail, keeping what is
   * shown meanwhile. Without one: rediscover gc's API and the cities.
   */
  retry(task: DiscoveryTask): Promise<void> {
    this.refreshCount++;
    this.cities?.refresh();
    if (this.city) {
      this.city.retryNow();
      this.city.refresh(ALL_DOMAINS);
      if (this.selected !== null) this.city.refreshDetail(this.selected);
      return Promise.resolve();
    }
    return this.discover(task);
  }

  /** The person chose a city (unpinned copies). */
  selectCity(city: string): void {
    this.deps.discovery.select(city);
  }

  /** Opens (or, with null, closes) the detail of a session. */
  selectSession(id: string | null): void {
    this.selected = id;
    this.followDetail();
  }

  /** Opens (or, with null, closes) the detail of a bead on the board. */
  selectBead(id: string | null): void {
    this.selectedBead = id;
    this.followBead();
  }

  /** Collapses or expands a rig group. */
  toggleGroup(key: string): void {
    if (!this.collapsed.delete(key)) this.collapsed.add(key);
  }

  toggleDiagnostics(): void {
    this.diagnosticsOpen = !this.diagnosticsOpen;
  }

  // ---- subscriptions --------------------------------------------------------------

  private readVisibility(): void {
    const v = this.deps.host.visibility();
    if (v.ok) {
      this.onScreen = mayBeOnScreen(v.value);
      return;
    }
    // herdr's data cannot be read: say so, and poll as if on screen (the conservative side).
    this.onScreen = true;
    this.hostError(v.error);
  }

  private hostError(error: GcError): void {
    const errors = this.deps.discovery.hostErrors;
    const text = JSON.stringify(error);
    if (errors.some((e) => JSON.stringify(e) === text)) return;
    this.deps.discovery.hostErrors = [...errors, error].slice(-HOST_ERROR_LIMIT);
  }

  private followCities(apiUrl: string | null, fast: boolean): void {
    if (this.cities && this.cities.apiUrl !== apiUrl) {
      this.cities.unsubscribe();
      this.cities = null;
    }
    if (!this.cities && apiUrl !== null) {
      const made = this.deps.registry.subscribeCities(apiUrl);
      if (!made.ok) {
        this.hostError(made.error);
        return;
      }
      this.cities = made.value;
      this.citiesRev = -1;
    }
    if (!this.cities) return;
    const rev = this.cities.tick(fast);
    if (rev === this.citiesRev) return;
    this.citiesRev = rev;
    const value = this.cities.snapshot().value;
    // Only answers move the machine: a failed poll is shown in the diagnostics and the
    // city store's connection, and must not throw away the city this copy shows.
    if (value !== null) this.deps.discovery.apply({ type: "cities", result: { ok: true, value } });
  }

  private followCity(key: { apiUrl: string; city: string } | null): void {
    const cur = this.city;
    if (cur && (key === null || cur.key.city !== key.city || cur.key.apiUrl !== key.apiUrl)) {
      this.peek?.release();
      this.peek = null;
      this.beadWatch?.release();
      this.beadWatch = null;
      cur.unsubscribe();
      this.city = null;
    }
    if (!this.city && key !== null) {
      const made = this.deps.registry.subscribe(key);
      if (!made.ok) {
        this.hostError(made.error);
        return;
      }
      this.city = made.value;
      this.applied = new WeakSet();
    }
    this.city?.tick();
  }

  private followDetail(): void {
    const want = this.city !== null ? this.selected : null;
    if (this.peek && this.peek.id !== want) {
      this.peek.release();
      this.peek = null;
    }
    if (!this.peek && want !== null && this.city) this.peek = { id: want, release: this.city.watchPeek(want) };
  }

  private followBead(): void {
    const want = this.city !== null ? this.selectedBead : null;
    if (this.beadWatch && this.beadWatch.id !== want) {
      this.beadWatch.release();
      this.beadWatch = null;
    }
    if (!this.beadWatch && want !== null && this.city) this.beadWatch = { id: want, release: this.city.watchBead(want) };
  }

  private machineVersion(): string {
    const m = this.deps.discovery.machine;
    return `${m.state.phase}:${selectedCity(m.state) ?? ""}:${machineIds.get(m) ?? remember(m)}:${this.deps.discovery.hostErrors.length}`;
  }

  private writeProbe(now: number): void {
    const v = this.view(now);
    this.deps.probe.offer(probeDocument({
      modVersion: MOD_VERSION,
      herdrVersion: this.deps.host.herdrVersion(),
      machine: this.deps.discovery.machine,
      header: v.header,
      onScreen: this.onScreen,
      keyboard: false,
      agents: v.agents,
      board: v.board,
      beadDetail: v.beadDetail,
      detail: v.detail,
      diagnostics: v.diagnostics,
      execLog: this.deps.host.execLog(),
      refreshCount: this.refreshCount,
      fetchInFlightMax: this.deps.registry.budgetStats().maxInFlight,
    }), now, true);
  }
}

/** A stable number per machine object, so a new machine (any discovery step) redraws. */
const machineIds = new WeakMap<object, number>();
let machineSeq = 0;
function remember(m: object): number {
  const id = ++machineSeq;
  machineIds.set(m, id);
  return id;
}
