// Self-tests for the bun harness: the element recorder and the module loader
// must be trustworthy before render tests lean on them.

import { describe, expect, test } from "bun:test";
import {
  callsTo, element, evaluateModule, fakeContext, fakeGpui, fakeHerdr, findById, moduleBody, nodeOf, textOf,
} from "../harness.ts";

describe("element recorder", () => {
  test("records ids, text and nested children in order", () => {
    const root = element().id("root").child("a").children([element().id("x").child("b"), "c"]);
    const node = nodeOf(root);
    expect(node.id).toBe("root");
    expect(textOf(node)).toBe("a b c");
    expect(findById(node, "x")?.children).toEqual(["b"]);
    expect(findById(node, "missing")).toBeUndefined();
  });

  test("when() applies its builder only when the condition holds", () => {
    const node = nodeOf(element().when(true, (el: any) => el.child("yes")).when(false, (el: any) => el.child("no")));
    expect(textOf(node)).toBe("yes");
  });

  test("records handlers and every builder call with its arguments", () => {
    const click = () => "clicked";
    const node = nodeOf(element().id("b").text_color("#fff").on_click(click));
    expect(node.handlers.on_click).toBe(click);
    expect(callsTo(node, "text_color")).toEqual([["#fff"]]);
  });
});

describe("module loader", () => {
  test("rewrites namespace, named (aliased, multi-line) and default host imports", () => {
    const source = [
      'import * as herdr from "herdr";',
      'import {',
      '  View,',
      '  div as box',
      '} from "gpui-kit";',
      'import base from "gpui-base";',
      'var Mod = class extends View { render() { return box().child(herdr.theme().foreground + base.tag); } };',
      'export {',
      '  Mod as default',
      '};',
    ].join("\n");
    const Mod = evaluateModule(source, {
      ...fakeGpui(),
      herdr: fakeHerdr().module,
      "gpui-base": { default: { tag: "!" } },
    });
    expect(textOf(nodeOf(new Mod().render(fakeContext())))).toBe("#foreground!");
  });

  test("accepts `export default class`", () => {
    const Mod = evaluateModule('import { View } from "gpui-kit";\nexport default class M extends View { x() { return 1; } }', fakeGpui());
    expect(new Mod().x()).toBe(1);
  });

  test("rejects import and export shapes it does not understand", () => {
    expect(() => moduleBody('import "side-effect";\nexport default class M {}')).toThrow("unsupported import shape");
    expect(() => moduleBody("export const x = 1;\nexport default class M {}")).toThrow("unsupported export shape");
    expect(() => moduleBody("const x = 1;")).toThrow("no default export");
  });

  test("fails loudly when a host module has no fake", () => {
    expect(() => evaluateModule('import { exec } from "herdr";\nexport default class M {}', fakeGpui()))
      .toThrow('no fake for host module "herdr"');
  });

  test("the fake herdr module records calls and can omit exports", () => {
    const { module, calls } = fakeHerdr({ props: { city: "c1" }, omit: ["theme"] });
    expect(module.theme).toBeUndefined();
    expect((module.props as () => unknown)()).toEqual({ city: "c1" });
    expect(calls).toEqual([{ name: "props", args: [] }]);
  });
});
