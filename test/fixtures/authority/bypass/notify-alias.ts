import * as herdr from "herdr";

const post = herdr.notify;
export const toast = () => post({ title: "x", action: { name: "app.reset" } });
