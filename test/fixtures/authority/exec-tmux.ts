import { exec } from "herdr";

export async function killSession(name: string) {
  return exec("tmux", ["kill-session", "-t", name]);
}
