// One copy of the mod: its city machine (discovery), its subscriptions to
// the shared sync registry, and its UI state. main.ts is the thin View
// around it.
//
// herdr's ownership rule decides the shape. Every async host operation
// belongs to the copy whose code starts it and never settles once that copy
// closes, so:
//   - discovery runs in a task of this copy (init, a "retry now" click, or
//     this copy's own tick while it has no endpoint, backing off, or when a
//     run stalled because herdr resumed it in a copy that then closed);
//   - everything shared (the city list poll, the city store's steps, the
//     probe write) starts only from this copy's own periodic timer: `tick`;
//   - the city list and the city store are subscribed from a tick as soon as
//     the API and a running city are known, and unsubscribed when they
//     change;
//   - `close` only unsubscribes and cancels its discovery: it starts nothing,
//     and work this copy had started is abandoned to the next tick of a
//     surviving copy.
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
//
// Commands (`herdr-app do gascity.<command>`, keys.json bindings; grammar in
// commands.ts) run through `runCommand` in this copy's turn and call the
// same methods as the buttons, naming what they act on by gc's id instead of
// the selection; a refused command says why in the notice and the probe.
// Keys (keys.ts) call the same methods too.
//
// The "needs you" window is a copy herdr opened as an overlay (mod.open):
// each tick it applies the newest fresh shared focus target (notify/focus.ts)
// — selects its city, then opens its session — so a toast's click shows the
// session it was about even though no command can reach a hidden copy.

import type { ActionSpec } from "./actions/activity.ts";
import { agentResume, agentSuspend } from "./actions/agent.ts";
import { rigResume, rigSuspend } from "./actions/rig.ts";
import {
  sessionClose, sessionKill, sessionMessage, sessionNew, sessionPin, sessionRespond, sessionStop, sessionSubmit, sessionSuspend, sessionUnpin,
  sessionWake,
} from "./actions/session.ts";
import { CommandBook, type CommandEntry } from "./commandBook.ts";
import { isMutating, parseCommand, shownCommand, type Command } from "./commands.ts";
import { moveIn, type KeyAction } from "./keys.ts";
import { focusToApply } from "./notify/focus.ts";
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
import { MOD_NAME, mayBeOnScreen, type VisibilityInput } from "./sync/visibility.ts";
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
  /** Turns the probe file on or off for every copy. */
  setProbe(on: boolean): void;
  /** herdr-app's version (null when it reports none), or why it could not be read. */
  herdrVersion(): Result<string | null, GcError>;
  execLog(): readonly ExecRecord[];
  /** Whether this copy holds the keyboard. */
  keyboard(): boolean;
  /** The raw shared focus target (notify/focus.ts). */
  focusTarget(): unknown;
}

export interface CopyDeps {
  registry: SyncRegistry;
  discovery: DiscoveryController;
  host: CopyHost;
  clock: Clock;
  probe: ProbeWriter;
  /** This copy is the "needs you" window (herdr opened it as an overlay): it follows the shared focus target. */
  window?: boolean;
  /** The app's command book (commandBook.ts), shared by every copy; default: one of this copy's own. */
  commands?: CommandBook;
}

/** What only the view around a copy can do for a command (main.ts). */
export interface CommandUi {
  /** Moves the keyboard onto this copy; false when herdr gives the mod no focus handle. */
  focusKeyboard(): boolean;
  /** "Retry now", run in a task of this copy. */
  retry(): void;
  /** Types `reason` into the close form's reason box. */
  closeReason(reason: string): void;
  /** Types `title` into the new-bead form's title box. */
  beadTitle(title: string): void;
}

/** The "needs you" window's model. */
export interface WindowModel {
  /** The session the newest focus target names (cleaned), or null. */
  target: { city: string; session: string } | null;
  /** The city's sessions that need you, cleaned. */
  pending: { session: string; label: string; kind: string }[];
  /** Tabs holding a Gas City pane (herdr's ids), for "Show Gas City tab". */
  tabs: string[];
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
  /** The "needs you" window's part; null for a copy that is not the window. */
  window: WindowModel | null;
  /** Commands this copy ran, newest last. */
  commands: readonly CommandEntry[];
}

/** How long a focus waits for its city to run and list its sessions. */
export const FOCUS_WAIT_MS = 60_000;

const CITY_SCOPED: ReadonlySet<GcError["kind"]> = new Set(["city-not-running", "write-grant-required", "read-grant-required", "read-only", "api-missing"]);

function isCityScoped(e: GcError | null): e is CityScopedError {
  return e !== null && CITY_SCOPED.has(e.kind);
}

/** Starts a discovery run in a task of this copy (from its own timer's context). */
export type Spawn = (body: (task: DiscoveryTask) => Promise<void>) => void;

/** While a copy has no endpoint, its tick rediscovers after this long, doubling… */
export const REDISCOVER_BASE_MS = 5_000;
/** …up to this. */
export const REDISCOVER_CAP_MS = 60_000;
/**
 * A discovery run none of whose host calls settled for this long is presumed
 * lost (herdr resumed it in a copy that closed) and started again. Every call
 * it awaits ends sooner: a /health probe waits at most 40 s queued then 5 s,
 * and /v0/cities at most 35 s queued then herdr's 30 s timeout.
 */
export const DISCOVERY_STALL_MS = 90_000;

/** The wait before rediscovery number `attempt` (1-based). */
export function rediscoverDelay(attempt: number): number {
  return Math.min(REDISCOVER_CAP_MS, REDISCOVER_BASE_MS * 2 ** Math.min(Math.max(attempt, 1) - 1, 16));
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
  /** The next rediscovery while this copy has no endpoint, and how many there were. */
  private rediscovery: { attempt: number; at: number } | null = null;
  /** The discovery's progress count when it last moved, and when (stall detection). */
  private discoveryProgress = { count: 0, at: 0 };
  /** A session to show once its city is subscribed and lists it (focus command, or the window's target). */
  private focusing: { city: string; session: string; since: number } | null = null;
  /** The seq of the last shared focus target the window applied. */
  private focusApplied = 0;
  private focusShown: { city: string; session: string } | null = null;
  private gascityTabs: string[] = [];
  /** The Idempotency-Key a command's nonce gives the action it sends (only while that command runs). */
  private commandKey: string | null = null;
  private ownBook: CommandBook | null = null;

  constructor(private readonly deps: CopyDeps) {}

  /** Discovers gc's API and the cities; run it in a task of this copy (init). */
  discover(task: DiscoveryTask): Promise<void> {
    this.discoveryProgress = { count: this.deps.discovery.progress, at: this.deps.clock.now() };
    return this.deps.discovery.run(task);
  }

  /**
   * This copy's periodic timer (every TICK_MS) and nothing else calls this:
   * subscribes and unsubscribes as the machine says, ticks the shared city
   * list and city store, and writes the probe. Returns true when the view
   * should be redrawn. An exception inside is recorded in the diagnostics
   * (and the view redrawn to show it); the next tick starts over. `spawn`
   * starts a task of this copy for a rediscovery (no endpoint, or a stalled run).
   */
  tick(spawn: Spawn | null = null): boolean {
    if (this.closed) return false;
    try {
      return this.step(spawn);
    } catch (cause) {
      this.recordFailure("tick", { kind: "tick-crashed", message: messageOf(cause) });
      return true;
    }
  }

  private step(spawn: Spawn | null): boolean {
    const { registry, discovery, clock } = this.deps;
    this.readVisibility();
    registry.setOnScreen(this.onScreen);
    // Slots of closed copies are freed here too, so a queued discovery request starts in this copy's turn.
    registry.reclaim();
    if (spawn !== null) this.followDiscovery(clock.now(), spawn);

    const before = discovery.machine.state;
    this.followCities("endpoint" in before ? before.endpoint.url : null, before.phase !== "city-running");
    // The city list may just have moved the machine.
    const state = discovery.machine.state;
    const endpoint = "endpoint" in state ? state.endpoint : null;
    const running = state.phase === "city-running" && endpoint !== null ? state.city.name : null;
    this.followCity(endpoint !== null && running !== null ? { apiUrl: endpoint.url, city: running } : null);
    this.followFocus();
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
    else this.deps.probe.off(clock.now());

    const signature = [
      this.machineVersion(), this.citiesRev, this.city?.snapshot().rev ?? -1, this.city?.activity().rev ?? -1, this.onScreen, this.selected,
      this.selectedBead, this.notice ?? "", this.gascityTabs.join(","), this.focusShown?.session ?? "",
    ].join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    return true;
  }

  /** The copy closes: unsubscribe everything. Starts nothing. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.discovery.cancel();
    this.peek?.release();
    this.peek = null;
    this.beadWatch?.release();
    this.beadWatch = null;
    this.city?.unsubscribe();
    this.city = null;
    this.cities?.unsubscribe();
    this.cities = null;
    this.deps.probe.release(this);
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
      window: this.deps.window ? this.windowModel() : null,
      commands: this.commands().entries(),
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
    this.rediscovery = null;
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

  /**
   * Sends text to a session gc lists: the send box (for the session whose
   * detail drew it, never the selection at send time) and the
   * submit/interrupt/message commands. Returns whether it was sent (the
   * caller then clears its input).
   */
  sendInputTo(id: string | null, text: string, mode: InputMode): boolean {
    if (id === null) return this.refuse("open a session first");
    if (!this.listed(id)) return this.refuse(`session ${cleanLine(id)} is not listed by gc`);
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
    this.answerFor(this.selectedRef(), requestId, option);
  }

  /** Answers session `id`'s pending prompt as its detail shows it (the answer buttons and the answer command). */
  answerFor(id: string | null, requestId: string, option: string): void {
    const s = this.city?.snapshot();
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
    this.requestSlingFor(this.selectedBead);
  }

  /** Sling… on bead `bead` (the open bead's button, and the sling command). */
  requestSlingFor(bead: string | null): void {
    const id = this.beadRef(bead);
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
    this.requestCloseBeadFor(this.selectedBead);
  }

  /** Close… on bead `bead`: opens the close form (the open bead's button, and the bead-close command). */
  requestCloseBeadFor(bead: string | null): void {
    const id = this.beadRef(bead);
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
    this.reopenBeadFor(this.selectedBead);
  }

  /** Reopens bead `bead` (the open bead's button, and the bead-reopen command). */
  reopenBeadFor(bead: string | null): void {
    const id = this.beadRef(bead);
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

  // ---- keys ---------------------------------------------------------------------------

  /** A key of the focused copy (keys.ts): the same methods as the buttons. Returns whether it did something. */
  key(action: KeyAction, ui: CommandUi): boolean {
    switch (action) {
      case "next-session":
      case "prev-session": {
        const next = moveIn(this.sessionOrder(), this.selected, action === "next-session" ? 1 : -1);
        if (next === null) return false;
        this.selectSession(next);
        return true;
      }
      case "refresh":
        ui.retry();
        return true;
      case "back":
        if (this.dialog() !== null) this.cancelDialog();
        else if (this.selected !== null) this.selectSession(null);
        else return false;
        return true;
    }
  }

  // ---- commands -----------------------------------------------------------------------

  /**
   * Runs one command herdr delivered (commands.ts), in this copy's turn,
   * through the methods the buttons call. herdr delivers it to every shown
   * copy: one that changes gc state runs only in a copy showing the city it
   * names, and only once per app (commandBook.ts). A command the grammar or
   * the copy refuses changes nothing and says why in the notice. Every
   * outcome goes to the app's command log.
   */
  runCommand(raw: string, ui: CommandUi): CommandEntry {
    const now = this.deps.clock.now();
    const parsed = parseCommand(raw);
    this.notice = null;
    const hadDialog = this.dialog() !== null;
    const entry = (result: CommandEntry["result"], detail: string): CommandEntry =>
      ({ at: now, command: shownCommand(raw), copy: this.copyName(), result, detail: cleanLine(detail) });
    let record: CommandEntry;
    if (!parsed.ok) {
      record = entry("refused", parsed.error);
    } else {
      const { command: c, nonce } = parsed.value;
      const shows = this.city?.key.city ?? null;
      if (isMutating(c) && shows !== c.city) {
        record = entry("skipped", `it names city ${c.city}; this copy shows ${shows ?? "no running city"}`);
      } else if (isMutating(c) && !this.commands().claim(raw, nonce !== null, now)) {
        record = entry("duplicate", "another copy ran this delivery");
      } else {
        let done = "";
        this.commandKey = nonce;
        try {
          done = this.perform(c, ui);
        } catch (cause) {
          this.refuse(`the command failed: ${messageOf(cause)}`);
          this.recordFailure("command", { kind: "listener-failed", message: messageOf(cause) });
        } finally {
          this.commandKey = null;
        }
        // A refused command leaves no form or question of its own behind.
        if (this.notice !== null && !hadDialog) this.clearDialogs();
        if (this.notice !== null) {
          record = entry("refused", this.notice);
          // Refused here (a list not loaded yet, an unknown id): another copy, or the same text again, may run it.
          if (isMutating(c)) this.commands().release(raw);
        }
        else record = entry(done === "asked" ? "asked" : "done", done === "asked" ? "asked first: add :confirm to answer" : done);
      }
    }
    if (record.result === "refused") this.notice = cleanLine(`gascity.${record.command}: refused: ${record.detail}`);
    if (record.result === "skipped") this.notice = cleanLine(`gascity.${record.command}: not run here: ${record.detail}`);
    this.commands().record(record);
    return record;
  }

  private commands(): CommandBook {
    this.ownBook ??= this.deps.commands ?? new CommandBook();
    return this.ownBook;
  }

  /** This copy, as the command log names it. */
  private copyName(): string {
    if (this.deps.window) return "window";
    const pinned = this.deps.discovery.machine.copy.pinned;
    return pinned === null ? "panel" : `panel ${cleanLine(pinned)}`;
  }

  /** Does what a parsed command says; "asked" when it only opened its button's question. Refusals set the notice. */
  private perform(c: Command, ui: CommandUi): string {
    switch (c.verb) {
      case "focus":
        if (!ui.focusKeyboard()) this.refuse("this herdr-app gives the mod no focus handle");
        return "focused";
      case "focus-session":
        this.focusSession(c.city, c.session);
        return "focusing";
      case "city": {
        const pinned = this.deps.discovery.machine.copy.pinned;
        if (pinned !== null) this.refuse(`this copy shows city ${cleanLine(pinned)} only`);
        else if (this.checkCity(c.city)) this.selectCity(c.city);
        return "selected";
      }
      case "session": {
        const id = this.resolveSession(c.session);
        if (id !== null) this.selectSession(id);
        return "opened";
      }
      case "bead":
        this.selectBead(c.bead);
        return "opened";
      case "refresh":
        ui.retry();
        return "refreshing";
      case "probe":
        this.deps.host.setProbe(c.on);
        return c.on ? "probe on" : "probe off";
      case "cancel":
        this.cancelDialog();
        return "cancelled";
      case "session-new":
        if (!this.checkAgent(c.agent)) return "";
        this.openNewSession(c.agent);
        this.createSession(c.alias ?? "");
        return "sent";
      case "wake":
      case "suspend":
      case "stop":
      case "pin":
      case "unpin": {
        const id = this.resolveSession(c.session);
        if (id !== null) this.request(SESSION_SPECS[c.verb](id));
        return "sent";
      }
      case "close":
      case "kill":
      case "kill-force": {
        const id = this.resolveSession(c.session);
        if (id === null) return "";
        if (c.verb === "close") this.request(sessionClose(id));
        else this.requestKill(id);
        return this.answerAsked(c.confirm, c.verb === "kill-force" ? 1 : 0);
      }
      case "submit":
      case "interrupt":
      case "message": {
        const id = this.resolveSession(c.session);
        if (id !== null) this.sendInputTo(id, c.text, c.verb === "submit" ? "default" : c.verb === "interrupt" ? "interrupt_now" : "message");
        return "sent";
      }
      case "answer": {
        const id = this.resolveSession(c.session);
        if (id !== null) this.answerFor(id, c.requestId, c.option);
        return "sent";
      }
      case "agent-suspend":
        if (!this.checkAgent(c.name)) return "";
        this.request(agentSuspend(c.name));
        return this.answerAsked(c.confirm, 0);
      case "agent-resume":
        if (this.checkAgent(c.name)) this.request(agentResume(c.name));
        return "sent";
      case "rig-suspend":
        if (!this.checkRig(c.name)) return "";
        this.request(rigSuspend(c.name));
        return this.answerAsked(c.confirm, 0);
      case "rig-resume":
        if (this.checkRig(c.name)) this.request(rigResume(c.name));
        return "sent";
      case "bead-new": {
        this.openNewBead();
        if (c.slingTo !== null) {
          const index = this.beadForm?.agents.indexOf(c.slingTo) ?? -1;
          if (index < 0) {
            this.cancelDialog();
            this.refuse(this.agentNames().length === 0 ? "the agent list has not loaded yet" : `no agent ${cleanLine(c.slingTo)} in this city`);
            return "";
          }
          this.chooseSlingTarget(index);
          // A sling cannot be deduplicated: like the form's Create and sling, it needs a confirmation.
          if (!c.confirm) {
            ui.beadTitle(c.title);
            return "asked";
          }
        }
        this.createBead({ title: c.title, description: "", priority: "", labels: "" });
        return "sent";
      }
      case "sling": {
        if (!this.checkAgent(c.agent)) return "";
        this.requestSlingFor(c.bead);
        if (this.confirming === null) return "";
        return this.answerAsked(c.confirm, this.agentNames().indexOf(c.agent));
      }
      case "bead-close":
        this.requestCloseBeadFor(c.bead);
        if (this.closingBead === null) return "";
        if (!c.confirm) {
          ui.closeReason(c.reason);
          return "asked";
        }
        this.closeBead(c.reason);
        return "sent";
      case "bead-reopen":
        this.reopenBeadFor(c.bead);
        return "sent";
    }
  }

  /** After a destructive command opened its button's question: answer it with `choice` when confirmed. */
  private answerAsked(confirm: boolean, choice: number): string {
    if (this.notice !== null || this.confirming === null) return "sent";
    if (!confirm) return "asked";
    this.confirm(choice);
    return "sent";
  }

  /** Shows `session` of `city` once the city is subscribed and lists it (the focus command, the window's target). */
  focusSession(city: string, session: string): void {
    const pinned = this.deps.discovery.machine.copy.pinned;
    if (pinned !== null && pinned !== city) {
      this.refuse(`this copy shows city ${cleanLine(pinned)} only`);
      return;
    }
    if (!this.checkCity(city)) return;
    this.focusing = { city, session, since: this.deps.clock.now() };
    this.followFocus();
  }

  /** A session by gc's id, or by its exact alias or session name when exactly one session has it; else says why not. */
  private resolveSession(ref: string): string | null {
    const items = this.city?.snapshot().sessions.value?.items;
    if (!items) {
      this.refuse(this.city ? "the session list has not loaded yet" : "no running city to act on");
      return null;
    }
    if (items.some((x) => x.id === ref)) return ref;
    const named = items.filter((x) => x.alias === ref || x.session_name === ref);
    const [only, ...more] = named;
    if (only && more.length === 0) return only.id;
    if (only) this.refuse(`"${cleanLine(ref)}" names sessions ${named.map((x) => cleanLine(x.id)).join(", ")}: use the session id`);
    else this.refuse(`no session "${cleanLine(ref)}" in city ${cleanLine(this.city?.key.city ?? "")}`);
    return null;
  }

  private checkAgent(name: string): boolean {
    const names = this.agentNames();
    if (names.includes(name)) return true;
    return this.refuse(this.city?.snapshot().agents.value ? `no agent ${cleanLine(name)} in this city` : "the agent list has not loaded yet");
  }

  private checkRig(name: string): boolean {
    const rigs = this.city?.snapshot().rigs.value;
    if (rigs?.items.some((r) => r.name === name)) return true;
    return this.refuse(rigs ? `no rig ${cleanLine(name)} in this city` : "the rig list has not loaded yet");
  }

  private checkCity(city: string): boolean {
    const cities = this.cities?.snapshot().value;
    if (cities?.items.some((c) => c.name === city)) return true;
    return this.refuse(cities ? `gc lists no city ${cleanLine(city)}` : "the city list has not loaded yet");
  }

  /** Session ids in the agents region's order (groups, their agents' sessions, then other sessions). */
  private sessionOrder(): string[] {
    const s = this.city?.snapshot();
    if (!s) return [];
    const m = agentsModel({ snapshot: s, now: this.deps.clock.now(), selected: this.selected, collapsed: this.collapsed });
    return [...m.groups.flatMap((g) => g.agents.flatMap((a) => a.sessions.map((r) => r.id))), ...m.other.map((r) => r.id)];
  }

  // ---- the "needs you" window and focus -------------------------------------------------

  /** Applies the window's newest shared target, then shows the session being focused once its city lists it. */
  private followFocus(): void {
    const now = this.deps.clock.now();
    // The window takes a target only once the city list can confirm its city, so none is lost to a list not loaded yet.
    if (this.deps.window && this.cities?.snapshot().value) {
      const t = focusToApply(this.deps.host.focusTarget(), this.focusApplied, now);
      if (t !== null) {
        this.focusApplied = t.seq;
        this.focusSession(t.city, t.session);
      }
    }
    const f = this.focusing;
    if (f === null) return;
    const { discovery } = this.deps;
    if (selectedCity(discovery.machine.state) !== f.city) discovery.select(f.city);
    if (this.city?.key.city === f.city && this.city.snapshot().sessions.value) {
      this.focusing = null;
      const id = this.resolveSession(f.session);
      if (id !== null) {
        this.selectSession(id);
        this.focusShown = { city: f.city, session: id };
      }
      return;
    }
    if (now - f.since > FOCUS_WAIT_MS) {
      this.focusing = null;
      this.refuse(`could not show session ${cleanLine(f.session)}: city ${cleanLine(f.city)} is not running`);
    }
  }

  private windowModel(): WindowModel {
    const s = this.city?.snapshot();
    const sessions = s?.sessions.value?.items ?? [];
    const pending = (s?.pending.value?.items ?? []).map((p) => {
      const x = sessions.find((y) => y.id === p.session_id);
      return { session: cleanLine(p.session_id), label: cleanLine(x?.alias || x?.template || p.session_id), kind: cleanLine(p.kind) };
    });
    const t = this.focusShown;
    return { target: t ? { city: cleanLine(t.city), session: cleanLine(t.session) } : null, pending, tabs: this.gascityTabs };
  }

  // ---- actions ----------------------------------------------------------------------

  private send(spec: ActionSpec): boolean {
    if (!this.city) return this.refuse("no running city to act on");
    const activity = this.city ? activityModel(this.city.activity(), null, this.deps.clock.now()) : null;
    if (isBusy(activity, spec)) return this.refuse(`${spec.verb} is already under way`);
    this.notice = null;
    this.city.act(spec, this.commandKey ?? undefined);
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

  /** A bead's id as gc sent it, if the board shows it or gc returned it by id; else says why not. */
  private beadRef(id: string | null): string | null {
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
    return id !== null && this.listed(id) ? id : null;
  }

  /** Whether gc lists session `id` (by its id). */
  private listed(id: string): boolean {
    return this.city?.snapshot().sessions.value?.items.some((x) => x.id === id) ?? false;
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

  /**
   * Without an endpoint, rediscovers from this copy's own tick: after
   * rediscoverDelay(1), (2), … once each run has ended. A run that made no
   * progress for DISCOVERY_STALL_MS is started again at once.
   */
  private followDiscovery(now: number, spawn: Spawn): void {
    const d = this.deps.discovery;
    const phase = d.machine.state.phase;
    if (phase !== "no-endpoint" && phase !== "discovering" && phase !== "listing") {
      this.rediscovery = null;
      return;
    }
    if (d.running()) {
      if (d.progress !== this.discoveryProgress.count) {
        this.discoveryProgress = { count: d.progress, at: now };
        return;
      }
      const idleMs = now - this.discoveryProgress.at;
      if (idleMs < DISCOVERY_STALL_MS) return;
      this.recordFailure("discovery", { kind: "discovery-stalled", idleMs });
    } else {
      this.rediscovery ??= { attempt: 1, at: now + rediscoverDelay(1) };
      if (now < this.rediscovery.at) return;
      const attempt = this.rediscovery.attempt + 1;
      this.rediscovery = { attempt, at: now + rediscoverDelay(attempt) };
    }
    spawn((task) => this.discover(task));
  }

  private readVisibility(): void {
    const v = this.deps.host.visibility();
    if (v.ok) {
      this.onScreen = mayBeOnScreen(v.value);
      this.gascityTabs = [...new Set(v.value.panes.filter((p) => p.mod === MOD_NAME).map((p) => p.tab))];
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
    this.deps.probe.offer(this, probeDocument({
      modVersion: MOD_VERSION,
      herdrVersion: this.herdrVersion(),
      machine: this.deps.discovery.machine,
      header: v.header,
      onScreen: this.onScreen,
      keyboard: this.deps.host.keyboard(),
      agents: v.agents,
      board: v.board,
      beadDetail: v.beadDetail,
      detail: v.detail,
      activity: v.activity,
      diagnostics: v.diagnostics,
      execLog: this.deps.host.execLog(),
      refreshCount: this.refreshCount,
      fetchInFlightMax: this.deps.registry.budgetStats().maxInFlight,
      window: this.deps.window ?? false,
      notice: v.notice,
      commands: v.commands,
    }), now);
  }
}

/** The session actions a command names by verb, built as the detail pane's buttons build them. */
const SESSION_SPECS = { wake: sessionWake, suspend: sessionSuspend, stop: sessionStop, pin: sessionPin, unpin: sessionUnpin } as const;

/** A stable number per machine object, so a new machine (any discovery step) redraws. */
const machineIds = new WeakMap<object, number>();
let machineSeq = 0;
function remember(m: object): number {
  const id = ++machineSeq;
  machineIds.set(m, id);
  return id;
}
