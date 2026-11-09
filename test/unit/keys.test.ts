// The key map of a focused copy (src/keys.ts).

import { describe, expect, test } from "bun:test";
import { KEY_MAP, keyAction, moveIn } from "../../src/keys.ts";

describe("keys", () => {
  test("the map, and keys the copy leaves alone", () => {
    expect(KEY_MAP).toEqual({ j: "next-session", down: "next-session", k: "prev-session", up: "prev-session", r: "refresh", t: "open-terminal", escape: "back" });
    expect(keyAction("j")).toBe("next-session");
    expect(keyAction("ctrl-j")).toBeNull();
    expect(keyAction("toString")).toBeNull();
    expect(keyAction("")).toBeNull();
  });

  test("moving through the sessions wraps, and starts at an end when none is open", () => {
    const order = ["a", "b", "c"];
    expect(moveIn(order, null, 1)).toBe("a");
    expect(moveIn(order, null, -1)).toBe("c");
    expect(moveIn(order, "a", 1)).toBe("b");
    expect(moveIn(order, "c", 1)).toBe("a");
    expect(moveIn(order, "a", -1)).toBe("c");
    expect(moveIn(order, "gone", 1)).toBe("a");
    expect(moveIn([], "a", 1)).toBeNull();
  });
});
