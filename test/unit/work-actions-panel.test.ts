// Render tests of the work actions in the built bundle (gascity/main.js),
// through the fake herdr / gpui-kit modules: the board's + New bead form
// (create, optionally slung to an agent: two gc calls, two log rows), the
// open bead's Sling… (one button per agent, with the may-route-twice
// warning), Close… (with a reason) and Reopen; each a gc API call with
// X-GC-Request, and Idempotency-Key only on create; gc text drawn plain.

import { describe, expect, test } from "bun:test";
import { findById, textOf, type FakeReply } from "../harness.ts";
import { gc, running, text } from "./panel-fixture.ts";
import { fixtureBody } from "./sync/fakes.ts";

type Req = { method: string; headers: Record<string, string>; body?: string };
type Mod = Awaited<ReturnType<typeof running>>;

/** gc serving the recorded fixtures, answering POSTs with `post` (mutable through the returned object). */
function withPosts(post: (path: string) => FakeReply | "hang") {
  const base = gc();
  const g = { post };
  const route = (url: string, req: Req): FakeReply | "hang" | undefined => {
    if (req.method === "POST") return g.post(new URL(url).pathname);
    return base(url);
  };
  return { g, route };
}

const posts = (mod: Mod, suffix: string): Req[] => mod.fetched
  .filter((f) => (f.init as Req).method === "POST" && new URL(f.url).pathname.endsWith(suffix))
  .map((f) => f.init as Req);

const activityText = (mod: Mod) => text(mod.render(), "gascity-activity") ?? "";

async function openBead(mod: Mod, card: string) {
  mod.click(card);
  for (let i = 0; i < 3; i++) await mod.tick();
}

const CREATED = { status: 201, body: fixtureBody("create-bead", "ok") };
const SLUNG = { status: 200, body: fixtureBody("post-v0-city-by-city-name-sling", "ok") };

describe("work actions on the board", () => {
  test("the open bead's actions: Sling… and Close… for an open bead, Reopen for a closed one", async () => {
    const mod = await running();
    await openBead(mod, "gascity-card-ready-3");
    expect(text(mod.render(), "gascity-bead-actions")).toBe("[Sling…] [Close…]");
    await openBead(mod, "gascity-card-earlier-0");
    expect(text(mod.render(), "gascity-bead-actions")).toBe("[Reopen]");
    expect(text(mod.render(), "gascity-work-new")).toBe("[+ New bead]");
  });

  test("Sling…: one button per agent and the may-route-twice warning; a pick sends one POST with no Idempotency-Key", async () => {
    const { route } = withPosts(() => SLUNG);
    const mod = await running({ route });
    await openBead(mod, "gascity-card-ready-3");
    mod.click("gascity-bead-action-sling");
    const root = mod.render();
    expect(text(root, "gascity-dialog-question")).toBe("Sling bead sc-74 to which agent?");
    expect(text(root, "gascity-dialog-detail")).toContain("a retry may route the bead twice. Check the board first.");
    expect(text(root, "gascity-dialog-buttons")).toBe(
      "[core.control-dispatcher] [frontend/core.control-dispatcher] [worker] [worker-adhoc-88210e2896] [frontend/builder] [Cancel]",
    );
    expect(posts(mod, "/sling")).toEqual([]);
    mod.click("gascity-dialog-pick-2");
    const [sling, ...more] = posts(mod, "/v0/city/scratch/sling");
    expect(more).toEqual([]);
    expect(JSON.parse(sling?.body ?? "{}")).toEqual({ target: "worker", bead: "sc-74" });
    expect(sling?.headers["X-GC-Request"]).toMatch(/^herdr-gascity\//);
    expect(sling?.headers["Idempotency-Key"]).toBeUndefined();
    await mod.tick();
    expect(activityText(mod)).toContain("Sling to worker · bead sc-74 → done: gc: slung bead sc-74 to worker; convoy sc-75");
  });

  test("Close… asks with a reason box; Close bead sends the reason; Reopen sends at once", async () => {
    const { g, route } = withPosts(() => ({ status: 200, body: { status: "closed" } }));
    const mod = await running({ route });
    await openBead(mod, "gascity-card-ready-3");
    mod.click("gascity-bead-action-close");
    expect(text(mod.render(), "gascity-dialog-question")).toBe("Close bead sc-74?");
    expect(posts(mod, "/close")).toEqual([]);
    const reason = mod.inputs[6]!;
    expect(reason.placeholder).toBe("close reason (optional)");
    reason.type("done from herdr");
    mod.click("gascity-dialog-close-bead");
    const [close] = posts(mod, "/bead/sc-74/close");
    expect(JSON.parse(close?.body ?? "{}")).toEqual({ reason: "done from herdr" });
    expect(close?.headers["Idempotency-Key"]).toBeUndefined();
    expect(reason.value()).toBe("");
    expect(findById(mod.render(), "gascity-dialog")).toBeUndefined();

    g.post = () => ({ status: 200, body: { status: "reopened" } });
    await openBead(mod, "gascity-card-earlier-0");
    mod.click("gascity-bead-action-reopen");
    expect(posts(mod, "/bead/sc-73/reopen")).toHaveLength(1);
    await mod.tick();
    expect(activityText(mod)).toContain("Reopen · bead sc-73 → done: gc: reopened");
  });

  test("an action under way on the open bead waits instead of sending again", async () => {
    const { route } = withPosts(() => "hang");
    const mod = await running({ route });
    await openBead(mod, "gascity-card-ready-3");
    mod.click("gascity-bead-action-sling");
    mod.click("gascity-dialog-pick-2");
    expect(text(mod.render(), "gascity-bead-action-sling")).toBe("[Sling: under way]");
    expect(() => mod.click("gascity-bead-action-sling")).toThrow();
  });

  test("+ New bead: the form's fields go to gc with an Idempotency-Key; with an agent chosen the created bead is slung, two log rows", async () => {
    const { route } = withPosts((p) => (p.endsWith("/beads") ? CREATED : SLUNG));
    const mod = await running({ route });
    mod.click("gascity-work-new");
    let root = mod.render();
    expect(text(root, "gascity-dialog-question")).toBe("New bead");
    expect(text(root, "gascity-dialog-sling")).toBe(
      "Sling to: ▸ [none] [core.control-dispatcher] [frontend/core.control-dispatcher] [worker] [worker-adhoc-88210e2896] [frontend/builder]",
    );
    expect(text(root, "gascity-dialog-create-bead")).toBe("[Create]");
    const [title, description, priority, labels] = [mod.inputs[2]!, mod.inputs[3]!, mod.inputs[4]!, mod.inputs[5]!];
    expect([title.placeholder, description.placeholder, priority.placeholder, labels.placeholder]).toEqual([
      "title (required)", "description (optional)", "priority, e.g. 2 (optional)", "labels, comma-separated (optional)",
    ]);
    mod.click("gascity-dialog-sling-4");
    root = mod.render();
    expect(text(root, "gascity-dialog-sling")).toContain("▸ [frontend/builder]");
    expect(text(root, "gascity-dialog-note")).toContain("Two gc calls: create the bead, then sling it to frontend/builder.");
    expect(text(root, "gascity-dialog-create-bead")).toBe("[Create and sling]");
    title.type("fix login");
    priority.type("1");
    labels.type("ui");
    mod.click("gascity-dialog-create-bead");
    const [create] = posts(mod, "/v0/city/scratch/beads");
    expect(JSON.parse(create?.body ?? "{}")).toEqual({ title: "fix login", priority: 1, labels: ["ui"] });
    expect(create?.headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(title.value()).toBe("");
    await mod.tick();
    const [sling] = posts(mod, "/sling");
    expect(JSON.parse(sling?.body ?? "{}")).toEqual({ target: "frontend/builder", bead: "sc-74" });
    expect(sling?.headers["Idempotency-Key"]).toBeUndefined();
    await mod.tick();
    const log = activityText(mod);
    expect(log).toContain("Sling to frontend/builder · bead sc-74 → done");
    expect(log).toContain('New bead · new bead "fix login" → done: gc: created bead sc-74; then Sling to frontend/builder: sent (action');
  });

  test("the form refuses a blank title with a notice and sends nothing", async () => {
    const mod = await running();
    mod.click("gascity-work-new");
    mod.click("gascity-dialog-create-bead");
    expect(text(mod.render(), "gascity-notice")).toBe("a new bead needs a title");
    expect(posts(mod, "/beads")).toEqual([]);
    expect(findById(mod.render(), "gascity-dialog")).toBeDefined();
  });

  test("the create succeeds but the sling is refused: both rows say exactly that, and the sling's retry never re-creates", async () => {
    const { g, route } = withPosts((p) => (p.endsWith("/beads") ? CREATED : { status: 409, body: { title: "Conflict", status: 409, detail: "bead\u001b[31m sc-74 already routed" } }));
    const mod = await running({ route });
    mod.click("gascity-work-new");
    mod.click("gascity-dialog-sling-2");
    mod.inputs[2]!.type("fix login");
    mod.click("gascity-dialog-create-bead");
    for (let i = 0; i < 2; i++) await mod.tick();
    const log = activityText(mod);
    expect(log).toContain("Sling to worker · bead sc-74 → failed: gc answered 409: bead sc-74 already routed");
    expect(log).toContain('New bead · new bead "fix login" → done: gc: created bead sc-74');
    const id = /gascity-activity-(\d+)-retry/.exec(JSON.stringify(findById(mod.render(), "gascity-activity")))?.[1];
    g.post = (p) => (p.endsWith("/beads") ? CREATED : SLUNG);
    mod.click(`gascity-activity-${id}-retry`);
    // A retry of a sling asks again, with the warning.
    expect(text(mod.render(), "gascity-dialog-question")).toBe("Retry: Sling bead sc-74 to worker?");
    expect(text(mod.render(), "gascity-dialog-detail-0")).toContain("may route the bead twice");
    mod.click("gascity-dialog-confirm-0");
    await mod.tick();
    expect(posts(mod, "/beads")).toHaveLength(1);
    expect(posts(mod, "/sling")).toHaveLength(2);
    expect(activityText(mod)).toContain("Sling to worker · bead sc-74 (attempt 2) → done");
  });

  test("the copy that created a bead closes before the create answers: the other copy shows it unknown and nothing is slung", async () => {
    const { g, route } = withPosts(() => "hang");
    const mod = await running({ route });
    const b = mod.copy();
    b.init();
    await b.settle();
    await b.tick();
    mod.click("gascity-work-new");
    mod.click("gascity-dialog-sling-2");
    mod.inputs[2]!.type("fix login");
    mod.click("gascity-dialog-create-bead");
    await mod.close();
    g.post = (p) => (p.endsWith("/beads") ? CREATED : SLUNG);
    for (let i = 0; i < 10; i++) await b.tick(1000);
    const log = textOf(findById(b.render(), "gascity-activity")!);
    expect(log).toContain('New bead · new bead "fix login" → outcome unknown:');
    expect(log).toContain("then Sling to worker: not sent, the bead may not exist");
    expect(posts(mod, "/sling")).toEqual([]);
  });

  test("gc's agent names in the sling picker are drawn without control characters", async () => {
    const base = gc();
    const mod = await running({
      route: (url) => {
        if (new URL(url).pathname.endsWith("/agents")) {
          const body = fixtureBody("get-v0-city-by-city-name-agents", "ok") as { items: object[] };
          return { status: 200, body: { ...body, items: [{ ...body.items[2], name: "wor\u001b]8;;http://x\u0007ker‮" }] } };
        }
        return base(url);
      },
    });
    await openBead(mod, "gascity-card-ready-3");
    mod.click("gascity-bead-action-sling");
    expect(text(mod.render(), "gascity-dialog-buttons")).toBe("[worker] [Cancel]");
  });
});
