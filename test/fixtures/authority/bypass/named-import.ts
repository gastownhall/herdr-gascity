import { run } from "herdr";

export const kill = (terminal: string) => run("tab.close", { terminal });
