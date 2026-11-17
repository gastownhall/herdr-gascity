import { describe, expect, test } from "bun:test";
import type { CitiesSnapshot } from "../../../src/sync/cities.ts";
import type { CityNeeds, NeedsSnapshot } from "../../../src/sync/needs.ts";
import type * as T from "../../../src/gc/types.gen.ts";
import { SIDEBAR_DECISIONS, firstLine, inboxModel, sidebarModel } from "../../../src/vm/sidebar.ts";
import { NOW, bead } from "./snap.ts";

const DAY = 86_400_000;

function cities(...items: { name: string; running?: boolean; status?: string; error?: string }[]): CitiesSnapshot {
  return {
    rev: 1, fetchedAt: NOW, error: null,
    value: { items: items.map((c) => ({ path: `/c/${c.name}`, running: c.running ?? true, ...c })), unreadable: [], total: items.length },
  };
}

function status(extra: Partial<T.StatusBody> = {}): T.StatusBody {
  return {
    name: "x", suspended: false, uptime_sec: 1, partial_errors: [],
    agents: { total: 708, running: 355, suspended: 33, quarantined: 0 },
    rigs: { total: 8, suspended: 3 },
    work: { in_progress: 273, ready: 18095, open: 15812 },
    ...extra,
  };
}

function needs(city: string, parts: Partial<CityNeeds> = {}): [string, CityNeeds] {
  const human = parts.human ?? [];
  const reasons = new Map(human.map((b) => [b.id, ["human" as const]]));
  return [city, { city, waiting: [], human, reasons, humanTotal: human.length, status: status(), fetchedAt: NOW, error: null, ...parts }];
}

function snap(...entries: [string, CityNeeds][]): NeedsSnapshot {
  return { rev: 1, decisionLabel: "needs/operator", cities: new Map(entries), error: null };
}

const human = (n: number) => Array.from({ length: n }, (_, i) => bead(`d-${i}`, `decision ${i}`, { labels: ["human"], priority: i % 3, created_at: new Date(NOW - (i + 1) * DAY).toISOString() }));

describe("the sidebar block", () => {
  test("cities with questions first, then with decisions, then the rest by name; questions always listed", () => {
    const m = sidebarModel({
      cities: cities({ name: "alpha" }, { name: "beta" }, { name: "gamma" }, { name: "delta", running: false, status: "stopped" }),
      needs: snap(
        needs("alpha"),
        needs("beta", { human: human(5) }),
        needs("gamma", { waiting: [{ sessionId: "s-1", requestId: "r-1", kind: "question", who: "reviewer", lastActive: new Date(NOW - 2 * DAY).toISOString(), prompt: "\nShip it?\nmore detail" }] }),
      ),
      expanded: new Set(),
      now: NOW,
    });
    expect(m.cities.map((c) => c.name)).toEqual(["gamma", "beta", "alpha", "delta"]);
    expect([m.total, m.questions]).toEqual([6, 1]);
    const gamma = m.cities[0]!;
    expect(gamma.rows).toEqual([{ kind: "question", city: "gamma", session: "s-1", who: "reviewer", text: "Ship it?", age: "2 d" }]);
    const beta = m.cities[1]!;
    expect(beta.rows.length).toBe(SIDEBAR_DECISIONS);
    expect(beta.more).toBe(5 - SIDEBAR_DECISIONS);
    expect(beta.rows.map((r) => r.kind === "decision" && r.priority)).toEqual(["P0", "P0", "P1"]);
    expect(m.cities[3]).toMatchObject({ tone: "off", meta: "stopped", rows: [] });
    expect(m.cities[2]).toMatchObject({ tone: "ok", meta: "355 running", details: [] });
  });

  test("an unfolded city lists every decision and its counts", () => {
    const m = sidebarModel({ cities: cities({ name: "beta" }), needs: snap(needs("beta", { human: human(5), humanTotal: 15 })), expanded: new Set(["beta"]), now: NOW });
    const c = m.cities[0]!;
    expect(c.rows.length).toBe(5);
    expect(c.more).toBe(10);
    expect(c.decisions).toBe(15);
    expect(c.details).toEqual(["Agents: 355 of 708 running · 33 suspended", "Rigs: 8 · 3 suspended", "Work: 273 in progress · 18,095 ready"]);
  });

  test("a partial status, a failed read or quarantined agents read amber; gc's error on the city reads red", () => {
    const tones = sidebarModel({
      cities: cities({ name: "a" }, { name: "b" }, { name: "c" }, { name: "d", error: "boom" }),
      needs: snap(
        needs("a", { status: status({ partial: true, partial_errors: ["store health: timed out"] }) }),
        needs("b", { error: { kind: "http", status: 404, problem: null } as never }),
        needs("c", { status: status({ agents: { total: 1, running: 1, suspended: 0, quarantined: 1 } }) }),
        needs("d"),
      ),
      expanded: new Set(["a"]),
      now: NOW,
    }).cities;
    expect(Object.fromEntries(tones.map((c) => [c.name, c.tone]))).toEqual({ a: "warn", b: "warn", c: "warn", d: "bad" });
    expect(tones.find((c) => c.name === "a")?.details.at(-1)).toBe("Partial: store health: timed out");
  });

  test("before the city list: loading; a question with no prompt text says so", () => {
    expect(sidebarModel({ cities: null, needs: null, expanded: new Set(), now: NOW }).note).toBe("loading…");
    const m = sidebarModel({ cities: cities({ name: "a" }), needs: snap(needs("a", { waiting: [{ sessionId: "s", requestId: "r", kind: "tool-approval", who: null, lastActive: null, prompt: null }] })), expanded: new Set(), now: NOW });
    expect(m.cities[0]?.rows[0]).toMatchObject({ who: "s", text: "tool-approval (open it to read)", age: null });
  });

  test("firstLine takes the first non-empty line, cleaned and cut", () => {
    expect(firstLine("\n\n  hi\u0007 there \nnext")).toBe("hi there");
    expect(firstLine("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("the Needs a human pane", () => {
  const input = {
    cities: cities({ name: "alpha" }, { name: "beta" }, { name: "off", running: false }),
    needs: snap(
      needs("alpha", { waiting: [{ sessionId: "s-1", requestId: "r-1", kind: "question", who: "pm", lastActive: null, prompt: "Which?" }], human: human(1) }),
      needs("beta", { human: human(2), humanTotal: 60 }),
    ),
    city: null,
    now: NOW,
  };

  test("questions first, then decisions, from every running city, with counts by kind and city", () => {
    const m = inboxModel({ ...input, filter: "all" });
    expect(m.groups.map((g) => [g.title, g.rows.length])).toEqual([["Blocking a live session", 1], ["Waiting on a decision", 3]]);
    expect(m.counts).toEqual({ all: 62, questions: 1, decisions: 61 });
    expect(m.byCity).toEqual([{ name: "alpha", count: 2 }, { name: "beta", count: 60 }]);
    expect(m.notListed).toBe(58);
  });

  test("filters by kind and by city", () => {
    expect(inboxModel({ ...input, filter: "questions" }).groups.map((g) => g.title)).toEqual(["Blocking a live session"]);
    const beta = inboxModel({ ...input, filter: "decisions", city: "beta" });
    expect(beta.groups.flatMap((g) => g.rows.map((r) => r.city))).toEqual(["beta", "beta"]);
    expect(beta.counts).toEqual({ all: 60, questions: 0, decisions: 60 });
  });

  test("loading before the first poll", () => {
    expect(inboxModel({ ...input, needs: null, filter: "all" }).note).toBe("loading…");
  });
});
