import * as herdr from "herdr";

const action = { name: "space.close" };
export const toast = () => herdr.notify({ title: "x", action });
