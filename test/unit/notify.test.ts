// "Needs you" toasts and the shared focus target (src/notify/*): one toast
// per new pending interaction of a city, posted once per app however many
// copies show the city, never again after a refetch, a resync or a
// reconnect; and the newest fresh focus target wins.

import { afterEach, describe, expect, test } from "bun:test";
import { FOCUS_MAX_AGE_MS, decodeFocus, focusToApply, nextFocus } from "../../src/notify/focus.ts";
import { NeedsYouNotifier, TOAST_INTERVAL_MS, toastText, type NeedsYou } from "../../src/notify/needsYou.ts";
import { overlayOf } from "../../src/notify/window.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../src/sync/registry.ts";
import { FakeGc, FakeHost, fixtureBody } from "./sync/fakes.ts";
import type * as T from "../../src/gc/types.gen.ts";

const entry = (session: string, request: string, kind = "permission"): T.CityPendingEntry => ({ session_id: session, request_id: request, kind });
const list = (...items: T.CityPendingEntry[]) => ({ items });
const sessions = { items: (fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: T.SessionResponse[] }).items };

describe("the notifier", () => {
  test("the first list is the baseline; each new pair is toasted once", () => {
    const n = new NeedsYouNotifier("scratch");
    expect(n.observe(list(entry("sc-20", "r1")), sessions, 0)).toEqual([]);
    const added = n.observe(list(entry("sc-20", "r1"), entry("sc-6", "r2", "question")), sessions, 1000);
    expect(added).toEqual([{ city: "scratch", session: "sc-6", requestId: "r2", label: "frontend/builder", kind: "question" }]);
    // The same pairs again (a refetch, a resync after missed events, a reconnect): nothing.
    expect(n.observe(list(entry("sc-20", "r1"), entry("sc-6", "r2")), sessions, 2000)).toEqual([]);
    // Resolved, then back with the same request id (a list that was briefly partial): still nothing.
    expect(n.observe(list(), sessions, 3000)).toEqual([]);
    expect(n.observe(list(entry("sc-6", "r2")), sessions, 4000)).toEqual([]);
  });

  test("an unchanged list object is not looked at again; a list not fetched yet is not the baseline", () => {
    const n = new NeedsYouNotifier("scratch");
    expect(n.observe(null, null, 0)).toEqual([]);
    const first = list();
    expect(n.observe(first, null, 0)).toEqual([]);
    const second = list(entry("sc-5", "r1"));
    expect(n.observe(second, null, 0).map((x) => x.session)).toEqual(["sc-5"]);
    expect(n.observe(second, null, 0)).toEqual([]);
  });

  test("one toast per session per 30 s; a new request inside that window is remembered, not toasted later", () => {
    const n = new NeedsYouNotifier("scratch");
    n.observe(list(), sessions, 0);
    expect(n.observe(list(entry("sc-5", "a")), sessions, 1000)).toHaveLength(1);
    expect(n.observe(list(entry("sc-5", "a"), entry("sc-5", "b")), sessions, 2000)).toEqual([]);
    expect(n.observe(list(entry("sc-5", "a"), entry("sc-5", "b")), sessions, 1000 + TOAST_INTERVAL_MS)).toEqual([]);
    expect(n.observe(list(entry("sc-5", "c")), sessions, 1000 + TOAST_INTERVAL_MS).map((x) => x.requestId)).toEqual(["c"]);
  });

  test("a storm of new prompts on many sessions toasts each session once", () => {
    const n = new NeedsYouNotifier("scratch");
    n.observe(list(), null, 0);
    const many = list(...Array.from({ length: 5 }, (_, i) => entry(`s-${i}`, `r-${i}`)), entry("s-0", "r-x"));
    expect(n.observe(many, null, 10).map((x) => x.session)).toEqual(["s-0", "s-1", "s-2", "s-3", "s-4"]);
  });

  test("gc's text is cleaned; the label falls back to the template, then the id", () => {
    const n = new NeedsYouNotifier("scr\u001b[2Jatch");
    n.observe(list(), null, 0);
    const [x] = n.observe(list(entry("sc-\u0007zz", "r", "perm‮ission")), { items: [] }, 1);
    expect(x?.label).toBe("sc-zz");
    expect(x?.kind).toBe("permission");
    expect(toastText(x as NeedsYou)).toEqual({ title: "sc-zz needs you", body: "permission · session sc-\u0007zz · city scr\u001b[2Jatch".replace(/\u0007|\u001b\[2J/g, "") });
  });
});

describe("the focus target", () => {
  test("decodes only a target this build wrote", () => {
    expect(decodeFocus({ city: "c", session: "s", seq: 3, at: 10 })).toEqual({ city: "c", session: "s", seq: 3, at: 10 });
    for (const bad of [null, "x", [], { city: "c", session: "s", seq: -1, at: 1 }, { city: "", session: "s", seq: 1, at: 1 }, { city: "c", session: "s", seq: 1.5, at: 1 }]) {
      expect(decodeFocus(bad)).toBeNull();
    }
  });

  test("each new target is newer than the shared one", () => {
    const first = nextFocus(null, "c", "s1", 100);
    expect(first).toEqual({ city: "c", session: "s1", seq: 1, at: 100 });
    expect(nextFocus(first, "c", "s2", 200)).toEqual({ city: "c", session: "s2", seq: 2, at: 200 });
    expect(nextFocus("garbage", "c", "s3", 300).seq).toBe(1);
  });

  test("a copy applies the newest fresh target once", () => {
    const t = { city: "c", session: "s", seq: 4, at: 1_000 };
    expect(focusToApply(t, 0, 1_000)).toEqual(t);
    expect(focusToApply(t, 4, 1_000)).toBeNull();
    expect(focusToApply({ ...t, seq: 5 }, 4, 1_000)?.seq).toBe(5);
    expect(focusToApply(t, 0, 1_000 + FOCUS_MAX_AGE_MS + 1)).toBeNull();
    expect(focusToApply(t, 0, 1_000 - FOCUS_MAX_AGE_MS - 1)).toBeNull();
    expect(focusToApply(null, 0, 1_000)).toBeNull();
  });

  test("herdr's overlay props mark the window copy", () => {
    expect(overlayOf({ overlay: "mod-gascity" })).toBe("mod-gascity");
    expect(overlayOf({ city: "x" })).toBeNull();
    expect(overlayOf(null)).toBeNull();
    expect(overlayOf({ overlay: "" })).toBeNull();
    expect(overlayOf({ overlay: 3 })).toBeNull();
  });
});

describe("toasts from the shared store, under herdr's ownership rule", () => {
  let subs: Subscription[] = [];
  afterEach(() => {
    for (const s of subs) s.unsubscribe();
    subs = [];
  });

  /** gc whose city pending list is `pending` (mutable), and the toasts the registry asks to post. */
  function setup() {
    const host = new FakeHost();
    const gc = new FakeGc(host);
    gc.emit({ type: "order.fired", subject: "gate-sweep" });
    const pending = { items: [] as T.CityPendingEntry[] };
    gc.override = (req) => (req.path.endsWith("/v0/city/scratch/pending") ? { status: 200, body: { items: pending.items, total: pending.items.length } } : undefined);
    const toasts: { owner: string | null; items: readonly NeedsYou[] }[] = [];
    const registry = new SyncRegistry({
      fetch: host.wrap(gc.fetch),
      clock: host,
      random: () => 0.5,
      onNeedsYou: (items) => toasts.push({ owner: host.current, items }),
    });
    registry.setOnScreen(true);
    const open = async (owner: string) => {
      let sub: Subscription | null = null;
      await host.run(owner, () => {
        const made = registry.subscribe({ apiUrl: gc.base, city: "scratch" });
        if (!made.ok) throw new Error("subscribe");
        sub = made.value;
        host.every(TICK_MS, () => sub?.tick());
      });
      subs.push(sub as unknown as Subscription);
      return sub as unknown as Subscription;
    };
    const posted = () => toasts.flatMap((t) => t.items.map((i) => `${i.session}/${i.requestId}`));
    return { host, gc, pending, toasts, open, posted };
  }

  test("two copies of a city: each new prompt is toasted once, in a copy's own turn", async () => {
    const { host, gc, pending, toasts, open, posted } = setup();
    await open("copy-1");
    await open("copy-2");
    await host.advance(6000);
    expect(posted()).toEqual([]);
    pending.items = [entry("sc-20", "perm-1")];
    gc.emit({ type: "session.pending", subject: "sc-20" });
    await host.advance(6000);
    expect(posted()).toEqual(["sc-20/perm-1"]);
    expect(toasts.every((t) => t.owner === "copy-1" || t.owner === "copy-2")).toBe(true);
    await host.advance(30_000);
    expect(posted()).toEqual(["sc-20/perm-1"]);
  });

  test("no toast storm after a resync (missed events) or a reconnect after an outage", async () => {
    const { host, gc, pending, open, posted } = setup();
    pending.items = [entry("sc-20", "perm-1"), entry("sc-6", "q-1")];
    const a = await open("copy-1");
    await host.advance(6000);
    expect(posted()).toEqual([]); // already pending when the city was opened: the panel shows them
    // A gap in the events: every domain is refetched, including pending.
    gc.total = 500;
    gc.emit({ type: "session.pending", subject: "sc-20" });
    gc.events = gc.events.map((e) => ({ ...e, seq: e.seq + 100 }));
    await host.advance(6000);
    expect(a.snapshot().events.resyncs).toBe(1);
    expect(posted()).toEqual([]);
    // gc goes away and comes back with the same prompts, plus one new one.
    const before = gc.override;
    gc.override = () => ({ reject: "error sending request: connection refused" });
    await host.advance(20_000);
    expect(a.snapshot().connection.kind).toBe("backing-off");
    gc.override = before;
    pending.items = [...pending.items, entry("sc-5", "perm-2")];
    await host.advance(70_000);
    expect(posted()).toEqual(["sc-5/perm-2"]);
  });

  test("the last copy closing and a new one opening starts from a fresh baseline", async () => {
    const { host, pending, open, posted } = setup();
    const a = await open("copy-1");
    await host.advance(6000);
    await host.close("copy-1", () => a.unsubscribe());
    pending.items = [entry("sc-20", "perm-1")];
    await open("copy-2");
    await host.advance(6000);
    expect(posted()).toEqual([]);
  });
});
