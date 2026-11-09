// Render tests for the built bundle (`gascity/main.js`) through the fake
// herdr / gpui-kit host modules.

import { expect, test } from "bun:test";
import { callsTo, findById, loadMod, textOf, FAKE_THEME } from "../harness.ts";

test("the placeholder panel renders through the fake host", async () => {
  const mod = await loadMod();
  mod.init();
  const root = mod.render();
  expect(root.id).toBe("gascity-root");
  expect(textOf(findById(root, "gascity-title")!)).toBe("Gas City");
  expect(textOf(findById(root, "gascity-placeholder")!)).toBe(
    "No city data yet: this build of the mod does not connect to gc.",
  );
  expect(findById(root, "gascity-host-incompatible")).toBeUndefined();
});

test("the panel takes its colours from the herdr theme", async () => {
  const mod = await loadMod();
  mod.init();
  const root = mod.render();
  expect(callsTo(root, "bg")).toEqual([[FAKE_THEME.background]]);
  expect(callsTo(root, "text_color")).toEqual([[FAKE_THEME.foreground]]);
  expect(callsTo(findById(root, "gascity-placeholder")!, "text_color")).toEqual([[FAKE_THEME.muted]]);
});

test("rendering only reads the theme: no other host call", async () => {
  const mod = await loadMod();
  mod.init();
  mod.render();
  mod.render();
  expect(new Set(mod.herdrCalls.map((c) => c.name))).toEqual(new Set(["theme"]));
});

test("a herdr-app without a required export gets a visible banner, not a load failure", async () => {
  const mod = await loadMod({ omit: ["theme"] });
  mod.init();
  const root = mod.render();
  expect(textOf(findById(root, "gascity-host-incompatible")!)).toBe(
    "This herdr-app is too old for the Gas City mod: it lacks theme.",
  );
  expect(findById(root, "gascity-placeholder")).toBeUndefined();
  expect(callsTo(root, "bg")).toEqual([]);
});

test("mod.json is valid (herdr-app silently ignores an invalid one) and is not auto-docked", async () => {
  const hint = JSON.parse(await Bun.file(new URL("../../gascity/mod.json", import.meta.url)).text());
  expect(hint).toEqual({ place: "none", title: "Gas City" });
});

test("a theme colour that is not #rgb/#rrggbb/#rrggbbaa is reported, not drawn", async () => {
  const mod = await loadMod({ theme: { ...FAKE_THEME, muted: "rgb(1, 2, 3)" } });
  mod.init();
  const root = mod.render();
  expect(textOf(findById(root, "gascity-host-decode")!)).toBe(
    'herdr theme colour "muted" is not a #rgb, #rrggbb or #rrggbbaa value: rgb(1, 2, 3)',
  );
  expect(callsTo(findById(root, "gascity-placeholder")!, "text_color")).toEqual([]);
  expect(callsTo(root, "bg")).toEqual([[FAKE_THEME.background]]);
});

test("a theme without a colour the panel uses is reported", async () => {
  const { background: _, ...theme } = FAKE_THEME;
  const mod = await loadMod({ theme });
  mod.init();
  const root = mod.render();
  expect(textOf(findById(root, "gascity-host-decode")!)).toBe('herdr theme has no colour "background"');
  expect(callsTo(root, "bg")).toEqual([]);
});

test("a complete theme reports nothing", async () => {
  const mod = await loadMod();
  mod.init();
  expect(findById(mod.render(), "gascity-host-decode")).toBeUndefined();
});
