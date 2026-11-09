import * as herdr from "herdr";

export const any = (v: string) => herdr.run(`${"terminal"}.${v}`, {});
