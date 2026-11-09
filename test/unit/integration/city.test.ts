// The scratch city's isolation and its config files.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CITY_TEMPLATE, cityToml, RUN_MARKER, scratchEnv, supervisorToml } from "../../../canary/city.ts";

describe("scratchEnv", () => {
  const env = scratchEnv({ root: "/r", runId: "abc", gcBin: "/opt/gc/bin/gc", path: ["/x"] }, {
    PATH: "/usr/bin", TMUX: "/tmp/tmux-1/default,1,0", TMUX_PANE: "%1", HC_SCOPE: "s", GC_CITY: "/live", GC_HOME: "/home/me/.gc",
    XDG_RUNTIME_DIR: "/run/user/1", HERDR_APP_HOME: "/h", LANG: "C.UTF-8",
  });

  test("drops the caller's tmux, herdr, gc and XDG variables", () => {
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
    expect(env.HC_SCOPE).toBeUndefined();
    expect(env.GC_CITY).toBeUndefined();
    expect(env.HERDR_APP_HOME).toBeUndefined();
    expect(env.LANG).toBe("C.UTF-8");
  });

  test("puts home, gc, XDG and tmux's socket directory under the root, and marks the run", () => {
    expect(env.HOME).toBe("/r/home");
    expect(env.GC_HOME).toBe("/r/home/.gc");
    expect(env.XDG_RUNTIME_DIR).toBe("/r/run");
    expect(env.TMUX_TMPDIR).toBe("/r/tmux");
    expect(env.PATH).toBe("/opt/gc/bin:/x:/usr/bin");
    expect(env[RUN_MARKER]).toBe("abc");
  });
});

describe("config files", () => {
  test("the city template takes exactly its placeholders", () => {
    const template = readFileSync(CITY_TEMPLATE, "utf8");
    const toml = cityToml(template, { SOCKET: "canary-1", PACK_DIR: "/p/canary/pack", API_URL: "http://127.0.0.1:1", CITY: "canary" });
    expect(toml).not.toContain("@");
    expect(toml).toContain('socket = "canary-1"');
    expect(toml).toContain('provider = "file"');
    expect(toml).toContain('CANARY_API_URL = "http://127.0.0.1:1", CANARY_CITY = "canary"');
    expect(() => cityToml("@NOPE@", { SOCKET: "", PACK_DIR: "", API_URL: "", CITY: "" })).toThrow("no value for @NOPE@");
  });

  test("supervisor.toml per mode", () => {
    expect(supervisorToml(1, { kind: "loopback" })).toBe('[supervisor]\nport = 1\nbind = "127.0.0.1"\n');
    expect(supervisorToml(1, { kind: "write-grants", verifyKey: "k:AA==" })).toContain('write_auth_required = true\nwrite_auth_verify_key = "k:AA=="');
    expect(supervisorToml(1, { kind: "any-interface" })).toContain('bind = "0.0.0.0"');
  });
});
