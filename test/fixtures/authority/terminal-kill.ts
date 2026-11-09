import * as herdr from "herdr";

export function stop(terminal: string) {
  herdr.run("terminal.kill", { terminal });
}
