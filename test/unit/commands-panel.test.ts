// Commands, keys and "needs you" toasts in the built bundle (gascity/main.js),
// through the fake herdr / gpui-kit modules (test/harness.ts):
//   - command/button parity: each mutating command sends exactly the request
//     its button sends and leaves the same entry in the activity log;
//   - destructive commands ask first unless they carry `confirm`;
//   - refusals are visible, cleaned, and change nothing;
//   - the bare `focus` command takes the keyboard; keys call the buttons'
//     methods; probe:on/off;
//   - toasts: one per new pending prompt, whose action opens the "needs you"
//     window (mod.open) while it is closed and is absent while it is open;
//     the window copy applies the newest shared focus target, so a toast
//     brings the session on screen even with the Gas City tab hidden.

import { describe, expect, test } from "bun:test";
import { findById, textOf, type FakeReply, type RecordedNode } from "../harness.ts";
import { gc, running, text } from "./panel-fixture.ts";
import { fixtureBody } from "./sync/fakes.ts";

type Req = { method: string; headers: Record<string, string>; body?: string };
type Mod = Awaited<ReturnType<typeof running>>;
type Copy = ReturnType<Mod["copy"]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROMPT = { supported: true, pending: { request_id: "perm-1", kind: "permission", prompt: "Run tests?", options: ["approve", "deny"] } };

/** gc as the panel fixture serves it, plus: POSTs answered by what they are, a pending prompt on sc-6, and a city pending list (mutable). */
function world() {
  const base = gc();
  const state = { cityPending: [] as { session_id: string; request_id: string; kind: string }[], sessions: null as unknown };
  const route = (url: string, req: Req): FakeReply | undefined => {
    const p = new URL(url).pathname;
    if (req.method === "POST") {
      if (p.endsWith("/beads")) return { status: 201, body: fixtureBody("create-bead", "ok") };
      if (p.endsWith("/sling")) return { status: 200, body: fixtureBody("post-v0-city-by-city-name-sling", "ok") };
      if (p.endsWith("/sessions")) return { status: 202, body: fixtureBody("create-session", "accepted") };
      if (p.endsWith("/submit") || p.endsWith("/messages")) return { status: 202, body: fixtureBody("submit-session", "accepted") };
      if (p.endsWith("/respond")) return { status: 202, body: fixtureBody("respond-session", "accepted") };
      return { status: 200, body: { status: "ok" } };
    }
    if (p.includes("/request/")) return { status: 200, body: fixtureBody("get-request-outcome", "session-submit") };
    if (p === "/v0/city/scratch/session/sc-6/pending") return { status: 200, body: PROMPT };
    if (p === "/v0/city/scratch/pending") return { status: 200, body: { items: state.cityPending, total: state.cityPending.length } };
    if (p === "/v0/city/scratch/sessions" && state.sessions !== null) return { status: 200, body: state.sessions };
    return base(url);
  };
  return { state, route };
}

/** The mutations a mod sent: method, path, query, body, and whether it carried a UUID Idempotency-Key. */
const mutations = (mod: Mod) => mod.fetched
  .filter((f) => (f.init as Req).method === "POST")
  .map((f) => {
    const init = f.init as Req;
    const u = new URL(f.url);
    const key = init.headers["Idempotency-Key"];
    return { path: u.pathname, query: u.search, body: init.body === undefined ? null : JSON.parse(init.body), key: key === undefined ? "none" : UUID.test(key) ? "uuid" : key };
  });

/** The activity log's rows as drawn. */
const activity = (mod: Mod) => {
  const node = findById(mod.render(), "gascity-activity");
  return node ? node.children.slice(1).map((c) => (typeof c === "string" ? c : textOf(c))) : [];
};

async function ticks(mod: Mod, n = 3, ms = 250) {
  for (let i = 0; i < n; i++) await mod.tick(ms);
}

async function openSession(mod: Mod) {
  mod.click("gascity-agent-0-1-session-0"); // frontend/builder's session sc-6
  await ticks(mod);
}

async function openBead(mod: Mod, card: string) {
  mod.click(card);
  await ticks(mod);
}

/** Runs `button` on one fresh copy and `command` on another; both must send the same requests and log the same entries. */
async function parity(button: (mod: Mod) => Promise<void>, command: string | string[]) {
  const a = await running({ route: world().route });
  await button(a);
  await ticks(a);
  const b = await running({ route: world().route });
  for (const c of typeof command === "string" ? [command] : command) {
    await b.command(c);
    await ticks(b);
  }
  const sent = mutations(a);
  expect(sent.length).toBeGreaterThan(0);
  expect(mutations(b)).toEqual(sent);
  expect(activity(b)).toEqual(activity(a));
  expect(text(b.render(), "gascity-notice")).toBeUndefined();
  return { a, b, sent };
}

describe("command/button parity: the same request and the same ledger entry", () => {
  for (const [key, verb] of [["wake", "wake"], ["suspend", "suspend"], ["stop", "stop"], ["pin", "pin"], ["unpin", "unpin"]] as const) {
    test(`${verb}:<session> = the detail pane's ${key} button`, async () => {
      const { sent } = await parity(async (m) => {
        await openSession(m);
        m.click(`gascity-action-${key}`);
      }, `${verb}:scratch:sc-6`);
      expect(sent.map((s) => s.path)).toEqual([`/v0/city/scratch/session/sc-6/${verb}`]);
    });
  }

  test("close:scratch:<session>:confirm = Close…, then Close", async () => {
    const { sent } = await parity(async (m) => {
      await openSession(m);
      m.click("gascity-action-close");
      m.click("gascity-dialog-confirm-0");
    }, "close:scratch:sc-6:confirm");
    expect(sent).toEqual([{ path: "/v0/city/scratch/session/sc-6/close", query: "", body: null, key: "uuid" }]);
  });

  test("kill and kill-force with confirm = Kill…, then Kill / Force kill", async () => {
    await parity(async (m) => {
      await openSession(m);
      m.click("gascity-action-kill");
      m.click("gascity-dialog-confirm-0");
    }, "kill:scratch:sc-6:confirm");
    const { sent } = await parity(async (m) => {
      await openSession(m);
      m.click("gascity-action-kill");
      m.click("gascity-dialog-confirm-1");
    }, "kill-force:scratch:sc-6:confirm");
    expect(sent.map((s) => s.query)).toEqual(["?force=true"]);
  });

  for (const [verb, button] of [["submit", "default"], ["interrupt", "interrupt"], ["message", "message"]] as const) {
    test(`${verb}:<session>:<text> = typing, then the send box's ${button} button`, async () => {
      await parity(async (m) => {
        await openSession(m);
        m.inputs[0]!.type("close fe-1: now");
        m.click(`gascity-send-${button}`);
      }, `${verb}:scratch:sc-6:close%20fe-1%3A%20now`);
    });
  }

  test("answer:scratch:<session>:<request>:<option> = the prompt's answer button (once the detail shows the prompt)", async () => {
    const { sent } = await parity(async (m) => {
      await openSession(m);
      m.click("gascity-answer-1");
    }, ["focus:scratch:sc-6", "answer:scratch:sc-6:perm-1:deny"]);
    expect(sent.map((x) => x.body)).toEqual([{ action: "deny", request_id: "perm-1" }]);
  });

  test("session-new:scratch:<agent>:<alias> = New session…, typing the alias, Start session", async () => {
    const { sent } = await parity(async (m) => {
      m.click("gascity-agent-0-1-new");
      m.inputs[1]!.type("canary-n1");
      m.click("gascity-dialog-create");
    }, "session-new:scratch:frontend/builder:canary-n1");
    expect(sent[0]?.body).toEqual({ kind: "agent", name: "frontend/builder", alias: "canary-n1" });
  });

  test("agent-suspend and rig-suspend with confirm = their button, then the question's button", async () => {
    await parity(async (m) => {
      m.click("gascity-agent-0-1-suspend");
      m.click("gascity-dialog-confirm-0");
    }, "agent-suspend:scratch:frontend/builder:confirm");
    await parity(async (m) => {
      m.click("gascity-group-0-suspend");
      m.click("gascity-dialog-confirm-0");
    }, "rig-suspend:scratch:frontend:confirm");
  });

  test("bead-new:scratch:<title>[:<agent>] = + New bead, the title, the sling target, Create", async () => {
    await parity(async (m) => {
      m.click("gascity-work-new");
      m.inputs[2]!.type("canary n1");
      m.click("gascity-dialog-create-bead");
    }, "bead-new:scratch:canary%20n1");
    const { sent } = await parity(async (m) => {
      m.click("gascity-work-new");
      m.inputs[2]!.type("canary n1");
      m.click("gascity-dialog-sling-2");
      m.click("gascity-dialog-create-bead");
      await ticks(m);
    }, "bead-new:scratch:canary%20n1:worker:confirm");
    expect(sent.map((s) => s.path)).toEqual(["/v0/city/scratch/beads", "/v0/city/scratch/sling"]);
  });

  test("sling:scratch:<bead>:<agent>:confirm = Sling…, then the agent", async () => {
    await parity(async (m) => {
      await openBead(m, "gascity-card-ready-3");
      m.click("gascity-bead-action-sling");
      m.click("gascity-dialog-pick-2");
    }, "sling:scratch:sc-74:worker:confirm");
  });

  test("bead-close:scratch:<bead>:<reason>:confirm = Close…, the reason, Close bead; bead-reopen = Reopen", async () => {
    await parity(async (m) => {
      await openBead(m, "gascity-card-ready-3");
      m.click("gascity-bead-action-close");
      m.inputs[6]!.type("done: shipped");
      m.click("gascity-dialog-close-bead");
    }, "bead-close:scratch:sc-74:done%3A%20shipped:confirm");
    const probe = await running({ route: world().route });
    const closedId = /^(sc-\d+)/.exec(text(probe.render(), "gascity-card-earlier-0") ?? "")?.[1] ?? "";
    await parity(async (m) => {
      await openBead(m, "gascity-card-earlier-0");
      m.click("gascity-bead-action-reopen");
    }, `bead-reopen:scratch:${closedId}`);
  });
});

describe("answering by command", () => {
  test("answer needs the prompt the session's detail shows; then it sends exactly the button's answer", async () => {
    const w = world();
    const viaButton = await running({ route: w.route });
    await openSession(viaButton);
    viaButton.click("gascity-answer-1");
    const mod = await running({ route: world().route });
    await mod.command("answer:scratch:sc-6:perm-1:deny");
    expect(text(mod.render(), "gascity-notice")).toBe("gascity.answer:scratch:sc-6:perm-1:deny: refused: that prompt is no longer pending");
    expect(mutations(mod)).toEqual([]);
    await mod.command("focus:scratch:sc-6");
    await ticks(mod);
    await mod.command("answer:scratch:sc-6:perm-1:maybe");
    expect(text(mod.render(), "gascity-notice")).toBe("gascity.answer:scratch:sc-6:perm-1:maybe: refused: the prompt changed: review it before answering");
    await mod.command("answer:scratch:sc-6:perm-1:deny");
    expect(mutations(mod)).toEqual(mutations(viaButton));
  });
});

describe("destructive commands ask first unless confirmed", () => {
  test("close:scratch:<session> opens the button's question and sends nothing; cancel closes it", async () => {
    const viaButton = await running({ route: world().route });
    await openSession(viaButton);
    viaButton.click("gascity-action-close");
    const mod = await running({ route: world().route });
    await mod.command("close:scratch:sc-6");
    expect(text(mod.render(), "gascity-dialog")).toBe(text(viaButton.render(), "gascity-dialog"));
    expect(mutations(mod)).toEqual([]);
    await mod.command("cancel");
    expect(findById(mod.render(), "gascity-dialog")).toBeUndefined();
    expect(mutations(mod)).toEqual([]);
  });

  test("bead-new with an agent but without confirm opens the form filled in and sends nothing", async () => {
    const mod = await running({ route: world().route });
    await mod.command("bead-new:scratch:canary%20n1:worker");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("New bead");
    expect(mod.inputs[2]!.value()).toBe("canary n1");
    expect(text(mod.render(), "gascity-dialog-sling")).toContain("▸ [worker]");
    expect(mutations(mod)).toEqual([]);
    expect(text(mod.render(), "gascity-notice")).toBeUndefined();
  });

  test("bead-close without confirm opens the close form with the reason typed", async () => {
    const mod = await running({ route: world().route });
    await mod.command("bead-close:scratch:sc-74:not%20needed");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("Close bead sc-74?");
    expect(mod.inputs[6]!.value()).toBe("not needed");
    expect(mutations(mod)).toEqual([]);
    mod.click("gascity-dialog-close-bead");
    expect(mutations(mod).map((m) => m.body)).toEqual([{ reason: "not needed" }]);
  });

  test("a command never sends an action already under way", async () => {
    const mod = await running({ route: (url, req) => (req.method === "POST" ? "hang" as unknown as FakeReply : world().route(url, req)) });
    await mod.command("wake:scratch:sc-6:nonce=a");
    await mod.command("wake:scratch:sc-6:nonce=b");
    expect(mutations(mod)).toHaveLength(1);
    expect(text(mod.render(), "gascity-notice")).toBe("gascity.wake:scratch:sc-6:nonce=b: refused: Wake is already under way");
  });
});

describe("refusals: visible, cleaned, and nothing changes", () => {
  const cases: [string, string][] = [
    ["explode", 'gascity.explode: refused: unknown command "explode"'],
    ["wake", "gascity.wake: refused: wake: expected wake:<city>:<session>"],
    ["wake:sc-6", "gascity.wake:sc-6: refused: wake: expected wake:<city>:<session>"],
    ["wake:scratch:sc-404", 'gascity.wake:scratch:sc-404: refused: no session "sc-404" in city scratch'],
    ["close:scratch:sc-6:yes", 'gascity.close:scratch:sc-6:yes: refused: close: the argument after <city>:<session> can only be "confirm"'],
    ["session-new:scratch:nobody", "gascity.session-new:scratch:nobody: refused: no agent nobody in this city"],
    ["rig-suspend:scratch:backend:confirm", "gascity.rig-suspend:scratch:backend:confirm: refused: no rig backend in this city"],
    ["sling:scratch:sc-74:nobody:confirm", "gascity.sling:scratch:sc-74:nobody:confirm: refused: no agent nobody in this city"],
    ["bead-new:scratch:t:nobody", "gascity.bead-new:scratch:t:nobody: refused: no agent nobody in this city"],
    ["bead-new:scratch:%20", "gascity.bead-new:scratch:%20: refused: a new bead needs a title"],
    ["submit:scratch:sc-6:", "gascity.submit:scratch:sc-6:: refused: type a message first"],
    ["city:atlantis", "gascity.city:atlantis: refused: gc lists no city atlantis"],
    ["focus:atlantis:sc-6", "gascity.focus:atlantis:sc-6: refused: gc lists no city atlantis"],
    ["wake:scratch:\u001b[31mx\u0007", 'gascity.wake:scratch:x: refused: no session "x" in city scratch'],
  ];
  for (const [command, notice] of cases) {
    test(JSON.stringify(command), async () => {
      const mod = await running({ route: world().route });
      await mod.command(command);
      expect(text(mod.render(), "gascity-notice")).toBe(notice);
      expect(mutations(mod)).toEqual([]);
      expect(findById(mod.render(), "gascity-dialog")).toBeUndefined();
    });
  }

  test("an alias two sessions share is refused, never guessed; one only one session has works", async () => {
    const w = world();
    const list = fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: Record<string, unknown>[] };
    w.state.sessions = { ...list, items: list.items.map((s) => (s["id"] === "sc-20" || s["id"] === "sc-5" ? { ...s, alias: "twin" } : s)) };
    const mod = await running({ route: w.route });
    await mod.command("wake:scratch:twin");
    expect(text(mod.render(), "gascity-notice")).toBe('gascity.wake:scratch:twin: refused: "twin" names sessions sc-20, sc-5: use the session id');
    expect(mutations(mod)).toEqual([]);
    await mod.command("wake:scratch:frontend/builder");
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/wake"]);
  });
});

describe("focus, keys and the probe", () => {
  test("bare focus takes the keyboard; keys then call the buttons' methods; the probe says keyboard=true", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written, shared: { "gascity.probe": true } });
    expect(mod.cx.focusHandles).toHaveLength(1);
    expect(mod.cx.focusHandles[0]!.focused).toBe(false);
    await mod.command("focus");
    expect(mod.cx.focusHandles[0]!.focused).toBe(true);
    const root = mod.render();
    expect(root.calls.some((c) => c.method === "track_focus")).toBe(true);
    mod.key("j");
    await ticks(mod);
    expect(text(mod.render(), "gascity-detail-title")).toMatch(/^Detail: /);
    mod.key("escape");
    expect(findById(mod.render(), "gascity-detail")).toBeUndefined();
    mod.key("r");
    await ticks(mod, 2);
    const doc = JSON.parse([...written.values()][0] ?? "{}") as { keyboard: boolean; refresh_count: number; commands: { command: string; result: string }[] };
    expect(doc.keyboard).toBe(true);
    expect(doc.refresh_count).toBe(1);
    expect(doc.commands).toEqual([expect.objectContaining({ command: "focus", result: "done" })]);
  });

  test("refresh = Retry now; the probe's refresh count moves either way", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written, shared: { "gascity.probe": true } });
    await mod.command("refresh");
    mod.click("gascity-retry");
    await ticks(mod, 2);
    const doc = JSON.parse([...written.values()][0] ?? "{}") as { refresh_count: number };
    expect(doc.refresh_count).toBe(2);
  });

  test("probe:on / probe:off set the shared key every copy reads", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written });
    expect(written.size).toBe(0);
    await mod.command("probe:on");
    expect(mod.shared.get("gascity.probe")).toBe(true);
    await ticks(mod, 2);
    const doc = JSON.parse([...written.values()][0] ?? "{}") as { commands: { at: number; command: string; copy: string; result: string; detail: string }[] };
    expect(doc.commands).toEqual([{ at: expect.any(Number), command: "probe:on", copy: "panel", result: "done", detail: "probe on" }]);
    await mod.command("probe:off");
    expect(mod.shared.get("gascity.probe")).toBe(false);
  });

  test("city and session commands select as the header and the rows do", async () => {
    const mod = await running({ route: world().route });
    await mod.command("city:scratch");
    await mod.command("session:sc-6");
    await ticks(mod);
    expect(text(mod.render(), "gascity-detail-title")).toBe("Detail: frontend/builder / frontend/builder");
    await mod.command("bead:sc-74");
    await ticks(mod);
    expect(text(mod.render(), "gascity-bead-title")).toContain("Bead sc-74");
  });
});

/** The Gas City tab exists but another tab is in front: no gascity view is on screen. */
const HIDDEN = {
  panes: [{ pane: "p1", tab: "t1", mod: "gascity", title: "gascity", focused: false }, { pane: "p2", tab: "t2", terminal: "term-1", title: "zsh", focused: true }],
  focus: { space: "s1", tab: "t2", pane: "p2", terminal: "term-1" },
};

/** herdr runs the toast's action: mod.open opens the window copy (props {overlay}) sharing the module. */
async function openWindow(mod: Mod): Promise<Copy> {
  const w = mod.copy({ props: { overlay: "mod-gascity" } });
  w.init();
  await w.settle();
  for (let i = 0; i < 4; i++) await w.tick();
  return w;
}

describe("needs-you toasts and the window, with the Gas City tab hidden", () => {
  test("a new prompt posts one toast whose action is mod.open, and writes the shared focus target", async () => {
    const w = world();
    const written = new Map<string, string>();
    const mod = await running({ route: w.route, ...HIDDEN, written, shared: { "gascity.probe": true } });
    expect(mod.toasts).toEqual([]);
    await ticks(mod, 2);
    expect((JSON.parse([...written.values()][0] ?? "{}") as { visibility: unknown }).visibility).toEqual({ on_screen: false });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    expect(mod.toasts).toEqual([{
      title: "frontend/builder needs you", body: "permission · session sc-6 · city scratch", level: "warning",
      action: { name: "mod.open", args: { name: "gascity" } },
    }]);
    expect(mod.shared.get("gascity.focus")).toEqual({ city: "scratch", session: "sc-6", seq: 1, at: expect.any(Number) });
    // The tab stays as it was: nothing a hidden copy could not see is assumed.
    expect(findById(mod.render(), "gascity-detail")).toBeUndefined();
    await ticks(mod, 40, 1000);
    expect(mod.toasts).toHaveLength(1);
  });

  test("the toast's click opens the window, which shows the toasted session's prompt; answering it works there", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    const win = await openWindow(mod);
    expect(mod.shared.get("gascity.window")).toEqual({ open: true, at: expect.any(Number) });
    for (let i = 0; i < 4; i++) await win.tick();
    const root = win.render();
    expect(text(root, "gascity-window-target")).toBe("Needs you: session sc-6 in city scratch");
    expect(text(root, "gascity-window-pending")).toBe("frontend/builder (session sc-6): permission");
    expect(text(root, "gascity-detail-answers")).toBe("[approve] [deny]");
    expect(findById(root, "gascity-agents")).toBeUndefined();
    win.click("gascity-answer-0");
    expect(mutations(mod).map((m) => [m.path, m.body])).toEqual([["/v0/city/scratch/session/sc-6/respond", { action: "approve", request_id: "perm-1" }]]);
  });

  test("while the window is open toasts have no action (mod.open would close it), and the window follows the newest target", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    const win = await openWindow(mod);
    w.state.cityPending = [...w.state.cityPending, { session_id: "sc-20", request_id: "q-9", kind: "question" }];
    for (let i = 0; i < 40; i++) {
      await mod.tick();
      await win.tick();
    }
    expect(mod.toasts.map((t) => t.action ?? null)).toEqual([{ name: "mod.open", args: { name: "gascity" } }, null]);
    expect(mod.shared.get("gascity.focus")).toMatchObject({ session: "sc-20", seq: 2 });
    expect(text(win.render(), "gascity-window-target")).toBe("Needs you: session sc-20 in city scratch");
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: worker-adhoc-88210e2896 / worker-adhoc-88210e2896");
    // Closing the window: the flag clears, and the next toast opens it again.
    win.click("gascity-window-close");
    expect(mod.herdrCalls.filter((c) => c.name === "closeOverlay").map((c) => c.args)).toEqual([["mod-gascity"]]);
    await win.close();
    expect(mod.shared.get("gascity.window")).toBe(false);
    w.state.cityPending = [...w.state.cityPending, { session_id: "sc-5", request_id: "p-3", kind: "permission" }];
    await ticks(mod, 40, 1000);
    expect(mod.toasts.at(-1)?.action).toEqual({ name: "mod.open", args: { name: "gascity" } });
  });

  test("the hotkey's mod.open with an old target shows the plain window, not a stale session", async () => {
    const mod = await running({ route: world().route, ...HIDDEN, shared: { "gascity.focus": { city: "scratch", session: "sc-6", seq: 4, at: Date.UTC(2026, 10, 9, 10, 0, 0) } } });
    const win = await openWindow(mod);
    expect(text(win.render(), "gascity-window-target")).toBe("No toast to follow: pick a session below.");
    expect(findById(win.render(), "gascity-detail")).toBeUndefined();
  });

  test("a command reaches the window copy herdr shows, and takes effect there", async () => {
    const mod = await running({ route: world().route, ...HIDDEN });
    const win = await openWindow(mod);
    expect(win.waitsForCommand()).toBe(true);
    await win.command("focus:scratch:sc-6");
    await win.tick();
    await win.tick();
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: frontend/builder / frontend/builder");
    await win.command("wake:scratch:sc-6");
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/wake"]);
  });

  test("Show Gas City tab selects the tab holding the Gas City pane, logged in the run log", async () => {
    const mod = await running({ route: world().route, ...HIDDEN });
    const win = await openWindow(mod);
    expect(text(win.render(), "gascity-window-bar")).toBe("[Show Gas City tab] [Close]");
    win.click("gascity-window-tab-0");
    expect(mod.herdrCalls.filter((c) => c.name === "run").map((c) => c.args)).toEqual([["tab.select", { id: "t1" }]]);
  });

  test("two copies of the city post each toast once", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    const other = mod.copy();
    other.init();
    await other.settle();
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    for (let i = 0; i < 40; i++) {
      await mod.tick(1000);
      await other.tick(0);
    }
    expect(mod.toasts).toHaveLength(1);
  });
});

/** gc listing two running cities, `scratch` and `other`, each served from the recorded fixtures. */
function twoCities() {
  const w = world();
  const cities = fixtureBody("get-v0-cities", "ok") as { items: Record<string, unknown>[]; total: number };
  const listed = { items: [...cities.items, { ...cities.items[0], name: "other", path: "/other/city" }], total: 2 };
  const route = (url: string, req: Req): FakeReply | undefined => (new URL(url).pathname === "/v0/cities" ? { status: 200, body: listed } : w.route(url, req));
  return { ...w, route };
}

/** Every element id under a node, depth first. */
const ids = (n: RecordedNode | string): string[] => (typeof n === "string" ? [] : [n.id, ...n.children.flatMap(ids)]);

/** herdr delivers one `herdr-app do` command to every shown copy, each in its own turn. */
async function doCommand(command: string, copies: { command(c: string): Promise<void> }[]) {
  for (const c of copies) await c.command(command);
}

/** A second copy of the same module (and app), set going. */
async function another(mod: Mod, props?: unknown): Promise<Copy> {
  const c = props === undefined ? mod.copy() : mod.copy({ props });
  c.init();
  await c.settle();
  for (let i = 0; i < 4; i++) await c.tick();
  return c;
}

/** The probe file the app wrote. */
const probeOf = (written: Map<string, string>) =>
  JSON.parse([...written.values()][0] ?? "{}") as { schema: string; commands: { at: number; command: string; copy: string; result: string; detail: string }[] };

describe("one delivery, several shown copies: it runs once, in the copy showing its city", () => {
  test("two copies of a city: submit and message reach gc once; the other copy logs a duplicate", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written, shared: { "gascity.probe": true } });
    const two = await another(mod);
    await doCommand("submit:scratch:sc-6:hello", [mod, two]);
    await doCommand("message:scratch:sc-6:later", [mod, two]);
    await ticks(mod, 2);
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/submit", "/v0/city/scratch/session/sc-6/messages"]);
    expect(probeOf(written).commands.map((c) => [c.command, c.result])).toEqual([
      ["submit:scratch:sc-6:hello", "done"], ["submit:scratch:sc-6:hello", "duplicate"],
      ["message:scratch:sc-6:later", "done"], ["message:scratch:sc-6:later", "duplicate"],
    ]);
    expect(text(two.render(), "gascity-notice")).toBeUndefined();
  });

  test("a confirmed close goes once even when the first copy's request finished before the second copy ran", async () => {
    const mod = await running({ route: world().route });
    const two = await another(mod);
    await mod.command("close:scratch:sc-6:confirm");
    await ticks(mod, 4);
    await two.command("close:scratch:sc-6:confirm");
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/close"]);
  });

  test("an unpinned copy on scratch and a copy pinned to other: kill acts in scratch only", async () => {
    const w = twoCities();
    const written = new Map<string, string>();
    const mod = await running({ route: w.route, written, shared: { "gascity.probe": true }, storage: { city: "scratch" } });
    const pinned = await another(mod, { city: "other" });
    await doCommand("kill:scratch:sc-6:confirm", [pinned, mod]);
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/kill"]);
    // Logged app-wide only: a copy showing another city is not cluttered with a notice.
    expect(text(pinned.render(), "gascity-notice")).toBeUndefined();
    await ticks(mod, 2);
    expect(probeOf(written).commands.map((c) => [c.result, c.detail])).toEqual([
      ["skipped", "it names city scratch; this copy shows other"], ["done", "sent"],
    ]);
  });

  test("the same text again after the window runs again; a nonce keeps a delivery distinct and is its Idempotency-Key", async () => {
    const mod = await running({ route: world().route });
    const two = await another(mod);
    await doCommand("wake:scratch:sc-6", [mod, two]);
    await ticks(mod, 12); // 3 s later: a new delivery of the same text
    await doCommand("wake:scratch:sc-6", [mod, two]);
    await doCommand("pin:scratch:sc-6:nonce=p1", [mod, two]);
    await doCommand("pin:scratch:sc-6:nonce=p2", [two, mod]);
    await ticks(mod, 12);
    await doCommand("pin:scratch:sc-6:nonce=p1", [mod]);
    await doCommand("submit:scratch:sc-6:hi:nonce=canary-7", [two, mod]);
    expect(mutations(mod).map((m) => [m.path, m.key])).toEqual([
      ["/v0/city/scratch/session/sc-6/wake", "uuid"],
      ["/v0/city/scratch/session/sc-6/wake", "uuid"],
      ["/v0/city/scratch/session/sc-6/pin", "none"],
      ["/v0/city/scratch/session/sc-6/pin", "none"],
      ["/v0/city/scratch/session/sc-6/submit", "canary-7"],
    ]);
  });

  test("a command run in the needs-you window is in the app's probe", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written, shared: { "gascity.probe": true } });
    const win = await another(mod, { overlay: "mod-gascity" });
    await win.command("wake:scratch:sc-6");
    await ticks(mod, 2);
    expect(probeOf(written).commands).toEqual([{ at: expect.any(Number), command: "wake:scratch:sc-6", copy: "window", result: "done", detail: "sent" }]);
    expect(probeOf(written).schema).toBe("gascity-herdr-probe/4");
  });

  test("a command whose host call throws is recorded, and the copy keeps taking commands", async () => {
    const written = new Map<string, string>();
    const mod = await running({ route: world().route, written, shared: { "gascity.probe": true } });
    mod.hostFails.set("setShared", "shared.json is read-only");
    await mod.command("probe:off");
    mod.hostFails.clear();
    expect(text(mod.render(), "gascity-notice")).toBe("gascity.probe:off: refused: the command failed: shared.json is read-only");
    await mod.command("wake:scratch:sc-6");
    expect(mutations(mod)).toHaveLength(1);
    expect(text(mod.render(), "gascity-diag-0") ?? "").toBe("");
    mod.click("gascity-diagnostics-toggle");
    expect(textOf(findById(mod.render(), "gascity-diagnostics-drawer")!)).toContain("command: an app-wide listener failed: shared.json is read-only");
  });

  test("city on a pinned copy is refused, not reported as selected", async () => {
    const mod = await running({ route: twoCities().route, props: { city: "scratch" } });
    await mod.command("city:other");
    expect(text(mod.render(), "gascity-notice")).toBe("gascity.city:other: refused: this copy shows city scratch only");
  });
});

describe("keys never fire while a text box holds the keyboard; Send goes to the session the box belongs to", () => {
  test("j, k, r and escape typed into the send box change nothing but the box", async () => {
    const mod = await running({ route: world().route });
    await openSession(mod);
    await mod.command("focus");
    const before = text(mod.render(), "gascity-detail-title");
    // The send box takes the keyboard (GPUI moves focus onto the input, inside the root).
    mod.cx.focusHandles[0]!.focused = false;
    const fetchedBefore = mod.fetched.length;
    for (const k of ["f", "i", "x", " ", "t", "h", "e", " ", "j", "o", "b", "k", "r", "escape"]) mod.key(k);
    await ticks(mod, 1);
    expect(text(mod.render(), "gascity-detail-title")).toBe(before);
    expect(findById(mod.render(), "gascity-detail")).toBeDefined();
    expect(mod.fetched.slice(fetchedBefore).filter((f) => new URL(f.url).pathname.endsWith("/health"))).toEqual([]);
  });

  test("Send posts to the session whose detail drew the box, even if the selection changed since", async () => {
    const mod = await running({ route: world().route });
    await openSession(mod);
    const drawn = findById(mod.render(), "gascity-send-default")!;
    mod.inputs[0]!.type("fix the job");
    const other = ids(mod.render()).find((id) => /^gascity-agent-\d+-\d+-session-\d+$/.test(id) && id !== "gascity-agent-0-1-session-0");
    mod.click(other!); // another session's row
    await ticks(mod);
    expect(text(mod.render(), "gascity-detail-title")).not.toBe("Detail: frontend/builder / frontend/builder");
    await ticks(mod);
    drawn.handlers.on_click!({}, mod.cx);
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/submit"]);
  });
});

describe("a stale window flag", () => {
  test("a flag left by a crashed window is ignored: toasts keep their action and a hidden app polls slowly", async () => {
    const w = world();
    const stale = { open: true, at: Date.UTC(2026, 10, 9, 11, 0, 0) };
    const written = new Map<string, string>();
    const mod = await running({ route: w.route, ...HIDDEN, written, shared: { "gascity.window": stale, "gascity.probe": true } });
    await ticks(mod, 2);
    expect((JSON.parse([...written.values()][0] ?? "{}") as { visibility: unknown }).visibility).toEqual({ on_screen: false });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    expect(mod.toasts.at(-1)?.action).toEqual({ name: "mod.open", args: { name: "gascity" } });
  });

  test("an open window keeps its flag fresh", async () => {
    const mod = await running({ route: world().route, ...HIDDEN });
    const win = await openWindow(mod);
    const first = (mod.shared.get("gascity.window") as { at: number }).at;
    for (let i = 0; i < 30; i++) await win.tick(1000);
    expect((mod.shared.get("gascity.window") as { at: number }).at).toBeGreaterThan(first + 20_000);
  });
});

describe("a draft belongs to its session", () => {
  /** The window copy's send box: each copy makes 7 inputs, the send box first. */
  const box = (mod: Mod, copyIndex: number) => mod.inputs[copyIndex * 7]!;

  test("a toast for B while a reply to A is typed in the window: the window stays on A, offers B, and Enter sends to A", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    const win = await openWindow(mod);
    for (let i = 0; i < 4; i++) await win.tick();
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: frontend/builder / frontend/builder");
    box(mod, 1).type("yes, run them");
    w.state.cityPending = [...w.state.cityPending, { session_id: "sc-20", request_id: "q-9", kind: "question" }];
    for (let i = 0; i < 40; i++) {
      await mod.tick();
      await win.tick();
    }
    expect(mod.shared.get("gascity.focus")).toMatchObject({ session: "sc-20" });
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: frontend/builder / frontend/builder");
    expect(text(win.render(), "gascity-window-next")).toBe("Session sc-20 in city scratch needs you too. [Show]");
    box(mod, 1).submit(win.cx);
    expect(mutations(mod).map((m) => [m.path, m.body])).toEqual([["/v0/city/scratch/session/sc-6/submit", { message: "yes, run them", intent: "default" }]]);
    // The draft is gone: the window may move on, and does when asked.
    win.click("gascity-window-next-show");
    for (let i = 0; i < 3; i++) await win.tick();
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: worker-adhoc-88210e2896 / worker-adhoc-88210e2896");
    expect(findById(win.render(), "gascity-window-next")).toBeUndefined();
  });

  test("a draft for A never goes to B: after Show, Enter refuses until the box is cleared or A is open again", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    const win = await openWindow(mod);
    for (let i = 0; i < 4; i++) await win.tick();
    box(mod, 1).type("for A only");
    w.state.cityPending = [...w.state.cityPending, { session_id: "sc-20", request_id: "q-9", kind: "question" }];
    for (let i = 0; i < 40; i++) {
      await mod.tick();
      await win.tick();
    }
    win.click("gascity-window-next-show");
    for (let i = 0; i < 3; i++) await win.tick();
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: worker-adhoc-88210e2896 / worker-adhoc-88210e2896");
    box(mod, 1).submit(win.cx);
    win.click("gascity-send-default");
    expect(mutations(mod)).toEqual([]);
    expect(text(win.render(), "gascity-notice")).toBe("this text was typed for session sc-6: open that session to send it, or clear the box");
  });

  test("with an empty send box the window follows the newest target at once", async () => {
    const w = world();
    const mod = await running({ route: w.route, ...HIDDEN });
    w.state.cityPending = [{ session_id: "sc-6", request_id: "perm-1", kind: "permission" }];
    await ticks(mod, 40, 1000);
    const win = await openWindow(mod);
    box(mod, 1).type("draft");
    box(mod, 1).type("");
    w.state.cityPending = [...w.state.cityPending, { session_id: "sc-20", request_id: "q-9", kind: "question" }];
    for (let i = 0; i < 40; i++) {
      await mod.tick();
      await win.tick();
    }
    expect(text(win.render(), "gascity-detail-title")).toBe("Detail: worker-adhoc-88210e2896 / worker-adhoc-88210e2896");
    expect(findById(win.render(), "gascity-window-next")).toBeUndefined();
  });

  test("in the tab: text typed for one session and Enter after opening another sends nothing", async () => {
    const mod = await running({ route: world().route });
    await openSession(mod);
    box(mod, 0).type("fix the job");
    const other = ids(mod.render()).find((id) => /^gascity-agent-\d+-\d+-session-\d+$/.test(id) && id !== "gascity-agent-0-1-session-0");
    mod.click(other!);
    await ticks(mod);
    box(mod, 0).submit(mod.cx);
    expect(mutations(mod)).toEqual([]);
    expect(text(mod.render(), "gascity-notice")).toBe("this text was typed for session sc-6: open that session to send it, or clear the box");
    await openSession(mod);
    box(mod, 0).submit(mod.cx);
    expect(mutations(mod).map((m) => m.path)).toEqual(["/v0/city/scratch/session/sc-6/submit"]);
  });
});
