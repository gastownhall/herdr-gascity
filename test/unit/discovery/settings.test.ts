// Machine-wide settings live in herdr's shared store under one key, so every
// copy of the mod (pinned or not) sees the installer's values. Per-copy
// localStorage holds only UI state.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GC_BIN, SETTINGS_KEY, decodeSettings, gcBinIssue, patchSettings,
} from "../../../src/discovery/settings.ts";

const API = 'shared("gascity.settings")';

describe("decodeSettings", () => {
  test("the key is gascity.settings; nothing stored means the defaults", () => {
    expect(SETTINGS_KEY).toBe("gascity.settings");
    expect(DEFAULT_GC_BIN).toBe("gc");
    expect(decodeSettings(undefined)).toEqual({ ok: true, value: { apiUrl: null, gcBin: "gc" } });
    expect(decodeSettings(null)).toEqual({ ok: true, value: { apiUrl: null, gcBin: "gc" } });
    expect(decodeSettings({})).toEqual({ ok: true, value: { apiUrl: null, gcBin: "gc" } });
  });

  test("stored values; unknown keys are ignored", () => {
    expect(decodeSettings({ apiUrl: "http://127.0.0.1:9443", gcBin: "/opt/homebrew/bin/gc", later: 1 })).toEqual({
      ok: true, value: { apiUrl: "http://127.0.0.1:9443", gcBin: "/opt/homebrew/bin/gc" },
    });
  });

  test("an apiUrl is kept as written: the loopback guard runs when it is resolved, so its refusal names its source", () => {
    expect(decodeSettings({ apiUrl: "http://10.0.0.5:8372" })).toEqual({
      ok: true, value: { apiUrl: "http://10.0.0.5:8372", gcBin: "gc" },
    });
  });

  test("a malformed value is a host-decode error, never a silent default", () => {
    const cases: [unknown, string][] = [
      ["gc", ""],
      [[1], ""],
      [{ apiUrl: 8372 }, "apiUrl"],
      [{ gcBin: false }, "gcBin"],
      [{ gcBin: "" }, "gcBin"],
      [{ gcBin: "hc" }, "gcBin"],
      [{ gcBin: "bin/gc" }, "gcBin"],
      [{ apiUrl: "" }, "apiUrl"],
    ];
    for (const [raw, path] of cases) {
      const r = decodeSettings(raw);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.kind).toBe("host-decode");
      expect(r.error.api).toBe(API);
      expect(r.error.path).toBe(path);
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("gcBin: the only program discovery may run besides the dashboard opener", () => {
  test("gc on PATH, or an absolute path to a program named gc", () => {
    for (const ok of ["gc", "/opt/homebrew/bin/gc", "/home/me/go/bin/gc", "/Users/me/My Tools/gc"]) {
      expect(gcBinIssue(ok)).toBeNull();
    }
  });

  test("anything else is refused with a reason", () => {
    for (const bad of ["", "hc", "tmux", "bd", "/usr/bin/hc", "gc-dev", "./gc", "bin/gc", "/usr/bin/gc/", "gc --city x", "/tmp/a\ngc", "/usr/bin/gc\u0000"]) {
      expect(gcBinIssue(bad)).toMatch(/^must be "gc" or an absolute path to a program named gc, not /);
    }
  });
});

describe("patchSettings: what a settings command writes", () => {
  test("sets gcBin and keeps everything else, including keys this build does not know", () => {
    expect(patchSettings({ apiUrl: "http://127.0.0.1:9443", later: { x: 1 } }, { gcBin: "/usr/local/bin/gc" })).toEqual({
      ok: true, value: { apiUrl: "http://127.0.0.1:9443", later: { x: 1 }, gcBin: "/usr/local/bin/gc" },
    });
  });

  test("sets or clears apiUrl", () => {
    expect(patchSettings(undefined, { apiUrl: "http://localhost:9443/" })).toEqual({ ok: true, value: { apiUrl: "http://localhost:9443/" } });
    expect(patchSettings({ apiUrl: "http://localhost:9443", gcBin: "gc" }, { apiUrl: null })).toEqual({ ok: true, value: { gcBin: "gc" } });
  });

  test("refuses a non-loopback apiUrl before storing it", () => {
    expect(patchSettings({}, { apiUrl: "http://cherry.tail.ts.net:8444" })).toEqual({
      ok: false, error: { kind: "not-loopback", url: "http://cherry.tail.ts.net:8444" },
    });
  });

  test("refuses a gcBin that is not gc", () => {
    const r = patchSettings({}, { gcBin: "/usr/bin/tmux" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ kind: "host-decode", api: API, path: "gcBin" });
  });

  test("refuses to patch over a stored value that is not an object", () => {
    const r = patchSettings("garbage", { gcBin: "gc" });
    expect(!r.ok && r.error).toMatchObject({ kind: "host-decode", api: API, path: "" });
  });
});
