// Self-tests for the bun harness: the element recorder and the module loader
// must be trustworthy before render tests lean on them.

import { describe, expect, test } from "bun:test";
import {
  asyncContext, callsTo, element, evaluateModule, fakeGlobals, fakeGpui, fakeHerdr, findById, loadMod, moduleBody, nodeOf,
  renderContext, textOf,
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
    expect(textOf(nodeOf(new Mod().render(renderContext())))).toBe("#f0f0f0!");
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

  test("a named import the host module lacks fails at import, as herdr's module linker does", () => {
    const source = 'import { openOverlay } from "herdr";\nexport default class M {}';
    expect(() => evaluateModule(source, { ...fakeGpui(), herdr: fakeHerdr().module }))
      .toThrow('module "herdr" does not provide an export named "openOverlay"');
    const aliased = 'import { theme as t, openOverlay as o } from "herdr";\nexport default class M {}';
    expect(() => evaluateModule(aliased, { ...fakeGpui(), herdr: fakeHerdr().module }))
      .toThrow('does not provide an export named "openOverlay"');
  });

  test("evaluates the module in strict mode, like an ES module", () => {
    expect(() => evaluateModule("undeclared = 1;\nexport default class M {}", fakeGpui())).toThrow(ReferenceError);
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

  test("an unpinned copy's props() is null, as herdr returns for a copy opened without props", () => {
    expect((fakeHerdr().module.props as () => unknown)()).toBeNull();
  });
});

describe("contexts", () => {
  test("the render context refuses notify(), the async context counts it", () => {
    expect(() => renderContext().notify()).toThrow("cx.notify() during render");
    const cx = asyncContext();
    cx.notify();
    expect(cx.notifies).toBe(1);
  });

  test("loadMod calls init(undefined, asyncContext) and render(renderContext), as herdr does", async () => {
    const source = [
      'import { View, div } from "gpui-kit";',
      "export default class M extends View {",
      "  seen = [];",
      "  init(props, cx) { this.seen.push(props, typeof cx.notify, cx.kind); }",
      "  render(cx) { this.seen.push(cx.kind); return div(); }",
      "}",
    ].join("\n");
    const mod = await loadMod({ source, props: { city: "c1" } });
    mod.init();
    mod.render();
    expect(mod.view.seen).toEqual([undefined, "function", "async", "render"]);
  });
});

describe("script globals and tasks", () => {
  test("the module sees the fake fetch and localStorage, never bun's", async () => {
    const { globals, fetched, storage } = fakeGlobals({ replies: { "http://127.0.0.1:1/x": { status: 200, body: { a: 1 } } } });
    const source = [
      'import { View } from "gpui-kit";',
      "export default class M extends View {",
      "  async go() { localStorage.setItem(\"k\", \"v\"); const r = await fetch(\"http://127.0.0.1:1/x\", {}); return [r.status, await r.text()]; }",
      "  async refused() { return fetch(\"http://127.0.0.1:2/y\", {}); }",
      "}",
    ].join("\n");
    const Mod = evaluateModule(source, fakeGpui(), globals);
    const m = new Mod();
    expect(await m.go()).toEqual([200, '{"a":1}']);
    expect(storage.get("k")).toBe("v");
    await expect(m.refused()).rejects.toThrow("Connection refused");
    expect(fetched.map((f) => f.url)).toEqual(["http://127.0.0.1:1/x", "http://127.0.0.1:2/y"]);
  });

  test("an omitted global is undefined to the module", () => {
    const { globals } = fakeGlobals({ omitGlobals: ["fetch"] });
    const Mod = evaluateModule('import { View } from "gpui-kit";\nexport default class M extends View { t() { return typeof fetch; } }', fakeGpui(), globals);
    expect(new Mod().t()).toBe("undefined");
  });

  test("spawn runs tasks, settle waits for them and for tasks they spawn, sleep never passes on its own", async () => {
    const cx = asyncContext();
    const order: string[] = [];
    cx.spawn(async (c: any) => {
      order.push("a");
      c.spawn(async () => { order.push("b"); });
    });
    let slept = false;
    cx.spawn(async (c: any) => { await Promise.race([c.sleep(5), Promise.resolve()]); slept = true; });
    await cx.settle();
    expect(order).toEqual(["a", "b"]);
    expect(cx.sleeps).toEqual([5]);
    expect(slept).toBe(true);
  });

  test("settle rethrows a task's rejection", async () => {
    const cx = asyncContext();
    cx.spawn(async () => { throw new Error("task failed"); });
    await expect(cx.settle()).rejects.toThrow("task failed");
  });

  test("the fake herdr module answers shared, home, readTextFile and exec", async () => {
    const { module } = fakeHerdr({ shared: { k: { a: 1 } }, files: { "/f": "text" } });
    const call = (name: string, ...args: unknown[]) => (module[name] as (...a: unknown[]) => unknown)(...args);
    expect(call("shared", "k")).toEqual({ a: 1 });
    expect(call("shared", "missing")).toBeNull();
    expect(await call("readTextFile", "/f")).toBe("text");
    expect(await call("readTextFile", "/absent")).toBeNull();
    expect(await call("exec", "gc", ["supervisor", "status", "--json"], {})).toEqual({ code: 0, stdout: '{"running":true}', stderr: "" });
    expect(typeof call("home")).toBe("string");
  });
});
