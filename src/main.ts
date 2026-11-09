// The Gas City mod for herdr-app: the View herdr loads from gascity/main.js.
// Kept thin (design §4): host access lives in host.ts, drawing in view/.

import { View } from "gpui-kit";
import { missingHostExports, panelColors } from "./host.ts";
import { renderPanel } from "./view/panel.ts";

export default class GasCity extends View {
  private missing: readonly string[] = [];

  override init(_props: Record<string, unknown>, _cx: GpuiContext): void {
    this.missing = missingHostExports();
  }

  override render(_cx: GpuiContext): GpuiElement {
    if (this.missing.length > 0) return renderPanel({ kind: "host-incompatible", missing: this.missing });
    return renderPanel({ kind: "placeholder", colors: panelColors() });
  }
}
