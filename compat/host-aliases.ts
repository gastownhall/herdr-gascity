// The global type names the hand-written host subsets in types/ declare,
// mapped onto the declarations herdr-app generates (`herdr-app types <dir>`
// writes them as gpui-kit.d.ts). The types-drift check type-checks src/
// against the generated declarations with this file in place of the subsets,
// so every global name a subset declares needs a line here. A script file, not
// a .d.ts, so a mapping onto a name the host no longer declares is an error
// even with skipLibCheck.
type GpuiColor = import("gpui-kit").Color;
type GpuiProps = import("gpui-shell").Props;
type GpuiElement = import("gpui-kit").NativeElement;
type GpuiContext = import("gpui-kit").Context;
type GpuiAsyncContext = import("gpui-kit").AsyncContext;
