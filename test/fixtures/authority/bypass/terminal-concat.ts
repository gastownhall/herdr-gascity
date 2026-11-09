import * as herdr from "herdr";

const ns = "terminal";
export const kill = (terminal: string) => herdr.run(ns + ".kill", { terminal });
