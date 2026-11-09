// The mod never calls hc, tmux or bd, never runs terminal.kill, and never
// uses eval or new Function. Comments may say so freely.
import * as herdr from "herdr";

const hcAddress = "t7";
const bdId = "gc-12";
const label = "gc session attach";

export function open(space: string) {
  const argv = ["gc", "session", "attach", label];
  herdr.run("tab.select", { id: `${space}/${bdId}/${hcAddress}/${argv.length}` });
}

export function attachable(transport: string): boolean {
  // gc's transport value is data: comparing it with "tmux" runs nothing.
  if (transport === "tmux" || ("bd" !== transport)) return true;
  switch (transport) {
    case "hc":
      return false;
    default:
      return transport != "TMUX";
  }
}

export function idioms(n: number, d: Date, o: object): string {
  const key = "__proto__";
  const has = Object.prototype.hasOwnProperty.call(o, key);
  return `${n.toString()} ${d.valueOf()} ${has} ${o.constructor.name} ${typeof herdr.exec}`;
}

export function constructorChecks(a: object, b: object): boolean {
  const proto = a.constructor.prototype;
  return a.constructor === b.constructor || a.constructor !== Date || proto === undefined;
}

export class Child extends Error {
  constructor() {
    super("x");
  }
}
