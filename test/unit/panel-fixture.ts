// The panel's render-test fixture: gc at the default URL serving the
// recorded contract fixtures through the fake herdr fetch, and a copy that
// discovered it and ran a few periods of its timer (test/harness.ts).

import { findById, loadMod, textOf, type FakeReply, type RecordedNode } from "../harness.ts";
import { fixtureBody } from "./sync/fakes.ts";

export const BASE = "http://127.0.0.1:8372";

/** A bead by id: the recorded bead for its id, else the bead as a recorded work list shows it, else the recorded bead renamed. */
function recordedBead(id: string): unknown {
  const recorded = fixtureBody("get-v0-city-by-city-name-bead-by-id", "ok") as { id: string };
  if (recorded.id === id) return recorded;
  for (const name of ["ready", "in-progress", "closed-seed"]) {
    const hit = (fixtureBody("get-v0-city-by-city-name-work-ready", name) as { items: { id: string }[] }).items.find((b) => b.id === id);
    if (hit) return hit;
  }
  return { ...recorded, id };
}

/** gc at the default URL serving the recorded fixtures; `overrides` by pathname. */
export function gc(overrides: Record<string, FakeReply> = {}) {
  const events = [{ seq: 1, type: "order.fired", ts: "t", actor: "a", subject: "gate-sweep", payload: {} }];
  return (url: string): FakeReply | undefined => {
    const u = new URL(url);
    if (u.origin !== BASE) return undefined;
    const p = u.pathname;
    if (overrides[p]) return overrides[p];
    if (p === "/health") return { status: 200, body: fixtureBody("get-health", "ok") };
    if (p === "/v0/cities") return { status: 200, body: fixtureBody("get-v0-cities", "ok") };
    if (p.endsWith("/events")) return { status: 200, body: { items: events, total: 1 } };
    if (p.endsWith("/sessions")) {
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-sessions", u.searchParams.get("wake_reasons") === "true" ? "wake-reasons" : "ok") };
    }
    if (/\/session\/[^/]+\/pending$/.test(p)) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-session-by-id-pending", "none") };
    if (/\/session\/[^/]+$/.test(p)) {
      return { status: 200, body: { ...(fixtureBody("get-v0-city-by-city-name-session-by-id", "peek") as object), last_output: "\u001b[1mCANARY READY\u001b[0m\nsecond line" } };
    }
    const bead = /\/bead\/([^/]+)$/.exec(p);
    if (bead) return { status: 200, body: recordedBead(decodeURIComponent(bead[1] ?? "")) };
    if (p.endsWith("/pending")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-pending", "ok") };
    if (p.endsWith("/rigs")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-rigs", "ok") };
    if (p.endsWith("/agents")) return { status: 200, body: fixtureBody("get-v0-city-by-city-name-agents", "ok") };
    if (p.endsWith("/work/ready")) {
      const status = u.searchParams.get("status");
      return { status: 200, body: fixtureBody("get-v0-city-by-city-name-work-ready", status === "closed" ? "closed-seed" : status === "in_progress" ? "in-progress" : "ready") };
    }
    return { status: 404, body: { title: "Not Found", status: 404, detail: `no route ${p}` } };
  };
}

export const text = (root: RecordedNode, id: string) => {
  const node = findById(root, id);
  return node ? textOf(node) : undefined;
};

/** A copy that discovered gc and ran `ticks` periods of its timer. */
export async function running(options: Parameters<typeof loadMod>[0] = {}, ticks = 4) {
  const mod = await loadMod({ route: gc(), ...options });
  mod.init();
  await mod.settle();
  for (let i = 0; i < ticks; i++) await mod.tick();
  return mod;
}
