// Host data the mod reads from herdr-app (design §4 host.schemas.ts): the
// fields of terminals(), panes(), spaces() and focused() the mod relies on,
// decoded so a herdr-app change becomes a visible host-decode error instead
// of `any` flowing into the view-model. Shapes from herdr-app v0.1.14
// defaults/herdr.d.ts and src/window.rs terminals_listed (hc ls --json records
// plus `program`).

import { describe, expect, test } from "bun:test";
import { decodeFocused, decodePanes, decodeSpaces, decodeTerminals } from "../../src/host.schemas.ts";

const TERMINAL = {
  address: "t7",
  argv: ["env", "-u", "HC_SCOPE", "gc", "--city", "/c", "session", "attach", "s-1"],
  labels: { "herdr.space": "s1", "herdr.tab": "t2" },
  cwd: "/home/me",
  state: "live",
  created_ms: 1,
  status: null,
  report: null,
  program: { key: "program", name: "gc", icon: null, tint: false, tile: null, color: null, shell: false, agent: false },
};

describe("terminals()", () => {
  test("decodes the fields the mod reads and ignores the rest", () => {
    const r = decodeTerminals([TERMINAL]);
    expect(r).toEqual({
      ok: true,
      value: {
        items: [{ address: "t7", argv: TERMINAL.argv, labels: TERMINAL.labels, state: "live", program: { shell: false } }],
        errors: [],
      },
    });
  });

  test("a new terminal state is unrecognized, not fatal", () => {
    const r = decodeTerminals([{ ...TERMINAL, state: "parked" }]);
    expect(r.ok && r.value.items[0]?.state).toEqual({ kind: "unrecognized", raw: "parked" });
  });

  test("a bad entry is a host-decode error; the other entries still decode", () => {
    const r = decodeTerminals([{ ...TERMINAL, program: { key: "shell" } }, TERMINAL]);
    expect(r.ok && r.value.items.map((t) => t.address)).toEqual(["t7"]);
    expect(r.ok && r.value.errors).toEqual([
      { kind: "host-decode", api: "terminals", path: "[0].program.shell", issues: ["[0].program.shell: missing required boolean"] },
    ]);
  });

  test("not an array -> host-decode error for the whole call", () => {
    expect(decodeTerminals(undefined)).toEqual({
      ok: false, error: { kind: "host-decode", api: "terminals", path: "", issues: ["(root): missing required array"] },
    });
  });
});

describe("panes()", () => {
  test("terminal panes and mod panes", () => {
    const r = decodePanes([
      { pane: "p1", terminal: "t7", tab: "t2", title: "zsh", cwd: null, branch: null, status: null, app: null, program: {}, focused: true, zoomed: false, movable: true },
      { pane: "p2", terminal: null, mod: "gascity", tab: "t2", title: "Gas City", focused: false, zoomed: false },
    ]);
    expect(r.ok && r.value.items).toEqual([
      { pane: "p1", terminal: "t7", tab: "t2" },
      { pane: "p2", terminal: null, mod: "gascity", tab: "t2" },
    ]);
  });
});

describe("spaces()", () => {
  test("id, machine (null = this computer), active and tab ids", () => {
    const r = decodeSpaces([
      { id: "s1", index: 1, name: "home", named: false, folder: "", machine: null, branch: null, active: true, status: null,
        tabs: [{ id: "t2", index: 1, name: "1", named: false, active: true, status: null, panes: 1, zoomed: false, settled: false, settled_at: null, changed_at: null }] },
      { id: "box/s3", machine: "box", active: false, tabs: [] },
    ]);
    expect(r.ok && r.value.items).toEqual([
      { id: "s1", machine: null, active: true, tabs: [{ id: "t2", active: true }] },
      { id: "box/s3", machine: "box", active: false, tabs: [] },
    ]);
  });

  test("a missing machine is an error, not silently local", () => {
    const r = decodeSpaces([{ id: "s1", active: true, tabs: [] }]);
    expect(r.ok && r.value.errors[0]?.path).toBe("[0].machine");
  });
});

describe("focused()", () => {
  test("space and tab, or null", () => {
    expect(decodeFocused({ space: "s1", tab: "t2", pane: null, terminal: null, shown: null, agent: null, cwd: null }))
      .toEqual({ ok: true, value: { space: "s1", tab: "t2" } });
    expect(decodeFocused(null)).toEqual({ ok: true, value: null });
    expect(decodeFocused({ space: "s1" })).toEqual({
      ok: false, error: { kind: "host-decode", api: "focused", path: "tab", issues: ["tab: missing required string"] },
    });
  });
});
