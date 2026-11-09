// herdr-gascity 0.0.0 - the Gas City mod for herdr-app. Built file: do not edit.
// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file
// byte for byte; source digest sha256:305c8f2c03eba3392bfd4e98012d1fd2d8a1c0f311aa43dd4c8673234be8e09c over src/, build.ts, package.json and bun.lock.

// src/main.ts
import { View } from "gpui-kit";

// src/host.ts
import * as herdr from "herdr";
var REQUIRED_HOST_EXPORTS = ["theme"];
function missingHostExports() {
  const host = { ...herdr };
  return REQUIRED_HOST_EXPORTS.filter((name) => typeof host[name] !== "function");
}
function panelColors() {
  const theme2 = herdr.theme();
  return { background: theme2.background, foreground: theme2.foreground, muted: theme2.muted };
}

// src/view/panel.ts
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
var TITLE = "Gas City";
var PLACEHOLDER_TEXT = "No city data yet: this build of the mod does not connect to gc.";
function hostIncompatibleText(missing) {
  return `This herdr-app is too old for the Gas City mod: it lacks ${missing.join(", ")}.`;
}
function tinted(el, color, apply) {
  return color === void 0 ? el : apply(el, color);
}
function renderPanel(model) {
  const root = v_flex().id("gascity-root").size_full().p(12).gap(8);
  const title = div().id("gascity-title").text_size(16).font_semibold().child(TITLE);
  if (model.kind === "host-incompatible") {
    return root.child(title).child(div().id("gascity-host-incompatible").child(hostIncompatibleText(model.missing)));
  }
  const { background, foreground, muted } = model.colors;
  const placeholder = tinted(div().id("gascity-placeholder"), muted, (el, c) => el.text_color(c)).child(PLACEHOLDER_TEXT);
  const themed = tinted(tinted(root, background, (el, c) => el.bg(c)), foreground, (el, c) => el.text_color(c));
  return themed.child(title).child(placeholder);
}

// src/main.ts
var GasCity = class extends View {
  missing = [];
  init(_props, _cx) {
    this.missing = missingHostExports();
  }
  render(_cx) {
    if (this.missing.length > 0) return renderPanel({ kind: "host-incompatible", missing: this.missing });
    return renderPanel({ kind: "placeholder", colors: panelColors() });
  }
};
export {
  GasCity as default
};
