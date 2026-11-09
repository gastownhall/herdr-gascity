// The mod never calls hc, tmux or bd, never runs terminal.kill, and never
// uses eval or new Function. Comments may say so freely.
import { run } from "herdr";

const hcAddress = "t7";
const bdId = "gc-12";
const label = "gc session attach";

export function open(space: string) {
  run("tab.new", { space, name: `${bdId}/${hcAddress}`, argv: ["gc", "session", "attach", label] });
}
