import * as herdr from "herdr";

const run = herdr.run;
export const kill = (terminal: string) => run("terminal.kill", { terminal });
