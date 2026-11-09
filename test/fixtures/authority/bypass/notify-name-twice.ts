import * as herdr from "herdr";

export const toast = () => herdr.notify({ title: "x", action: { name: "mod.open", ["name"]: "app.reset" } });
