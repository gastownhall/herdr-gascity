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
//
// Actions (buttons; keys and commands call the same methods) run in this
// copy's own turn: a click hands its spec to the city's shared ledger
// (actions/outcome.ts), which sends it now and follows its outcome from this
// copy's ticks. A destructive action asks first (the dialog), and an action
// already under way is not sent twice. Nothing is ever retried without the
// person asking. Session actions act on the open session, work actions on
// the open bead, each by the id gc sent, and only while gc still lists it.

import type { ActionSpec } from "./actions/activity.ts";
import { sessionKill, sessionMessage, sessionNew, sessionRespond, sessionSubmit } from "./actions/session.ts";
import { SLING_MAY_ROUTE_TWICE, beadClose, beadCreate, beadReopen, beadSling } from "./actions/work.ts";
import type { CityScopedError } from "./discovery/city.ts";
import { selectedCity } from "./discovery/city.ts";
import type { DiscoveryController, DiscoveryTask } from "./discovery/controller.ts";
import type { GcError } from "./gc/errors.ts";
import type { HostDecodeError } from "./host.schemas.ts";
import type { ProbeWriter } from "./probe.ts";
import type { Result } from "./result.ts";
import type { Clock } from "./sync/clock.ts";
import type { ErrorEntry, SyncError } from "./sync/store.ts";
import type { CitiesSubscription, Subscription, SyncRegistry } from "./sync/registry.ts";
import { ALL_DOMAINS } from "./sync/invalidate.ts";
import { mayBeOnScreen, type VisibilityInput } from "./sync/visibility.ts";
import { MOD_VERSION } from "./version.ts";
import { activityModel, isBusy, type ActivityModel } from "./vm/activity.ts";
import { agentsModel, type AgentsModel } from "./vm/agents.ts";
import { beadDetailModel, boardModel, type BeadDetailModel, type BoardModel } from "./vm/board.ts";
import { detailModel, type DetailModel } from "./vm/detail.ts";
import { diagnosticsModel, type DiagnosticLine } from "./vm/diagnostics.ts";
import { headerModel, type HeaderModel } from "./vm/header.ts";
import { probeDocument, type ExecRecord } from "./vm/probe.ts";
import { cleanLine } from "./vm/sanitize.ts";

/** What a copy reads from herdr, besides discovery's host (host.ts). */
export interface CopyHost {
  visibility(): Result<VisibilityInput, HostDecodeError>;
  probeEnabled(): boolean;
  /** herdr-app's version (null when it reports none), or why it could not be read. */
  herdrVersion(): Result<string | null, GcError>;
  execLog(): readonly ExecRecord[];
}

export interface CopyDeps {
  registry: SyncRegistry;
  discovery: DiscoveryController;
  host: CopyHost;
  clock: Clock;
  probe: ProbeWriter;
}

/** A question the copy asks before acting, or a form. */
export type DialogModel =
  /** One button per choice (kill offers a plain and a forced kill), each with what gc will do. */
  | { kind: "confirm"; question: string; choices: { label: string; detail: string }[] }
  /** One button per choice, all doing what `detail` says (sling: one per agent). */
  | { kind: "pick"; question: string; detail: string; choices: string[] }
  | { kind: "new-session"; agent: string }
  /** The new-bead form: the agents it may be slung to, the chosen one, and what creating it then does. */
  | { kind: "new-bead"; agents: string[]; slingTo: string | null; slingToIndex: number | null; note: string | null }
  /** Close the open bead, with a reason typed in the form. */
  | { kind: "close-bead"; question: string; detail: string };

/** The new-bead form's fields, as typed. */
export interface BeadForm {
  title: string;
  description: string;
  /** Blank, or a whole number. */
  priority: string;
  /** Comma-separated. */
  labels: string;
}

/** How a message is sent: as input (gc's submit, plain or interrupting the turn) or as a queued message. */
export type InputMode = "default" | "interrupt_now" | "message";

/** Everything render draws for one copy. */
export interface CopyView {
  header: HeaderModel;
  /** Null until a running city is subscribed. */
  agents: AgentsModel | null;
  /** Null until a running city is subscribed. */
  board: BoardModel | null;
  beadDetail: BeadDetailModel;
  detail: DetailModel;
  /** The city's activity log; null until a running city is subscribed. */
  activity: ActivityModel | null;
  dialog: DialogModel | null;
  /** Why the last action was not sent, if it was not. */
  notice: string | null;
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
/** The failures of a copy's own work (its ticks, its host reads) kept for the diagnostics. */
const COPY_ERROR_LIMIT = 20;

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

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
  /** The city the last subscription was to: a bead selected there means nothing in another city. */
  private lastCity: string | null = null;
  private peek: { id: string; release: () => void } | null = null;
  private beadWatch: { id: string; release: () => void } | null = null;
  private signature = "";
  private closed = false;
  /** Asking before sending one of `specs`; `pick` asks one question for all of them. */
  private confirming: { specs: ActionSpec[]; retryOf: number | null; pick: { question: string; detail: string; labels: string[] } | null } | null = null;
  private creating: { agent: string } | null = null;
  /** The new-bead form: the agents listed when it opened (gc's names), and the chosen one's index. */
  private beadForm: { agents: string[]; slingTo: number | null } | null = null;
  /** The close-bead form, for this bead (gc's id). */
  private closingBead: { id: string } | null = null;
  private notice: string | null = null;
  /** City-scoped errors already fed to the machine (each failure is a new object). */
  private applied = new WeakSet<object>();
  /** Failures of this copy's own work, oldest first (diagnostics). */
  private failures: ErrorEntry[] = [];

  constructor(private readonly deps: CopyDeps) {}

  /** Discovers gc's API and the cities; run it in a task of this copy (init). */
  discover(task: DiscoveryTask): Promise<void> {
    return this.deps.discovery.run(task);
  }

  /**
   * This copy's periodic timer (every TICK_MS) and nothing else calls this:
   * subscribes and unsubscribes as the machine says, ticks the shared city
   * list and city store, and writes the probe. Returns true when the view
   * should be redrawn. An exception inside is recorded in the diagnostics
   * (and the view redrawn to show it); the next tick starts over.
   */
  tick(): boolean {
    if (this.closed) return false;
    try {
      return this.step();
    } catch (cause) {
      this.recordFailure("tick", { kind: "tick-crashed", message: messageOf(cause) });
      return true;
    }
  }

  private step(): boolean {
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
      this.machineVersion(), this.citiesRev, this.city?.snapshot().rev ?? -1, this.city?.activity().rev ?? -1, this.onScreen, this.selected,
      this.selectedBead,
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
      activity: this.city ? activityModel(this.city.activity(), s, now) : null,
      dialog: this.dialog(),
      notice: this.notice,
      diagnostics: diagnosticsModel({
        entries: [
          ...(s?.errors ?? []),
          ...(citiesError ? [{ at: this.cities?.snapshot().fetchedAt ?? now, source: "cities", error: citiesError }] : []),
          ...this.deps.probe.errors(),
          ...this.failures,
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

  /**
   * The person asks for an action. A destructive one asks first; one already
   * under way is not sent again; otherwise it is sent now, in this copy's turn.
   */
  request(spec: ActionSpec): void {
    if (spec.confirm !== null) {
      this.ask({ specs: [spec], retryOf: null, pick: null });
      return;
    }
    this.send(spec);
  }

  /** Kill asks first, offering a plain and a forced kill. */
  requestKill(sessionId: string): void {
    this.ask({ specs: [sessionKill(sessionId, false), sessionKill(sessionId, true)], retryOf: null, pick: null });
  }

  /** The person confirmed the dialog with its `choice`-th action. */
  confirm(choice: number): void {
    const c = this.confirming;
    const spec = c?.specs[choice];
    this.confirming = null;
    if (!c || !spec) return;
    if (c.retryOf !== null) this.retryNow(c.retryOf);
    else this.send(spec);
  }

  /** Closes the dialog without acting. */
  cancelDialog(): void {
    this.clearDialogs();
  }

  /** Retries an action from the activity log (a destructive one asks again). */
  retryAction(id: number): void {
    const entry = this.city?.activity().entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.spec.confirm !== null) {
      this.ask({ specs: [entry.spec], retryOf: id, pick: null });
      return;
    }
    this.retryNow(id);
  }

  /** Refetches what an action changed, so its state can be checked before a retry. */
  refreshAction(id: number): void {
    this.city?.refreshAction(id);
  }

  /** Sends text to the open session; returns whether it was sent (the caller then clears its input). */
  sendInput(text: string, mode: InputMode): boolean {
    const id = this.selectedRef();
    if (id === null) return this.refuse("open a session first");
    if (text.trim() === "") return this.refuse("type a message first");
    const spec = mode === "message" ? sessionMessage(id, text) : sessionSubmit(id, text, mode);
    return this.send(spec);
  }

  /**
   * Answers the open session's pending prompt `requestId` with `option`, both
   * exactly as the button showing them was drawn. If gc's current prompt is a
   * different one (or no longer lists that option), nothing is sent: the
   * person must see the prompt they answer.
   */
  answer(requestId: string, option: string): void {
    const s = this.city?.snapshot();
    const id = this.selectedRef();
    const d = s && id !== null ? s.details.get(id)?.pending.value?.pending : undefined;
    if (!d || id === null) {
      this.refuse("that prompt is no longer pending");
      return;
    }
    if (d.request_id !== requestId || !d.options.includes(option)) {
      this.refuse("the prompt changed: review it before answering");
      return;
    }
    this.send(sessionRespond(id, requestId, option));
  }

  /** Opens the new-session form for an agent (gc's qualified name). */
  openNewSession(agent: string): void {
    this.clearDialogs();
    this.creating = { agent };
  }

  /**
   * Sling… on the open bead: asks which of the city's agents to route it to,
   * saying that gc cannot deduplicate a sling. Picking one (confirm) sends it.
   */
  requestSling(): void {
    const id = this.selectedBeadRef();
    if (id === null) return;
    const agents = this.agentNames();
    if (agents.length === 0) {
      this.refuse("the agent list has not loaded yet");
      return;
    }
    this.ask({
      specs: agents.map((a) => beadSling(id, a)),
      retryOf: null,
      pick: {
        question: `Sling bead ${id} to which agent?`,
        detail: `gc routes the bead to the agent you pick (and applies the agent's default formula, if it has one). ${SLING_MAY_ROUTE_TWICE}`,
        labels: agents,
      },
    });
  }

  /** Close… on the open bead: opens the close form (a reason, then Close). */
  requestCloseBead(): void {
    const id = this.selectedBeadRef();
    if (id === null) return;
    this.clearDialogs();
    this.closingBead = { id };
  }

  /** Closes the bead of the close form with `reason` (blank: none). Returns whether it was sent. */
  closeBead(reason: string): boolean {
    const c = this.closingBead;
    if (!c) return false;
    this.closingBead = null;
    return this.send(beadClose(c.id, reason));
  }

  /** Reopens the open bead. */
  reopenBead(): void {
    const id = this.selectedBeadRef();
    if (id !== null) this.send(beadReopen(id));
  }

  /** Opens the new-bead form, with the city's agents to sling it to. */
  openNewBead(): void {
    this.clearDialogs();
    this.beadForm = { agents: this.agentNames(), slingTo: null };
  }

  /** Chooses the form's sling target by its place in the form's agent list; null: create only. */
  chooseSlingTarget(index: number | null): void {
    const f = this.beadForm;
    if (!f) return;
    f.slingTo = index !== null && index >= 0 && index < f.agents.length ? index : null;
  }

  /**
   * Creates a bead from the form (and slings it to the chosen agent once gc
   * created it). Refuses a blank title or a priority that is not a whole
   * number, keeping the form open. Returns whether it was sent.
   */
  createBead(form: BeadForm): boolean {
    const f = this.beadForm;
    if (!f) return false;
    const title = form.title.trim();
    if (title === "") return this.refuse("a new bead needs a title");
    const p = form.priority.trim();
    if (p !== "" && !/^\d+$/.test(p)) return this.refuse("priority must be a whole number, like 2 (or blank)");
    const labels = form.labels.split(",").map((l) => l.trim()).filter((l) => l !== "");
    const slingTo = f.slingTo === null ? null : (f.agents[f.slingTo] ?? null);
    this.beadForm = null;
    return this.send(beadCreate({ title, description: form.description, priority: p === "" ? null : Number(p), labels }, slingTo));
  }

  /** Starts a session of the form's agent; `alias` may be empty. Returns whether it was sent. */
  createSession(alias: string): boolean {
    const c = this.creating;
    if (!c) return false;
    this.creating = null;
    return this.send(sessionNew(c.agent, alias.trim() === "" ? null : alias.trim()));
  }

  // ---- actions ----------------------------------------------------------------------

  private send(spec: ActionSpec): boolean {
    if (!this.city) return this.refuse("no running city to act on");
    const activity = this.city ? activityModel(this.city.activity(), null, this.deps.clock.now()) : null;
    if (isBusy(activity, spec)) return this.refuse(`${spec.verb} is already under way`);
    this.notice = null;
    this.city.act(spec);
    return true;
  }

  private retryNow(id: number): void {
    if (!this.city) {
      this.refuse("no running city to act on");
      return;
    }
    const r = this.city.retryAction(id);
    this.notice = r.ok ? null : `not retried: ${r.error}`;
  }

  private ask(c: NonNullable<CopyController["confirming"]>): void {
    this.clearDialogs();
    this.confirming = c;
  }

  private clearDialogs(): void {
    this.confirming = null;
    this.creating = null;
    this.beadForm = null;
    this.closingBead = null;
  }

  /** The city's agents by gc's qualified names, in gc's order. */
  private agentNames(): string[] {
    return this.city?.snapshot().agents.value?.items.map((a) => a.name) ?? [];
  }

  /** The open bead's id as gc sent it, if the board shows it or gc returned it by id; else says why not. */
  private selectedBeadRef(): string | null {
    const id = this.selectedBead;
    const s = this.city?.snapshot();
    if (id === null || !s) {
      this.refuse("open a bead first");
      return null;
    }
    if (beadDetailModel({ snapshot: s, now: this.deps.clock.now(), selected: id }).kind !== "bead") {
      this.refuse(`bead ${cleanLine(id)} is not on the board or known to gc`);
      return null;
    }
    return id;
  }

  private refuse(why: string): false {
    this.notice = why;
    return false;
  }

  /** The open session's id as gc sent it, if gc still lists it. */
  private selectedRef(): string | null {
    const id = this.selected;
    if (id === null) return null;
    return this.city?.snapshot().sessions.value?.items.some((x) => x.id === id) ? id : null;
  }

  private dialog(): DialogModel | null {
    if (this.creating) return { kind: "new-session", agent: cleanLine(this.creating.agent) };
    const f = this.beadForm;
    if (f) {
      const target = f.slingTo === null ? null : cleanLine(f.agents[f.slingTo] ?? "");
      return {
        kind: "new-bead",
        agents: f.agents.map(cleanLine),
        slingTo: target,
        slingToIndex: f.slingTo,
        note: target === null
          ? null
          : `Two gc calls: create the bead, then sling it to ${target}. A retry of the create reuses its key: gc deduplicates it within 30 min, not across a gc restart, and not after a gc-side error (gc then drops the key). ${SLING_MAY_ROUTE_TWICE}`,
      };
    }
    if (this.closingBead) {
      return {
        kind: "close-bead",
        question: cleanLine(`Close bead ${this.closingBead.id}?`),
        detail: "gc closes the bead with the reason below as its close reason (blank: none). Reopen brings it back.",
      };
    }
    const c = this.confirming;
    if (c?.pick) return { kind: "pick", question: cleanLine(c.pick.question), detail: cleanLine(c.pick.detail), choices: c.pick.labels.map(cleanLine) };
    const first = c?.specs[0];
    if (!c || !first?.confirm) return null;
    const choices = c.specs.map((x) => ({ label: cleanLine(x.verb), detail: cleanLine(x.confirm?.detail ?? "") }));
    return { kind: "confirm", question: cleanLine(c.retryOf === null ? first.confirm.question : `Retry: ${first.confirm.question}`), choices };
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
      const id = `${key.apiUrl}\u0000${key.city}`;
      if (this.lastCity !== id) this.selectedBead = null;
      this.lastCity = id;
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

  /** Records a failure of this copy's own work; one identical to the newest is not recorded again (a tick fails every 250 ms). */
  private recordFailure(source: string, error: SyncError): void {
    const last = this.failures.at(-1);
    if (last && last.source === source && JSON.stringify(last.error) === JSON.stringify(error)) return;
    this.failures = [...this.failures, { at: this.deps.clock.now(), source, error }].slice(-COPY_ERROR_LIMIT);
  }

  private herdrVersion(): string | null {
    const v = this.deps.host.herdrVersion();
    if (v.ok) return v.value;
    this.recordFailure("herdr", v.error);
    return null;
  }

  private writeProbe(now: number): void {
    const v = this.view(now);
    this.deps.probe.offer(probeDocument({
      modVersion: MOD_VERSION,
      herdrVersion: this.herdrVersion(),
      machine: this.deps.discovery.machine,
      header: v.header,
      onScreen: this.onScreen,
      keyboard: false,
      agents: v.agents,
      board: v.board,
      beadDetail: v.beadDetail,
      detail: v.detail,
      activity: v.activity,
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
