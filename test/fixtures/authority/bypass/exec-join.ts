import * as herdr from "herdr";

export const ls = () => herdr.exec(["h", "c"].join(""), ["ls"]);
