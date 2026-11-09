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

import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import {
  execGcStatus, hostFetch, logError, missingHostExports, probeIo, readExecLog, readHerdrVersion, readLastCity, readProbeEnabled,
  readProps, readSharedSettings, readSupervisorConfig, readTheme, readVisibility, rememberCity,
} from "./host.ts";
import { CopyController } from "./copy.ts";
import { decodeCopy } from "./discovery/city.ts";
import { DiscoveryController, type DiscoveryTask } from "./discovery/controller.ts";
import { ProbeWriter, sharedProbeWriter } from "./probe.ts";
import { systemClock } from "./sync/clock.ts";
import { SyncRegistry, TICK_MS, sharedRegistry } from "./sync/registry.ts";
import { errorText } from "./vm/errorText.ts";
import { syncErrorText } from "./vm/diagnostics.ts";
import { renderPanel, type PanelActions, type PanelInputs } from "./view/panel.ts";

/** What this copy can do, decided once in init. */
type Copy =
  | { kind: "host-incompatible"; missing: readonly string[] }
  | { kind: "copy-invalid"; error: string }
  | { kind: "ready"; copy: CopyController };

/** The app's registry: one per module run, shared by every copy. */
function registry(): SyncRegistry {
  return sharedRegistry(() => new SyncRegistry({
    fetch: hostFetch,
    onError: (key, entry) => logError(`gascity: ${key.city}: ${entry.source}: ${syncErrorText(entry.error)}`),
  }));
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
  const decoded = decodeCopy(readProps(), last.ok ? last.value : null);
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
  const copy = new CopyController({
    registry: reg,
    discovery,
    host: { visibility: readVisibility, probeEnabled: readProbeEnabled, herdrVersion: readHerdrVersion, execLog: readExecLog },
    clock: systemClock,
    probe: sharedProbeWriter(() => new ProbeWriter(probeIo)),
  });
  return { kind: "ready", copy };
}

/** The copy's text inputs; Enter in the send box sends, Enter in the alias starts the session. */
function inputsFor(copy: CopyController): PanelInputs {
  const message = InputState.new({ placeholder: "Message to the session" });
  const alias = InputState.new({ placeholder: "alias (optional)" });
  message.on("submit", (_, cx) => {
    if (copy.sendInput(message.value(), "default")) message.set_value("");
    cx.notify();
  });
  alias.on("submit", (_, cx) => {
    if (copy.createSession(alias.value())) alias.set_value("");
    cx.notify();
  });
  return { message, alias };
}

function actionsFor(copy: CopyController, inputs: PanelInputs | null): PanelActions {
  return {
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
    answer: (index, cx) => {
      copy.answer(index);
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
    this.inputs = inputsFor(state.copy);
    cx.spawn((task) => state.copy.discover(taskOf(task)));
    cx.timer.every(TICK_MS, (tcx) => {
      if (state.copy.tick()) tcx.notify();
    });
  }

  override close(_cx: GpuiAsyncContext): void {
    if (this.state.kind === "ready") this.state.copy.close();
  }

  override render(_cx: GpuiContext): GpuiElement {
    const state = this.state;
    if (state.kind === "host-incompatible") return renderPanel({ kind: "host-incompatible", missing: state.missing });
    const theme = readTheme();
    if (state.kind === "copy-invalid") return renderPanel({ kind: "copy-invalid", theme, error: state.error });
    return renderPanel({ kind: "city", theme, view: state.copy.view(systemClock.now()), actions: actionsFor(state.copy, this.inputs), inputs: this.inputs });
  }
}
