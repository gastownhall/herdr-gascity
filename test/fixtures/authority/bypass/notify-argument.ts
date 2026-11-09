import * as herdr from "herdr";

const toastSpec = { title: "x", action: { name: "app.reset" } };
export const toast = () => herdr.notify(toastSpec);
