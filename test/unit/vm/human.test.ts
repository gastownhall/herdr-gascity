import { describe, expect, test } from "bun:test";
import { humanModel } from "../../../src/vm/human.ts";
import { NOW, bead, list, session, sessions, slot, snapshot } from "./snap.ts";

const DAY = 86_400_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("Needs a human", () => {
  test("questions first, named by the session's alias or template; then decisions by priority, then oldest first", () => {
    const s = snapshot({
      sessions: slot(sessions([session("s-1", "reviewer", { alias: "rev" }), session("s-2", "pm")])),
      pending: slot(list([{ session_id: "s-2", request_id: "r-2", kind: "tool-approval" }, { session_id: "s-1", request_id: "r-1", kind: "question" }, { session_id: "s-9", request_id: "r-9", kind: "" }])),
      human: slot(list([
        bead("d-none", "no priority", { labels: ["human"], created_at: at(9 * DAY) }),
        bead("d-p2-new", "p2 newer", { labels: ["human"], priority: 2, created_at: at(1 * DAY) }),
        bead("d-p2-old", "p2 older", { labels: ["human", "beadhive"], priority: 2, created_at: at(4 * DAY), assignee: "mayor" }),
        bead("d-p0", "urgent", { labels: ["human"], priority: 0, created_at: at(60_000) }),
      ])),
    });
    const m = humanModel({ snapshot: s, now: NOW, selectedSession: "s-1", selectedBead: "d-p2-old" });
    expect(m.rows.map((r) => (r.kind === "question" ? `${r.who}:${r.what}` : r.bead))).toEqual([
      "pm:tool-approval", "rev:question", "s-9:question", "d-p0", "d-p2-old", "d-p2-new", "d-none",
    ]);
    expect(m.rows[1]).toMatchObject({ kind: "question", session: "s-1", selected: true });
    expect(m.rows[4]).toEqual({
      kind: "decision", bead: "d-p2-old", title: "p2 older", priority: "P2", labels: ["beadhive"], assignee: "mayor", age: "4 d", selected: true,
    });
    expect(m.rows[3]).toMatchObject({ priority: "P0", age: "1 min", selected: false });
    expect(m.rows[6]).toMatchObject({ priority: null });
    expect([m.questions, m.decisions, m.more]).toEqual([3, 4, 0]);
  });

  test("a bead that closed or lost the label since the list was read is not listed", () => {
    const s = snapshot({ human: slot(list([bead("a", "closed", { labels: ["human"], status: "closed" }), bead("b", "unlabeled"), bead("c", "open", { labels: ["human"] })])) });
    expect(humanModel({ snapshot: s, now: NOW, selectedSession: null, selectedBead: null }).rows.map((r) => r.kind === "decision" && r.bead)).toEqual(["c"]);
  });

  test("gc's total beyond the page is counted as more", () => {
    const s = snapshot({ human: slot(list([bead("a", "x", { labels: ["human"] })], { total: 17 })) });
    const m = humanModel({ snapshot: s, now: NOW, selectedSession: null, selectedBead: null });
    expect([m.decisions, m.more]).toEqual([17, 16]);
  });

  test("strings from gc are cleaned", () => {
    const s = snapshot({ human: slot(list([bead("a\u0007", "ti‮tle", { labels: ["human", "x\u0000y"] })])) });
    const r = humanModel({ snapshot: s, now: NOW, selectedSession: null, selectedBead: null }).rows[0];
    expect(r).toMatchObject({ bead: "a", title: "title", labels: ["xy"] });
  });

  test("before the first answer the region is loading", () => {
    const s = snapshot({ human: { value: null, fetchedAt: null, error: null, dirty: true, held: false } });
    expect(humanModel({ snapshot: s, now: NOW, selectedSession: null, selectedBead: null }).region.kind).toBe("loading");
  });
});
