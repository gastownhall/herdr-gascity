// herdr-gascity 0.0.0 - the Gas City mod for herdr-app. Built file: do not edit.
// Source: https://github.com/gastownhall/herdr-gascity (src/). `bun run build` rebuilds this file
// byte for byte; source digest sha256:276431f2748a958659befb1de6d956095f6a24e1970b765b742c714a711559c2 over the git-tracked src/, build.ts, package.json, bun.lock and tsconfig.json.

// src/main.ts
import { View } from "gpui-kit";

// src/host.ts
import * as herdr from "herdr";
var REQUIRED_HOST_EXPORTS = ["theme"];
function missingHostExports() {
  const exports = { theme: herdr.theme };
  return REQUIRED_HOST_EXPORTS.filter((name) => typeof exports[name] !== "function");
}
var HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isColor(value) {
  return HEX_COLOR.test(value);
}
function readTheme() {
  const theme2 = herdr.theme();
  const issues = [];
  const pick = (name) => {
    const value = Object.hasOwn(theme2, name) ? theme2[name] : void 0;
    if (value === void 0) {
      issues.push(`herdr theme has no colour "${name}"`);
      return void 0;
    }
    if (!isColor(value)) {
      issues.push(`herdr theme colour "${name}" is not a #rgb, #rrggbb or #rrggbbaa value: ${value}`);
      return void 0;
    }
    return value;
  };
  const colors = { background: pick("background"), foreground: pick("foreground"), muted: pick("muted") };
  return { colors, issues };
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
  const { colors, issues } = model.theme;
  const placeholder = tinted(div().id("gascity-placeholder"), colors.muted, (el, c) => el.text_color(c)).child(PLACEHOLDER_TEXT);
  const themed = tinted(tinted(root, colors.background, (el, c) => el.bg(c)), colors.foreground, (el, c) => el.text_color(c));
  return themed.child(title).child(placeholder).when(issues.length > 0, (el) => el.child(div().id("gascity-host-decode").child(issues.join("; "))));
}

// src/main.ts
var GasCity = class extends View {
  missing = [];
  init(_props, _cx) {
    this.missing = missingHostExports();
  }
  render(_cx) {
    if (this.missing.length > 0) return renderPanel({ kind: "host-incompatible", missing: this.missing });
    return renderPanel({ kind: "placeholder", theme: readTheme() });
  }
};
export {
  GasCity as default
};
