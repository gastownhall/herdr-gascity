import { describe, expect, test } from "bun:test";
import { NARROW_BELOW_PX, SIDE_BY_SIDE_FROM_PX, panelLayout } from "../../../src/vm/layout.ts";

describe("panelLayout", () => {
  test("unknown width: stacked", () => {
    expect(panelLayout(null)).toBe("stacked");
  });

  test("the thresholds", () => {
    expect(panelLayout(SIDE_BY_SIDE_FROM_PX)).toBe("side-by-side");
    expect(panelLayout(SIDE_BY_SIDE_FROM_PX - 1)).toBe("stacked");
    expect(panelLayout(NARROW_BELOW_PX)).toBe("stacked");
    expect(panelLayout(NARROW_BELOW_PX - 1)).toBe("narrow");
  });

  test("the pane of a 1280 px window is stacked; a full-width pane on a wide screen is side by side", () => {
    expect(panelLayout(994)).toBe("stacked");
    expect(panelLayout(1800)).toBe("side-by-side");
  });

  test("a width that is not a finite positive number is unknown", () => {
    for (const w of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) expect(panelLayout(w)).toBe("stacked");
  });
});
