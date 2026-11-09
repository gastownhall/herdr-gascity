import * as herdr from "herdr";

export const kill = (terminal: string) => herdr.run(["terminal", "kill"].join("."), { terminal });
