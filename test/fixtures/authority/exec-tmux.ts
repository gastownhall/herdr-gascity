import * as herdr from "herdr";

export async function killSession(name: string) {
  return herdr.exec("tmux", ["kill-session", "-t", name]);
}
