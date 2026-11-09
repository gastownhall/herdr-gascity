import { run } from "herdr";

export function stop(terminal: string) {
  run("terminal.kill", { terminal });
}
