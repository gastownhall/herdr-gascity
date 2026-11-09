// How the answers of gc's synchronous action endpoints read in the activity
// log: gc's status word, plus what gc adds (a replayed request, a rig
// action's stopped and failed sessions).

import type * as T from "../gc/types.gen.ts";

/** "gc: ok", "gc: ok (replayed)". */
export function statusDetail(body: { status: string; replayed?: boolean | undefined }): string {
  return `gc: ${body.status}${body.replayed ? " (replayed: gc had already done it)" : ""}`;
}

/** A pin/unpin answer: the session as gc now has it. */
export function sessionDetail(s: T.SessionResponse): string {
  return `gc: session ${s.id} ${s.state}${s.running ? ", running" : ""}`;
}

/** A rig action's answer, with the sessions it stopped and the ones it could not. */
export function rigDetail(body: T.RigActionBody): string {
  const parts = [`gc: ${body.status}`];
  if (body.killed.length > 0) parts.push(`stopped ${body.killed.join(", ")}`);
  if (body.failed.length > 0) parts.push(`failed ${body.failed.join(", ")}`);
  return parts.join("; ");
}

/** A 202 answer with a request to follow. */
export function accepted(body: T.AsyncAcceptedBody) {
  return { kind: "accepted" as const, requestId: body.request_id, afterSeq: body.event_cursor };
}
