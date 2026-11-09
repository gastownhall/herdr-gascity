// "Needs you" toasts and the shared focus target (src/notify/*): one toast
// per new pending interaction of a city, posted once per app however many
// copies show the city, never again after a refetch, a resync or a
// reconnect; and the newest fresh focus target wins.

import { afterEach, describe, expect, test } from "bun:test";
import { FOCUS_MAX_AGE_MS, decodeFocus, focusToApply, nextFocus } from "../../src/notify/focus.ts";
import { NeedsYouNotifier, summaryText, toastText, type NeedsYou, type NeedsYouBatch } from "../../src/notify/needsYou.ts";
import { overlayOf } from "../../src/notify/window.ts";
import { SyncRegistry, TICK_MS, type Subscription } from "../../src/sync/registry.ts";
import { FakeGc, FakeHost, fixtureBody } from "./sync/fakes.ts";
import type * as T from "../../src/gc/types.gen.ts";

const entry = (session: string, request: string, kind = "permission"): T.CityPendingEntry => ({ session_id: session, request_id: request, kind });
const list = (...items: T.CityPendingEntry[]) => ({ items });
const sessions = { items: (fixtureBody("get-v0-city-by-city-name-sessions", "ok") as { items: T.SessionResponse[] }).items };

/** What the notifier says to post now: "session/request" per toast, and how many more the summary covers. */
const post = (n: NeedsYouNotifier, pending: Parameters<NeedsYouNotifier["observe"]>[0], now: number, s: typeof sessions | null = sessions) => {
  const b = n.observe(pending, s, now);
  return { toasts: b.toasts.map((x) => `${x.session}/${x.requestId}`), more: b.more };
};
const none = { toasts: [], more: 0 };

describe("the notifier", () => {
  test("the first list is the baseline; each new pair is toasted once", () => {
    const n = new NeedsYouNotifier("scratch");
    expect(post(n, list(entry("sc-20", "r1")), 0)).toEqual(none);
    const b = n.observe(list(entry("sc-20", "r1"), entry("sc-6", "r2", "question")), sessions, 1000);
    expect(b).toEqual({ city: "scratch", toasts: [{ city: "scratch", session: "sc-6", requestId: "r2", label: "frontend/builder", kind: "question" }], more: 0 });
    // The same pairs again (a refetch, a resync after missed events, a reconnect): nothing.
    expect(post(n, list(entry("sc-20", "r1"), entry("sc-6", "r2")), 2000)).toEqual(none);
    // Resolved, then back with the same request id (a list that was briefly partial): still nothing.
    expect(post(n, list(), 3000)).toEqual(none);
    expect(post(n, list(entry("sc-6", "r2")), 4000)).toEqual(none);
  });

  test("a list not fetched yet is not the baseline", () => {
    const n = new NeedsYouNotifier("scratch");
    expect(post(n, null, 0, null)).toEqual(none);
    expect(post(n, list(), 0, null)).toEqual(none);
    const second = list(entry("sc-5", "r1"));
    expect(post(n, second, 0, null).toasts).toEqual(["sc-5/r1"]);
    expect(post(n, second, 0, null)).toEqual(none);
  });

  test("a session's next prompt within 30 s is deferred, not dropped: toasted once the window passes, if still pending", () => {
    const n = new NeedsYouNotifier("scratch");
    post(n, list(), 0);
    expect(post(n, list(entry("sc-5", "perm-1")), 5_000).toasts).toEqual(["sc-5/perm-1"]);
    // perm-1 answered; perm-2 arrives 10 s later.
    const next = list(entry("sc-5", "perm-2"));
    expect(post(n, next, 15_000)).toEqual(none);
    expect(post(n, next, 34_999)).toEqual(none);
    expect(post(n, next, 35_000).toasts).toEqual(["sc-5/perm-2"]);
    expect(post(n, next, 600_000)).toEqual(none);
  });

  test("a deferred prompt that was answered meanwhile is not toasted", () => {
    const n = new NeedsYouNotifier("scratch");
    post(n, list(), 0);
    post(n, list(entry("sc-5", "a")), 1000);
    post(n, list(entry("sc-5", "a"), entry("sc-5", "b")), 2000);
    expect(post(n, list(entry("sc-5", "a")), 3000)).toEqual(none);
    expect(post(n, list(entry("sc-5", "a")), 60_000)).toEqual(none);
  });

  test("a partial list does not resolve a deferred prompt", () => {
    const n = new NeedsYouNotifier("scratch");
    post(n, list(), 0);
    post(n, list(entry("sc-5", "a")), 1000);
    post(n, list(entry("sc-5", "a"), entry("sc-5", "b")), 2000);
    expect(post(n, { items: [], partial: true }, 3000)).toEqual(none);
    expect(post(n, { items: [], partial: true }, 31_000).toasts).toEqual(["sc-5/b"]);
  });

  test("a burst: at most 3 toasts, then one summary for the rest; one per session", () => {
    const n = new NeedsYouNotifier("scratch");
    post(n, list(), 0);
    const many = list(...Array.from({ length: 20 }, (_, i) => entry(`s-${i}`, `r-${i}`)), entry("s-0", "r-x"));
    expect(post(n, many, 10, null)).toEqual({ toasts: ["s-0/r-0", "s-1/r-1", "s-2/r-2"], more: 17 });
    // Covered by the summary: not toasted one by one later. s-0's second prompt waits for its session's window.
    expect(post(n, many, 20, null)).toEqual(none);
    expect(post(n, many, 30_010, null)).toEqual({ toasts: ["s-0/r-x"], more: 0 });
    expect(summaryText("scratch", 17)).toEqual({ title: "17 more sessions need you", body: "city scratch" });
  });

  test("a toast that could not be posted is tried again after the session's window, not dropped", () => {
    const n = new NeedsYouNotifier("scratch");
    post(n, list(), 0);
    const one = list(entry("sc-5", "a"));
    const b = n.observe(one, sessions, 1000);
    n.failed(b.toasts, 1000);
    expect(post(n, one, 2000)).toEqual(none);
    expect(post(n, one, 31_000).toasts).toEqual(["sc-5/a"]);
  });

  test("gc's text is cleaned; the label falls back to the template, then the id", () => {
    const n = new NeedsYouNotifier("scr\u001b[2Jatch");
    n.observe(list(), null, 0);
    const [x] = n.observe(list(entry("sc-\u0007zz", "r", "perm‮ission")), { items: [] }, 1).toasts;
    expect(x?.label).toBe("sc-zz");
    expect(x?.kind).toBe("permission");
    expect(toastText(x as NeedsYou)).toEqual({ title: "sc-zz needs you", body: "permission · session sc-zz · city scratch" });
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
    const fail = { next: null as string | null };
    const registry = new SyncRegistry({
      fetch: host.wrap(gc.fetch),
      clock: host,
      random: () => 0.5,
      onNeedsYou: (batch: NeedsYouBatch) => {
        if (fail.next !== null) {
          const message = fail.next;
          fail.next = null;
          return { failed: batch.toasts, errors: [message] };
        }
        toasts.push({ owner: host.current, items: batch.toasts });
        return { failed: [], errors: [] };
      },
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
    return { host, gc, pending, toasts, open, posted, fail };
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

  test("a toast that could not be posted is in the store's diagnostics and is posted after the session's window", async () => {
    const { host, gc, pending, open, posted, fail } = setup();
    const a = await open("copy-1");
    await host.advance(6000);
    fail.next = "the toast mod is gone";
    pending.items = [entry("sc-20", "perm-1")];
    gc.emit({ type: "session.pending", subject: "sc-20" });
    await host.advance(6000);
    expect(posted()).toEqual([]);
    expect(a.snapshot().errors.map((e) => [e.source, e.error])).toContainEqual(["toasts", { kind: "listener-failed", message: "the toast mod is gone" }]);
    await host.advance(30_000);
    expect(posted()).toEqual(["sc-20/perm-1"]);
  });
});
