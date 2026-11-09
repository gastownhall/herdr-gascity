import * as herdr from "herdr";

export function toast(id: string) {
  herdr.notify({ title: "done", action: { name: "space.close", args: { id } } });
}
