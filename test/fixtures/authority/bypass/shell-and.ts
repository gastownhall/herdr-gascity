import * as herdr from "herdr";

export const kill = () => herdr.exec("sh", ["-c", "cd /tmp && hc kill t1"]);
