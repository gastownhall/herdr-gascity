// A small mod source for the types-drift tests: the global Gpui* names (the
// hand-written subsets' names, mapped by compat/host-aliases.ts), a namespace
// import of "herdr", named imports, a class extending the host's View.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import * as herdr from "herdr";

function accent(): GpuiColor {
  const value = herdr.theme()["accent"];
  return value?.startsWith("#") ? (value as GpuiColor) : "#000000";
}

export default class extends View {
  override init(_props: GpuiProps | undefined, _cx: GpuiAsyncContext): void {}

  override render(_cx: GpuiContext): GpuiElement {
    return v_flex().child(div().id("title").p(2).bg(accent()).child("gascity"));
  }
}
