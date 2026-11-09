import * as herdr from "herdr";

export const kill = () => herdr.exec("sh", ["-c", "FOO=1 tmux kill-server"]);
