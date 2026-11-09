import * as herdr from "herdr";

const command = "tab" + ".close";
export const toast = () => herdr.notify({ title: "x", action: { name: command } });
