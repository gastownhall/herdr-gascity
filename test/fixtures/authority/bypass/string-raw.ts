import * as herdr from "herdr";

export const ls = () => herdr.exec(String.raw`h${""}c`, ["ls"]);
