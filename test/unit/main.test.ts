// Render tests for the built bundle (`gascity/main.js`) through the fake
// herdr / gpui-kit host modules and script globals: discovery, the city state
// machine and the header, as a copy of the mod runs them.

import { describe, expect, test } from "bun:test";
import { FAKE_HOME, FAKE_THEME, callsTo, findById, loadMod, textOf, type FakeReply } from "../harness.ts";

const HEALTH = { status: "ok", version: "1.4.0", uptime_sec: 9, cities_total: 2, cities_running: 1 };
const DEFAULT = "http://127.0.0.1:8372";
const CONFIG = `${FAKE_HOME}/.gc/supervisor.toml`;
const city = (name: string, running: boolean, status?: string) => ({ name, path: `/cities/${name}`, running, ...(status ? { status } : {}) });

/** gc answering at `base` with these cities. */
function gcAt(base: string, cities: unknown[]): Record<string, FakeReply> {
  return {
    [`${base}/health`]: { status: 200, body: HEALTH },
    [`${base}/v0/cities`]: { status: 200, body: { items: cities, total: cities.length } },
  };
}

async function started(options: Parameters<typeof loadMod>[0] = {}) {
  const mod = await loadMod(options);
  mod.init();
  await mod.settle();
  return mod;
}

const text = (root: ReturnType<Awaited<ReturnType<typeof loadMod>>["render"]>, id: string) => {
  const node = findById(root, id);
  return node ? textOf(node) : undefined;
};

describe("connected", () => {
  test("the only running city is shown, with the gc version, URL and where the URL came from", async () => {
    const mod = await started({ replies: gcAt(DEFAULT, [city("alpha", true), city("beta", false, "stopped")]) });
    const root = mod.render();
    expect(root.id).toBe("gascity-root");
    expect(text(root, "gascity-title")).toBe("Gas City");
    expect(text(root, "gascity-chip")).toBe("connected");
    expect(text(root, "gascity-endpoint")).toBe("gc 1.4.0 at http://127.0.0.1:8372 (from built-in default)");
    expect(text(root, "gascity-city")).toBe("City: alpha");
    expect(text(root, "gascity-others")).toBe("Other cities: beta (stopped)");
    expect(mod.cx.notifies).toBe(3);
  });

  test("discovery asks gc for its URL and reads ~/.gc/supervisor.toml before the default", async () => {
    const mod = await started({ replies: gcAt(DEFAULT, [city("alpha", true)]) });
    const calls = mod.herdrCalls.filter((c) => c.name === "exec" || c.name === "readTextFile");
    expect(calls).toEqual([
      { name: "exec", args: ["gc", ["supervisor", "status", "--json"], { timeout: 10_000 }] },
      { name: "readTextFile", args: [CONFIG] },
    ]);
    expect(mod.fetched.map((f) => f.url)).toEqual([`${DEFAULT}/health`, `${DEFAULT}/v0/cities`]);
    // Connected: the header names only the endpoint and its source; every candidate tried is in the drawer.
    const root = mod.render();
    expect(text(root, "gascity-endpoint")).toBe("gc 1.4.0 at http://127.0.0.1:8372 (from built-in default)");
    expect(findById(root, "gascity-diagnostics")).toBeUndefined();
    expect(text(root, "gascity-diagnostics-drawer")).toBeUndefined();
    mod.click("gascity-diagnostics-toggle");
    expect(text(mod.render(), "gascity-diagnostics-drawer")).toBe([
      "Hide diagnostics (4)",
      "discovery: apiUrl setting: no apiUrl setting",
      "discovery: gc supervisor status: gc supervisor status --json reports no api_url",
      `discovery: ~/.gc/supervisor.toml: ${CONFIG} does not exist`,
      "discovery: built-in default: http://127.0.0.1:8372 ok (gc 1.4.0)",
    ].join(" "));
  });

  test("gc not found: the candidates tried are listed in the header", async () => {
    const mod = await started();
    expect(text(mod.render(), "gascity-diagnostics")).toBe([
      "Discovery:",
      "apiUrl setting: no apiUrl setting",
      "gc supervisor status: gc supervisor status --json reports no api_url",
      `~/.gc/supervisor.toml: ${CONFIG} does not exist`,
      "built-in default: http://127.0.0.1:8372 unreachable: cannot reach http://127.0.0.1:8372/health: error sending request: Connection refused (os error 111)",
    ].join(" "));
  });

  test("the shared apiUrl setting wins, and gcBin comes from the same shared settings", async () => {
    const execs: string[] = [];
    const mod = await started({
      shared: { "gascity.settings": { apiUrl: "http://localhost:9443", gcBin: "/opt/gc/bin/gc" } },
      exec: (command) => {
        execs.push(command);
        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
      },
      replies: { ...gcAt("http://localhost:9443", [city("alpha", true)]), ...gcAt(DEFAULT, [city("other", true)]) },
    });
    expect(text(mod.render(), "gascity-endpoint")).toBe("gc 1.4.0 at http://localhost:9443 (from apiUrl setting)");
    expect(execs).toEqual([]);
    expect(mod.herdrCalls.filter((c) => c.name === "shared")).toEqual([{ name: "shared", args: ["gascity.settings"] }]);
  });

  test("supervisor.toml's port is used when gc does not report a URL", async () => {
    const mod = await started({
      files: { [CONFIG]: "[supervisor]\nport = 9100\n" },
      replies: gcAt("http://127.0.0.1:9100", [city("alpha", true)]),
    });
    expect(text(mod.render(), "gascity-endpoint")).toBe("gc 1.4.0 at http://127.0.0.1:9100 (from ~/.gc/supervisor.toml)");
  });

  test("gc's reported URL is used when gc prints one", async () => {
    const mod = await started({
      exec: () => Promise.resolve({ code: 0, stdout: '{"api_url":"http://127.0.0.1:9200"}', stderr: "" }),
      replies: gcAt("http://127.0.0.1:9200", [city("alpha", true)]),
    });
    expect(text(mod.render(), "gascity-endpoint")).toBe("gc 1.4.0 at http://127.0.0.1:9200 (from gc supervisor status)");
  });
});

describe("errors are states shown in the header", () => {
  test("gc not reachable: the chip names the URL and source, with Retry now", async () => {
    const mod = await started();
    const root = mod.render();
    expect(text(root, "gascity-chip")).toBe("gc not reachable at http://127.0.0.1:8372 (built-in default)");
    expect(text(root, "gascity-retry")).toBe("Retry now");
    expect(findById(root, "gascity-endpoint")).toBeUndefined();
  });

  test("a non-loopback apiUrl is refused before any request", async () => {
    const mod = await started({ shared: { "gascity.settings": { apiUrl: "http://192.168.1.4:8372" } }, replies: gcAt(DEFAULT, [city("a", true)]) });
    expect(mod.fetched).toEqual([]);
    expect(text(mod.render(), "gascity-chip")).toBe(
      "refusing http://192.168.1.4:8372 (apiUrl setting): only a loopback gc API (http://127.0.0.1, localhost or [::1] with a port) is allowed",
    );
  });

  test("a malformed supervisor.toml is shown, and the default is not guessed", async () => {
    const mod = await started({ files: { [CONFIG]: "[supervisor]\nport = 9100.5\n" }, replies: gcAt(DEFAULT, [city("a", true)]) });
    expect(mod.fetched).toEqual([]);
    expect(text(mod.render(), "gascity-chip")).toBe(
      `cannot use ~/.gc/supervisor.toml: ${CONFIG} line 2: port must be a whole number from 0 to 65535, written in decimal: 9100.5`,
    );
  });

  test("a gcBin that is not gc is never run", async () => {
    const mod = await started({ shared: { "gascity.settings": { gcBin: "/usr/bin/tmux" } } });
    expect(mod.herdrCalls.some((c) => c.name === "exec")).toBe(false);
    expect(text(mod.render(), "gascity-chip")).toMatch(/^cannot use gascity.settings: unreadable shared\("gascity.settings"\) at gcBin: gcBin: must be "gc" or an absolute path to a program named gc, not "\/usr\/bin\/tmux"$/);
  });

  test("gc too old for /v0/cities", async () => {
    const mod = await started({
      replies: { [`${DEFAULT}/health`]: { status: 200, body: HEALTH }, [`${DEFAULT}/v0/cities`]: { status: 404, body: "404 page not found" } },
    });
    expect(text(mod.render(), "gascity-chip")).toBe("gc too old (needs get-v0-cities)");
  });

  test("Retry now rediscovers", async () => {
    const replies: Record<string, FakeReply> = {};
    const mod = await started({ replies });
    expect(text(mod.render(), "gascity-chip")).toMatch(/^gc not reachable/);
    Object.assign(replies, gcAt(DEFAULT, [city("alpha", true)]));
    mod.click("gascity-retry");
    await mod.settle();
    expect(text(mod.render(), "gascity-chip")).toBe("connected");
  });
});

describe("pinned and unpinned copies", () => {
  test("a pinned copy shows its city even when stopped, and offers no switcher", async () => {
    const mod = await started({ props: { city: "beta" }, replies: gcAt(DEFAULT, [city("alpha", true), city("beta", false, "init_failed")]) });
    const root = mod.render();
    expect(text(root, "gascity-chip")).toBe("city stopped (init_failed)");
    expect(text(root, "gascity-city")).toBe("City: beta (pinned)");
    expect(findById(root, "gascity-choices")).toBeUndefined();
  });

  test("a copy pinned to a city gc does not know says so", async () => {
    const mod = await started({ props: { city: "ghost" }, replies: gcAt(DEFAULT, [city("alpha", true)]) });
    expect(text(mod.render(), "gascity-chip")).toBe('city "ghost" is not registered with gc at http://127.0.0.1:8372');
  });

  test("an unpinned copy with several running cities asks; a choice is shown and remembered in this copy's localStorage", async () => {
    const mod = await started({ replies: gcAt(DEFAULT, [city("alpha", true), city("beta", true)]) });
    let root = mod.render();
    expect(text(root, "gascity-chip")).toBe("choose a city");
    expect(text(root, "gascity-choices")).toBe("Choose a city: alpha (running) beta (running)");
    mod.click("gascity-choose-1");
    root = mod.render();
    expect(text(root, "gascity-chip")).toBe("connected");
    expect(text(root, "gascity-city")).toBe("City: beta");
    expect(text(root, "gascity-choices")).toBe("Switch to: alpha (running)");
    expect(mod.storage.get("city")).toBe("beta");
  });

  test("an unpinned copy reopens on its last selection", async () => {
    const mod = await started({ storage: { city: "beta" }, replies: gcAt(DEFAULT, [city("alpha", true), city("beta", true)]) });
    expect(text(mod.render(), "gascity-city")).toBe("City: beta");
  });

  test("a failure to remember the selection is a banner", async () => {
    const mod = await started({ storageThrows: "quota exceeded", replies: gcAt(DEFAULT, [city("alpha", true), city("beta", true)]) });
    mod.click("gascity-choose-0");
    expect(text(mod.render(), "gascity-banner-0")).toBe('Herdr: localStorage.setItem("city") failed: quota exceeded.');
  });

  test("props that are not readable make a visible error, not a guess", async () => {
    const mod = await started({ props: { city: 7 } });
    expect(text(mod.render(), "gascity-copy-invalid")).toBe(
      "This copy of the Gas City mod was opened with props it cannot read: unreadable props() at city: city: expected a non-empty string, got 7",
    );
    expect(mod.fetched).toEqual([]);
  });
});

describe("the host", () => {
  test("rendering reads only the theme: no other host call, no fetch", async () => {
    const mod = await started({ replies: gcAt(DEFAULT, [city("alpha", true)]) });
    const before = { herdr: mod.herdrCalls.length, fetched: mod.fetched.length };
    mod.render();
    mod.render();
    expect(mod.herdrCalls.slice(before.herdr).map((c) => c.name)).toEqual(["theme", "theme"]);
    expect(mod.fetched.length).toBe(before.fetched);
  });

  test("a herdr-app without a required export or global gets a visible banner, not a load failure", async () => {
    const mod = await started({ omit: ["theme", "exec"], omitGlobals: ["localStorage"] });
    const root = mod.render();
    expect(text(root, "gascity-host-incompatible")).toBe("This herdr-app is too old for the Gas City mod: it lacks theme, exec, localStorage.");
    expect(findById(root, "gascity-chip")).toBeUndefined();
    expect(callsTo(root, "bg")).toEqual([]);
    expect(mod.fetched).toEqual([]);
  });

  test("mod.json is valid (herdr-app silently ignores an invalid one), is not auto-docked, takes the keyboard, and opens the window", async () => {
    const hint = JSON.parse(await Bun.file(new URL("../../gascity/mod.json", import.meta.url)).text());
    expect(hint).toEqual({
      place: "none", title: "Gas City", focusable: true, overlay: { kind: "window", key: "gascity", width: 0.5, height: 0.6 },
    });
  });

  test("the keys.json fragment binds an app command (mod.open), which works while every copy is hidden", async () => {
    const keys = JSON.parse(await Bun.file(new URL("../../gascity/keys.json", import.meta.url)).text());
    expect(keys).toEqual({ global: { "ctrl-alt-g": "mod.open:gascity" } });
  });
});

describe("theme", () => {
  test("the panel takes its colours from the herdr theme", async () => {
    const mod = await started({ replies: gcAt(DEFAULT, [city("alpha", true)]) });
    const root = mod.render();
    expect(callsTo(root, "bg")).toEqual([[FAKE_THEME.background]]);
    expect(callsTo(root, "text_color")).toEqual([[FAKE_THEME.foreground]]);
    expect(callsTo(findById(root, "gascity-endpoint")!, "text_color")).toEqual([[FAKE_THEME.muted]]);
  });

  test("a theme colour that is not #rgb/#rrggbb/#rrggbbaa is reported, not drawn", async () => {
    const mod = await started({ theme: { ...FAKE_THEME, muted: "rgb(1, 2, 3)" }, replies: gcAt(DEFAULT, [city("alpha", true)]) });
    const root = mod.render();
    expect(text(root, "gascity-host-decode")).toBe('herdr theme colour "muted" is not a #rgb, #rrggbb or #rrggbbaa value: rgb(1, 2, 3)');
    expect(callsTo(findById(root, "gascity-endpoint")!, "text_color")).toEqual([]);
    expect(callsTo(root, "bg")).toEqual([[FAKE_THEME.background]]);
  });

  test("a theme without a colour the panel uses is reported", async () => {
    const { background: _, ...theme } = FAKE_THEME;
    const mod = await started({ theme });
    const root = mod.render();
    expect(text(root, "gascity-host-decode")).toBe('herdr theme has no colour "background"');
    expect(callsTo(root, "bg")).toEqual([]);
  });

  test("a complete theme reports nothing", async () => {
    const mod = await started();
    expect(findById(mod.render(), "gascity-host-decode")).toBeUndefined();
  });
});
