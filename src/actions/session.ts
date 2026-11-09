// Session actions: start, wake, suspend, stop the turn, close, kill, pin,
// unpin, send input, send a message, answer a pending prompt. Each is one
// gc API call (ops.ts) with its Idempotency-Key where gc declares one. The
// prompt answer's verb is one of gc's own options, passed through as gc
// listed it.

import * as ops from "../gc/ops.ts";
import { OPERATIONS, type OperationId } from "../gc/operations.gen.ts";
import type * as T from "../gc/types.gen.ts";
import { ok } from "../result.ts";
import type { Domain } from "../sync/invalidate.ts";
import type { ActionKind, ActionSpec, Confirmation, Sent } from "./activity.ts";
import { accepted, sessionDetail, statusDetail } from "./answers.ts";

/** Lifecycle changes show in the session list and in the agents' roll-up. */
const LIFECYCLE: readonly Domain[] = ["sessions", "agents"];
/** Input changes the session (its turn, its output). */
const INPUT: readonly Domain[] = ["sessions"];
/** An answer clears the pending prompt. */
const ANSWER: readonly Domain[] = ["pending", "sessions"];

function spec(
  kind: ActionKind,
  verb: string,
  id: string,
  operationId: OperationId,
  refresh: readonly Domain[],
  confirm: Confirmation | null,
  send: ActionSpec["send"],
): ActionSpec {
  return { kind, verb, target: { kind: "session", id }, operationId, idempotent: OPERATIONS[operationId].idempotencyKey, confirm, refresh, send };
}

type Answer<V> = Promise<{ ok: true; value: V } | { ok: false; error: import("../gc/errors.ts").GcError }>;

/** Maps a successful answer to what the log shows; errors pass through. */
async function then<V>(answer: Answer<V>, read: (v: V) => Sent) {
  const r = await answer;
  return r.ok ? ok(read(r.value)) : r;
}

/** Starts a session of an agent (gc's template name); `alias` is optional. */
export function sessionNew(agent: string, alias: string | null): ActionSpec {
  const body: T.SessionCreateBody = { kind: "agent", name: agent };
  if (alias !== null && alias !== "") body.alias = alias;
  return {
    kind: "session.new",
    verb: "New session",
    target: { kind: "agent", name: agent },
    operationId: "create-session",
    idempotent: OPERATIONS["create-session"].idempotencyKey,
    confirm: null,
    refresh: LIFECYCLE,
    send: (c, city, key) => then(ops.createSession(c, city, body, key), accepted),
  };
}

/** Asks the controller to start the session. */
export function sessionWake(id: string): ActionSpec {
  return spec("session.wake", "Wake", id, "post-v0-city-by-city-name-session-by-id-wake", LIFECYCLE, null,
    (c, city, key) => then(ops.wakeSession(c, city, id, key), (b) => ({ kind: "done", detail: statusDetail(b) })));
}

/** Suspends the session. */
export function sessionSuspend(id: string): ActionSpec {
  return spec("session.suspend", "Suspend", id, "post-v0-city-by-city-name-session-by-id-suspend", LIFECYCLE, null,
    (c, city, key) => then(ops.suspendSession(c, city, id, key), (b) => ({ kind: "done", detail: statusDetail(b) })));
}

/** Stops the current turn; the session keeps running. */
export function sessionStop(id: string): ActionSpec {
  return spec("session.stop", "Stop turn", id, "post-v0-city-by-city-name-session-by-id-stop", LIFECYCLE, null,
    (c, city, key) => then(ops.stopSession(c, city, id, key), (b) => ({ kind: "done", detail: statusDetail(b) })));
}

/** Ends the session permanently. */
export function sessionClose(id: string): ActionSpec {
  return spec("session.close", "Close", id, "post-v0-city-by-city-name-session-by-id-close", LIFECYCLE, {
    question: `Close session ${id}?`,
    detail: "gc ends the session permanently: it stops its runtime and closes its session bead. A closed session cannot be woken again.",
  }, (c, city, key) => then(ops.closeSession(c, city, id, key), (b) => ({ kind: "done", detail: statusDetail(b) })));
}

/** Kills the session's runtime; `force` also past live background subagents or a hung runtime lease. */
export function sessionKill(id: string, force: boolean): ActionSpec {
  const confirm: Confirmation = force
    ? {
      question: `Force kill session ${id}?`,
      detail: "gc kills its runtime now, even with live background subagents or a hung runtime lease. Its work is kept and the session is left asleep.",
    }
    : {
      question: `Kill session ${id}?`,
      detail: "gc kills its runtime now, without waiting for the current turn. Its work is kept and the session is left asleep.",
    };
  return spec(force ? "session.kill-force" : "session.kill", force ? "Force kill" : "Kill", id, "post-v0-city-by-city-name-session-by-id-kill",
    LIFECYCLE, confirm, (c, city, key) => {
      const answer = force ? ops.killSession(c, city, id, key, { force: true }) : ops.killSession(c, city, id, key);
      return then(answer, (b) => ({ kind: "done", detail: statusDetail(b) }));
    });
}

/** Pins the session awake. gc declares no Idempotency-Key here. */
export function sessionPin(id: string): ActionSpec {
  return spec("session.pin", "Pin", id, "post-v0-city-by-city-name-session-by-id-pin", LIFECYCLE, null,
    (c, city) => then(ops.pinSession(c, city, id), (s) => ({ kind: "done", detail: sessionDetail(s) })));
}

/** Clears the session's pin. gc declares no Idempotency-Key here. */
export function sessionUnpin(id: string): ActionSpec {
  return spec("session.unpin", "Unpin", id, "post-v0-city-by-city-name-session-by-id-unpin", LIFECYCLE, null,
    (c, city) => then(ops.unpinSession(c, city, id), (s) => ({ kind: "done", detail: sessionDetail(s) })));
}

/** Sends input to the session (202; the outcome says delivered or queued). */
export function sessionSubmit(id: string, message: string, intent: "default" | "interrupt_now"): ActionSpec {
  const interrupt = intent === "interrupt_now";
  return spec(interrupt ? "session.interrupt" : "session.submit", interrupt ? "Interrupt and send" : "Send", id, "submit-session", INPUT, null,
    (c, city, key) => then(ops.submitSession(c, city, id, { message, intent }, key), accepted));
}

/** Sends a message to the session (202; gc queues it while the session is held or not running). */
export function sessionMessage(id: string, message: string): ActionSpec {
  return spec("session.message", "Send as message", id, "send-session-message", INPUT, null,
    (c, city, key) => then(ops.sendSessionMessage(c, city, id, { message }, key), accepted));
}

/** Answers the session's pending prompt `requestId` with one of gc's options. */
export function sessionRespond(id: string, requestId: string, option: string): ActionSpec {
  return spec("session.respond", option, id, "respond-session", ANSWER, null,
    (c, city, key) => then(ops.respondSession(c, city, id, { action: option, request_id: requestId }, key),
      (b) => ({ kind: "done", detail: statusDetail(b) })));
}
