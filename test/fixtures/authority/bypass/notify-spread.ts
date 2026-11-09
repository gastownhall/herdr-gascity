import * as herdr from "herdr";

const rest = { action: { name: "app.reset" } };
export const toast = () => herdr.notify({ title: "x", ...rest });
