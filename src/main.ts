// The Gas City mod for herdr-app: the View herdr loads from gascity/main.js.
// Kept thin: host access lives in host.ts, discovery in discovery/, the
// header model in vm/, drawing in view/.

import { View } from "gpui-kit";
import {
  execGcStatus, hostFetch, missingHostExports, readLastCity, readProps, readSharedSettings, readSupervisorConfig,
  readTheme, rememberCity,
} from "./host.ts";
import { decodeCopy } from "./discovery/city.ts";
import { DiscoveryController } from "./discovery/controller.ts";
import { errorText } from "./vm/errorText.ts";
import { headerModel } from "./vm/header.ts";
import { renderPanel } from "./view/panel.ts";

/** What this copy can do, decided once in init. */
type Copy =
  | { kind: "host-incompatible"; missing: readonly string[] }
  | { kind: "copy-invalid"; error: string }
  | { kind: "ready"; discovery: DiscoveryController };

/** Starts a discovery run in a task of the view that owns `cx`. */
function discover(discovery: DiscoveryController, cx: GpuiContext): void {
  cx.spawn((task) => discovery.run({ notify: () => task.notify(), sleep: (ms) => task.sleep(ms) }));
}

function setUp(): Copy {
  const missing = missingHostExports();
  if (missing.length > 0) return { kind: "host-incompatible", missing };
  // herdr passes undefined props to a root view; props() is null for a copy opened without props.
  const last = readLastCity();
  const copy = decodeCopy(readProps(), last.ok ? last.value : null);
  if (!copy.ok) return { kind: "copy-invalid", error: errorText(copy.error) };
  const discovery = new DiscoveryController({
    settings: readSharedSettings,
    gcStatus: execGcStatus,
    readSupervisorConfig,
    fetch: hostFetch,
    rememberCity,
  }, copy.value);
  if (!last.ok) discovery.hostErrors.push(last.error);
  return { kind: "ready", discovery };
}

export default class GasCity extends View {
  private copy: Copy = { kind: "copy-invalid", error: "init has not run" };

  override init(_props: GpuiProps | undefined, cx: GpuiAsyncContext): void {
    this.copy = setUp();
    if (this.copy.kind === "ready") discover(this.copy.discovery, cx);
  }

  override render(_cx: GpuiContext): GpuiElement {
    const copy = this.copy;
    if (copy.kind === "host-incompatible") return renderPanel({ kind: "host-incompatible", missing: copy.missing });
    const theme = readTheme();
    if (copy.kind === "copy-invalid") return renderPanel({ kind: "copy-invalid", theme, error: copy.error });
    const { discovery } = copy;
    return renderPanel({
      kind: "city",
      theme,
      header: headerModel(discovery.machine, discovery.hostErrors),
      actions: {
        retry: (cx) => discover(discovery, cx),
        select: (city, cx) => {
          discovery.select(city);
          cx.notify();
        },
      },
    });
  }
}
