import * as herdr from "herdr";

export async function listTerminals() {
  return herdr.hc(["ls", "--json"]);
}
