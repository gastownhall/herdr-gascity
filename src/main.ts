// The Gas City mod for herdr-app: the View herdr loads from gascity/main.js.
// Kept thin: host access lives in host.ts, one copy's wiring in copy.ts
// (discovery + the shared sync registry), the view-models in vm/, drawing in
// view/.
//
// herdr gives every async host operation to the copy whose code starts it,
// and never settles it once that copy closes. So this copy discovers in its
// own init task, starts shared work only from its own periodic timer
// (cx.timer.every in init), renders from the shared snapshots, and on close
// only unsubscribes.
//
// Every action a click asks for runs in that click, in this copy's own turn,
// so its request belongs to this copy; the copy's text inputs are created in
// init (herdr refuses to create them in render).
//
// Commands herdr delivers (`herdr-app do gascity.<command>`, keys.json
// bindings, the bare "focus" of pane.go) arrive in a loop over nextCommand()
// that this copy spawns in init, and run through the same copy methods as the
// buttons; keys on the focused root do too. The copy herdr opens as the
// "needs you" window (mod.open) says so in shared state while it is open.

import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import {
  closeWindow, execGcStatus, hostFetch, logError, missingHostExports, nextCommand, postNeedsYou, probeIo, readExecLog, readFocusTarget,
  readHerdrVersion, readLastCity, readProbeEnabled, readProps, readSharedSettings, readSupervisorConfig, readTheme, readVisibility, rememberCity,
  selectTab, setProbeEnabled, setWindowOpen,
} from "./host.ts";
import { CopyController, type CommandUi } from "./copy.ts";
import { keyAction } from "./keys.ts";
import { overlayOf } from "./notify/window.ts";
import { decodeCopy } from "./discovery/city.ts";
import { DiscoveryController, type DiscoveryTask } from "./discovery/controller.ts";
import { ProbeWriter, sharedProbeWriter } from "./probe.ts";
import { systemClock } from "./sync/clock.ts";
import { SyncRegistry, TICK_MS, sharedRegistry } from "./sync/registry.ts";
import { VisibilityCache, sharedVisibilityCache } from "./sync/visibilityCache.ts";
import { errorText } from "./vm/errorText.ts";
import { syncErrorText } from "./vm/diagnostics.ts";
import { renderPanel, type PanelActions, type PanelInputs, type PanelKeyboard } from "./view/panel.ts";

/** What this copy can do, decided once in init; `overlay` is the window's overlay id (null for a tab or docked copy). */
type Copy =
  | { kind: "host-incompatible"; missing: readonly string[] }
  | { kind: "copy-invalid"; error: string }
  | { kind: "ready"; copy: CopyController; overlay: string | null; focus: { handle: GpuiFocusHandle | null } };

/** The app's registry: one per module run, shared by every copy. */
function registry(): SyncRegistry {
  return sharedRegistry(() => new SyncRegistry({
    fetch: hostFetch,
    onError: (key, entry) => logError(`gascity: ${key.city}: ${entry.source}: ${syncErrorText(entry.error)}`),
    onNeedsYou: postNeedsYou,
  }));
}

/** The app's visibility read: one per tick window for every copy (sync/visibilityCache.ts). */
function visibility() {
  return sharedVisibilityCache(() => new VisibilityCache(readVisibility));
}

/** A discovery task of the view that owns `cx`. */
function taskOf(task: GpuiAsyncContext): DiscoveryTask {
  return { notify: () => task.notify(), sleep: (ms) => task.sleep(ms) };
}

function setUp(): Copy {
  const missing = missingHostExports();
  if (missing.length > 0) return { kind: "host-incompatible", missing };
  // herdr passes undefined props to a root view; props() is null for a copy opened without props.
  const last = readLastCity();
  const props = readProps();
  const decoded = decodeCopy(props, last.ok ? last.value : null);
  if (!decoded.ok) return { kind: "copy-invalid", error: errorText(decoded.error) };
  const reg = registry();
  const discovery = new DiscoveryController({
    settings: readSharedSettings,
    gcStatus: execGcStatus,
    readSupervisorConfig,
    fetch: reg.probeFetch().fetch,
    probeFetch: () => reg.probeFetch(),
    rememberCity,
  }, decoded.value);
  if (!last.ok) discovery.hostErrors.push(last.error);
  const overlay = overlayOf(props);
  const focus: { handle: GpuiFocusHandle | null } = { handle: null };
  const copy = new CopyController({
    registry: reg,
    discovery,
    host: {
      visibility: () => visibility().get(systemClock.now()),
      probeEnabled: readProbeEnabled,
      setProbe: setProbeEnabled,
      herdrVersion: readHerdrVersion,
      execLog: readExecLog,
      keyboard: () => focus.handle?.is_focused() ?? false,
      focusTarget: readFocusTarget,
    },
    clock: systemClock,
    probe: sharedProbeWriter(() => new ProbeWriter(probeIo)),
    window: overlay !== null,
  });
  return { kind: "ready", copy, overlay, focus };
}

/** The new-bead form's fields as typed. */
function beadForm(inputs: PanelInputs) {
  return {
    title: inputs.beadTitle.value(),
    description: inputs.beadDescription.value(),
    priority: inputs.beadPriority.value(),
    labels: inputs.beadLabels.value(),
  };
}

/** Creates the bead from the form; once sent, the form's fields are cleared. */
function createBead(copy: CopyController, inputs: PanelInputs): void {
  if (!copy.createBead(beadForm(inputs))) return;
  for (const i of [inputs.beadTitle, inputs.beadDescription, inputs.beadPriority, inputs.beadLabels]) i.set_value("");
}

/** Closes the form's bead with the typed reason; once sent, the reason is cleared. */
function closeBead(copy: CopyController, inputs: PanelInputs): void {
  if (copy.closeBead(inputs.closeReason.value())) inputs.closeReason.set_value("");
}

/**
 * The copy's text inputs; Enter in the send box sends, Enter in the alias
 * starts the session, Enter in the new bead's title creates it, Enter in the
 * close reason closes the bead.
 */
function inputsFor(copy: CopyController): PanelInputs {
  const message = InputState.new({ placeholder: "Message to the session" });
  const alias = InputState.new({ placeholder: "alias (optional)" });
  const beadTitle = InputState.new({ placeholder: "title (required)" });
  const beadDescription = InputState.new({ placeholder: "description (optional)" });
  const beadPriority = InputState.new({ placeholder: "priority, e.g. 2 (optional)" });
  const beadLabels = InputState.new({ placeholder: "labels, comma-separated (optional)" });
  const closeReason = InputState.new({ placeholder: "close reason (optional)" });
  message.on("submit", (_, cx) => {
    if (copy.sendInput(message.value(), "default")) message.set_value("");
    cx.notify();
  });
  alias.on("submit", (_, cx) => {
    if (copy.createSession(alias.value())) alias.set_value("");
    cx.notify();
  });
  const inputs: PanelInputs = { message, alias, beadTitle, beadDescription, beadPriority, beadLabels, closeReason };
  beadTitle.on("submit", (_, cx) => {
    createBead(copy, inputs);
    cx.notify();
  });
  closeReason.on("submit", (_, cx) => {
    closeBead(copy, inputs);
    cx.notify();
  });
  return inputs;
}

/** What a command or key needs from the view: the keyboard, a "retry now" task, the close form's reason box. */
function uiFor(state: Extract<Copy, { kind: "ready" }>, inputs: PanelInputs | null, cx: GpuiContext): CommandUi {
  return {
    focusKeyboard: () => {
      if (state.focus.handle === null) return false;
      state.focus.handle.focus();
      return true;
    },
    retry: () => {
      cx.spawn((task) => state.copy.retry(taskOf(task)));
    },
    closeReason: (reason) => inputs?.closeReason.set_value(reason),
  };
}

function actionsFor(state: Extract<Copy, { kind: "ready" }>, inputs: PanelInputs | null): PanelActions {
  const copy = state.copy;
  return {
    showTab: (tab, cx) => {
      selectTab(tab);
      cx.notify();
    },
    closeWindow: (cx) => {
      if (state.overlay !== null) closeWindow(state.overlay);
      cx.notify();
    },
    retry: (cx) => {
      cx.spawn((task) => copy.retry(taskOf(task)));
      cx.notify();
    },
    select: (city, cx) => {
      copy.selectCity(city);
      cx.notify();
    },
    selectSession: (id, cx) => {
      copy.selectSession(id);
      cx.notify();
    },
    selectBead: (id, cx) => {
      copy.selectBead(id);
      cx.notify();
    },
    toggleGroup: (key, cx) => {
      copy.toggleGroup(key);
      cx.notify();
    },
    close: (cx) => {
      copy.selectSession(null);
      cx.notify();
    },
    toggleDiagnostics: (cx) => {
      copy.toggleDiagnostics();
      cx.notify();
    },
    act: (spec, cx) => {
      copy.request(spec);
      cx.notify();
    },
    requestKill: (sessionId, cx) => {
      copy.requestKill(sessionId);
      cx.notify();
    },
    send: (mode, cx) => {
      if (inputs !== null && copy.sendInput(inputs.message.value(), mode)) inputs.message.set_value("");
      cx.notify();
    },
    answer: (requestId, option, cx) => {
      copy.answer(requestId, option);
      cx.notify();
    },
    openNewSession: (agent, cx) => {
      copy.openNewSession(agent);
      cx.notify();
    },
    createSession: (cx) => {
      if (inputs !== null && copy.createSession(inputs.alias.value())) inputs.alias.set_value("");
      cx.notify();
    },
    openNewBead: (cx) => {
      copy.openNewBead();
      cx.notify();
    },
    chooseSlingTarget: (index, cx) => {
      copy.chooseSlingTarget(index);
      cx.notify();
    },
    createBead: (cx) => {
      if (inputs !== null) createBead(copy, inputs);
      cx.notify();
    },
    requestSling: (cx) => {
      copy.requestSling();
      cx.notify();
    },
    requestCloseBead: (cx) => {
      copy.requestCloseBead();
      cx.notify();
    },
    closeBead: (cx) => {
      if (inputs !== null) closeBead(copy, inputs);
      cx.notify();
    },
    reopenBead: (cx) => {
      copy.reopenBead();
      cx.notify();
    },
    confirm: (choice, cx) => {
      copy.confirm(choice);
      cx.notify();
    },
    cancelDialog: (cx) => {
      copy.cancelDialog();
      cx.notify();
    },
    retryAction: (id, cx) => {
      copy.retryAction(id);
      cx.notify();
    },
    refreshAction: (id, cx) => {
      copy.refreshAction(id);
      cx.notify();
    },
  };
}

export default class GasCity extends View {
  private state: Copy = { kind: "copy-invalid", error: "init has not run" };
  private inputs: PanelInputs | null = null;

  override init(_props: GpuiProps | undefined, cx: GpuiAsyncContext): void {
    this.state = setUp();
    const state = this.state;
    if (state.kind !== "ready") return;
    const inputs = inputsFor(state.copy);
    this.inputs = inputs;
    if (typeof cx.focus_handle === "function") state.focus.handle = cx.focus_handle();
    if (state.overlay !== null) {
      setWindowOpen(true);
      visibility().invalidate();
    }
    cx.spawn((task) => state.copy.discover(taskOf(task)));
    cx.timer.every(TICK_MS, (tcx) => {
      // A rediscovery is spawned from this copy's own timer, so its work belongs to this copy.
      if (state.copy.tick((body) => tcx.spawn((task) => body(taskOf(task))))) tcx.notify();
    });
    // herdr delivers commands only to copies on screen; each runs in this copy's turn.
    cx.spawn(async (task) => {
      for (;;) {
        const command = await nextCommand();
        state.copy.runCommand(command, uiFor(state, inputs, task));
        task.notify();
      }
    });
  }

  override close(_cx: GpuiAsyncContext): void {
    if (this.state.kind !== "ready") return;
    this.state.copy.close();
    if (this.state.overlay !== null) {
      setWindowOpen(false);
      visibility().invalidate();
    }
  }

  /** The root's keyboard: keys call the same copy methods as the buttons. */
  private keyboard(state: Extract<Copy, { kind: "ready" }>): PanelKeyboard | null {
    const handle = state.focus.handle;
    if (handle === null) return null;
    const inputs = this.inputs;
    return {
      handle,
      onKey: (event, cx) => {
        const action = keyAction(event.keystroke);
        if (action !== null && state.copy.key(action, uiFor(state, inputs, cx))) cx.notify();
      },
    };
  }

  override render(_cx: GpuiContext): GpuiElement {
    // herdr renders again when its live data changes: the next tick reads visibility anew.
    visibility().invalidate();
    const state = this.state;
    if (state.kind === "host-incompatible") return renderPanel({ kind: "host-incompatible", missing: state.missing });
    const theme = readTheme();
    if (state.kind === "copy-invalid") return renderPanel({ kind: "copy-invalid", theme, error: state.error });
    return renderPanel({
      kind: "city", theme, view: state.copy.view(systemClock.now()), actions: actionsFor(state, this.inputs), inputs: this.inputs, keyboard: this.keyboard(state),
    });
  }
}
