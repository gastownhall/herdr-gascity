// The activity log's view-model, pure over the city's activity snapshot and
// its data snapshot: one row per action, newest first, with a visible state
// (pending → done / failed / unknown), gc's answer or error, and what the
// person may do next. A retry is offered after a failure, and after an
// unknown outcome only once the affected state has been refetched (the row
// says so meanwhile); after an unknown outcome on an operation gc does not
// deduplicate, the retry says it may happen twice.

import { isPending, targetKey, targetText, type ActionEntry, type ActionKind, type ActionSpec, type ActivitySnapshot } from "../actions/activity.ts";
import { retryGate } from "../actions/outcome.ts";
import { problemHint } from "../gc/errors.ts";
import type { CitySnapshot } from "../sync/store.ts";
import { errorText } from "./errorText.ts";
import { cleanLine } from "./sanitize.ts";

/** A row's state as the panel shows it. */
export type ActivityTone = "pending" | "done" | "failed" | "unknown" | "not-sent";

/**
 * The retry label after an unknown outcome on an operation gc deduplicates:
 * gc keeps Idempotency-Keys in memory for 30 minutes, and a gc restart
 * forgets them, so the promise is limited to that.
 */
export const SAME_KEY_RETRY = "Retry (same key: gc deduplicates it within 30 min, not across a gc restart)";
/** The retry label after an unknown outcome on an operation without Idempotency-Key. */
export const MAY_REPEAT_RETRY = "Retry (gc cannot deduplicate this: it may happen twice)";

/** What a row offers. */
export type RetryOffer =
  | { kind: "none" }
  | { kind: "retry"; label: string }
  | { kind: "wait"; reason: string };

export interface ActivityRow {
  id: number;
  kind: ActionKind;
  /** "Wake session sc-20". */
  title: string;
  tone: ActivityTone;
  /** gc's answer, the error, or what is happening now. */
  detail: string;
  requestId: string | null;
  attempt: number;
  retry: RetryOffer;
  /** "Refresh state" is offered for an unknown outcome. */
  refresh: boolean;
}

export interface ActivityModel {
  /** Newest first. */
  rows: ActivityRow[];
  /** `kind|target` of actions under way, so their buttons are not offered twice. */
  busy: ReadonlySet<string>;
}

/** Input actions may be sent again while an earlier one is under way (each is a different message). */
const REPEATABLE: ReadonlySet<ActionKind> = new Set(["session.submit", "session.interrupt", "session.message"]);

/** The busy key of an action. */
export function busyKey(spec: Pick<ActionSpec, "kind" | "target">): string {
  return `${spec.kind}|${targetKey(spec.target)}`;
}

/** Is an action like this one under way, so its button should wait? */
export function isBusy(model: ActivityModel | null, spec: Pick<ActionSpec, "kind" | "target">): boolean {
  return model !== null && !REPEATABLE.has(spec.kind) && model.busy.has(busyKey(spec));
}

function seconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))} s`;
}

/** After an attempt that may have landed, a later failure or unsent attempt says what a retry does. */
function pinnedNote(e: ActionEntry): string {
  if (!e.keyPinned) return "";
  return e.spec.idempotent
    ? ". An earlier attempt may have landed, so a retry keeps its key."
    : ". An earlier attempt may have landed, and gc cannot deduplicate this: a retry may make it happen twice.";
}

/** A failed or unsent action's retry: a plain "Retry" (new key) unless an earlier attempt may have landed. */
function retryLabel(e: ActionEntry): string {
  if (!e.keyPinned) return "Retry";
  return e.spec.idempotent ? SAME_KEY_RETRY : MAY_REPEAT_RETRY;
}

/**
 * Where a follow-up is, as the first action's row says it. Only a new bead
 * has a follow-up (its sling), so the wording names the bead.
 */
function followUpText(e: ActionEntry): string | null {
  const f = e.followUp;
  if (f === null) return null;
  let where: string;
  if (f.state.kind === "started") where = `sent (action ${f.state.id})`;
  else if (f.state.kind === "not-sent") where = `not sent, ${f.state.reason}`;
  else {
    switch (e.state.kind) {
      case "sending":
      case "polling":
      case "watching":
      case "done":
        where = "sent once the bead is created";
        break;
      case "unknown":
        where = "not sent, the bead may not exist; a retry of the create sends it once gc confirms the bead";
        break;
      case "failed":
      case "not-sent":
        where = "not sent, the bead was not created";
        break;
    }
  }
  return cleanLine(`then ${f.verb}: ${where}`);
}

function row(e: ActionEntry, city: CitySnapshot | null, now: number): ActivityRow {
  const r = stateRow(e, city, now);
  const then = followUpText(e);
  return then === null ? r : { ...r, detail: `${r.detail.replace(/\.$/, "")}; ${then}` };
}

function stateRow(e: ActionEntry, city: CitySnapshot | null, now: number): ActivityRow {
  const s = e.state;
  const base = {
    id: e.id,
    kind: e.spec.kind,
    title: cleanLine(`${e.spec.verb} · ${targetText(e.spec.target)}`),
    attempt: e.attempt,
    refresh: false,
    retry: { kind: "none" } as RetryOffer,
  };
  switch (s.kind) {
    case "sending":
      return { ...base, tone: "pending", detail: `sending (${seconds(now - s.since)})`, requestId: null };
    case "polling": {
      const last = s.lastError ? `; last poll: ${errorText(s.lastError)}` : "";
      return {
        ...base, tone: "pending", requestId: cleanLine(s.requestId),
        detail: cleanLine(`accepted, waiting for gc's outcome of request ${s.requestId} (${seconds(now - s.acceptedAt)})${last}`),
      };
    }
    case "watching":
      return { ...base, tone: "pending", detail: cleanLine(`${s.watch.detail} (${seconds(now - s.since)})`), requestId: null };
    case "done":
      return { ...base, tone: "done", detail: cleanLine(s.detail), requestId: s.requestId === null ? null : cleanLine(s.requestId) };
    case "failed": {
      const hint = problemHint(s.error) === "answer-pending-prompt" ? " (answer the pending prompt first)" : "";
      return {
        ...base, tone: "failed", detail: `${errorText(s.error)}${hint}${pinnedNote(e)}`,
        requestId: s.error.kind === "outcome-failed" ? cleanLine(s.error.requestId) : null,
        retry: { kind: "retry", label: retryLabel(e) },
      };
    }
    case "unknown": {
      const gate = city ? retryGate(e, city) : { allowed: false as const, reason: "no city data" };
      const twice = e.spec.idempotent ? SAME_KEY_RETRY : MAY_REPEAT_RETRY;
      return {
        ...base, tone: "unknown", refresh: true,
        requestId: s.error.requestId === null ? null : cleanLine(s.error.requestId),
        detail: gate.allowed
          ? `${errorText(s.error)}. The state has been refreshed: check it before retrying.`
          : `${errorText(s.error)}. Refreshing the state before a retry is offered.`,
        retry: gate.allowed ? { kind: "retry", label: twice } : { kind: "wait", reason: gate.reason },
      };
    }
    case "not-sent":
      return { ...base, tone: "not-sent", detail: cleanLine(`not sent: ${s.reason}${pinnedNote(e)}`), requestId: null, retry: { kind: "retry", label: retryLabel(e) } };
  }
}

/** The activity log for one city. */
export function activityModel(activity: ActivitySnapshot, city: CitySnapshot | null, now: number): ActivityModel {
  const busy = new Set<string>();
  for (const e of activity.entries) if (isPending(e.state)) busy.add(busyKey(e.spec));
  return { rows: [...activity.entries].reverse().map((e) => row(e, city, now)), busy };
}
