// The activity log's view-model: a visible state per action (pending → done
// / failed / unknown), gc's answer or error, and a retry offered only after a
// failure, or after an unknown outcome once the state was refetched.

import { describe, expect, test } from "bun:test";
import type { ActionEntry, ActionState } from "../../../src/actions/activity.ts";
import { agentSuspend } from "../../../src/actions/agent.ts";
import * as session from "../../../src/actions/session.ts";
import { SAME_KEY_RETRY, activityModel, isBusy } from "../../../src/vm/activity.ts";
import { NOW, sessions, slot, snapshot } from "./snap.ts";

let ids = 0;
function entry(spec: ReturnType<typeof session.sessionWake>, state: ActionState, attempt = 1): ActionEntry {
  return { id: ++ids, spec, key: "k", attempt, startedAt: NOW - 5000, state, keyPinned: false };
}
const city = snapshot();

describe("activity rows", () => {
  test("newest first, each with its state and gc's answer", () => {
    const a = entry(session.sessionWake("sc-20"), { kind: "done", at: NOW - 3000, detail: "gc: ok", requestId: null });
    const b = entry(session.sessionSubmit("sc-20", "hi", "default"), { kind: "polling", requestId: "req-1", afterSeq: "9", acceptedAt: NOW - 2000, polls: 2, nextAt: NOW, inFlight: false, lastError: null });
    const c = entry(session.sessionStop("sc-20"), { kind: "sending", since: NOW - 1000 });
    const m = activityModel({ rev: 3, entries: [a, b, c] }, city, NOW);
    expect(m.rows.map((r) => [r.title, r.tone, r.detail, r.retry.kind])).toEqual([
      ["Stop turn · session sc-20", "pending", "sending (1 s)", "none"],
      ["Send · session sc-20", "pending", "accepted, waiting for gc's outcome of request req-1 (2 s)", "none"],
      ["Wake · session sc-20", "done", "gc: ok", "none"],
    ]);
    expect(m.rows[1]?.requestId).toBe("req-1");
  });

  test("a failure shows gc's reason, a hint for a pending prompt, and offers a retry", () => {
    const e = entry(session.sessionWake("sc-20"), {
      kind: "failed", at: NOW,
      error: { kind: "http", status: 409, problem: { code: "session-conflict", detail: "pending_interaction: approve first", errors: [] } },
    });
    const [r] = activityModel({ rev: 1, entries: [e] }, city, NOW).rows;
    expect(r?.tone).toBe("failed");
    expect(r?.detail).toBe("gc answered 409: pending_interaction: approve first (answer the pending prompt first)");
    expect(r?.retry).toEqual({ kind: "retry", label: "Retry" });
  });

  test("unknown: no retry until the state was refetched; then a retry that says whether gc deduplicates it", () => {
    const at = NOW - 500;
    const unknownState: ActionState = { kind: "unknown", at, error: { kind: "outcome-unknown", requestId: null, operationId: "x", cause: "timeout" } };
    const wake = entry(session.sessionWake("sc-20"), unknownState);
    const stale = snapshot({ sessions: slot(sessions([]), { ageMs: 1000 }) });
    const [waiting] = activityModel({ rev: 1, entries: [wake] }, stale, NOW).rows;
    expect(waiting?.tone).toBe("unknown");
    expect(waiting?.retry).toEqual({ kind: "wait", reason: "refreshing sessions before a retry" });
    expect(waiting?.refresh).toBe(true);
    expect(waiting?.detail).toContain("Refreshing the state before a retry is offered");

    const fresh = snapshot({ sessions: slot(sessions([]), { ageMs: 100 }), agents: slot({ items: [], total: 0, partial_errors: [], unreadable: [] }, { ageMs: 100 }) });
    const [ready] = activityModel({ rev: 1, entries: [wake] }, fresh, NOW).rows;
    expect(ready?.retry).toEqual({ kind: "retry", label: "Retry (same key: gc deduplicates it within 30 min, not across a gc restart)" });
    expect(ready?.detail).toContain("check it before retrying");

    const suspend = entry(agentSuspend("worker"), unknownState);
    const [twice] = activityModel({ rev: 1, entries: [suspend] }, fresh, NOW).rows;
    expect(twice?.retry).toEqual({ kind: "retry", label: "Retry (gc cannot deduplicate this: it may happen twice)" });
  });

  test("the gate counts a refetch only if it started after the outcome became unknown", () => {
    const at = NOW - 500;
    const wake = entry(session.sessionWake("sc-20"), { kind: "unknown", at, error: { kind: "outcome-unknown", requestId: null, operationId: "x", cause: "timeout" } });
    // Both lists arrived after `at`, but the session list's request had started before it.
    const s = snapshot({
      sessions: slot(sessions([]), { ageMs: 100 }), agents: slot({ items: [], total: 0, partial_errors: [], unreadable: [] }, { ageMs: 100 }),
      fetchStarts: { sessions: at - 1, agents: at + 1 },
    });
    expect(activityModel({ rev: 1, entries: [wake] }, s, NOW).rows[0]?.retry).toEqual({ kind: "wait", reason: "refreshing sessions before a retry" });
  });

  test("an action dropped before it was sent says so and may be retried", () => {
    const e = entry(session.sessionPin("sc-20"), { kind: "not-sent", at: NOW, reason: "no answer from the fetch queue within 70 s" });
    const [r] = activityModel({ rev: 1, entries: [e] }, city, NOW).rows;
    expect(r).toMatchObject({ tone: "not-sent", detail: "not sent: no answer from the fetch queue within 70 s", retry: { kind: "retry", label: "Retry" } });
  });

  test("after an attempt that may have landed, a later failed or unsent attempt says the retry keeps its key", () => {
    const e = { ...entry(session.sessionWake("sc-20"), { kind: "not-sent", at: NOW, reason: "the view closed" }, 2), keyPinned: true };
    const [r] = activityModel({ rev: 1, entries: [e] }, city, NOW).rows;
    expect(r?.detail).toBe("not sent: the view closed. An earlier attempt may have landed, so a retry keeps its key.");
    expect(r?.retry).toEqual({ kind: "retry", label: SAME_KEY_RETRY });
  });

  test("gc text is cleaned", () => {
    const e = entry(session.sessionWake("sc-20"), { kind: "done", at: NOW, detail: "gc: ok\u001b[31m\u0007", requestId: null });
    expect(activityModel({ rev: 1, entries: [e] }, city, NOW).rows[0]?.detail).toBe("gc: ok");
  });
});

describe("busy actions", () => {
  test("an action under way is not offered again; input actions always are", () => {
    const m = activityModel({
      rev: 1,
      entries: [
        entry(session.sessionWake("sc-20"), { kind: "sending", since: NOW }),
        entry(session.sessionSubmit("sc-20", "a", "default"), { kind: "sending", since: NOW }),
        entry(session.sessionStop("sc-20"), { kind: "done", at: NOW, detail: "ok", requestId: null }),
      ],
    }, city, NOW);
    expect(isBusy(m, session.sessionWake("sc-20"))).toBe(true);
    expect(isBusy(m, session.sessionWake("sc-5"))).toBe(false);
    expect(isBusy(m, session.sessionStop("sc-20"))).toBe(false);
    expect(isBusy(m, session.sessionSubmit("sc-20", "b", "default"))).toBe(false);
  });
});
