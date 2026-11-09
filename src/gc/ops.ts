// One typed function per gc operation the mod uses (design §4, §5.1): the
// "used surface". Each one is a single client call; none retries. Mutations
// whose pinned spec declares Idempotency-Key take the action's key, which a
// manual retry reuses (design §7.3).
//
// List responses come back as `Listed`: readable `items`, `unreadable`
// elements (item-level decode errors), and gc's `partial`/`partial_errors`.
// gc declares list fields as ["array","null"] for Go nil slices, so null
// decodes to [] (src/gc/decode.ts).

import type { GcClient } from "./client.ts";
import type { OperationTypes } from "./operations.gen.ts";
import type * as T from "./types.gen.ts";

type Query<Op extends keyof OperationTypes> = OperationTypes[Op]["query"];

// ---- reads ------------------------------------------------------------------

/** GET /health: liveness, version and build id. */
export function getHealth(c: GcClient) {
  return c.call("get-health", { path: {} });
}

/** GET /v0/cities: every city the supervisor manages, with running/status. */
export function listCities(c: GcClient) {
  return c.call("get-v0-cities", { path: {} });
}

/** GET a city's rigs. */
export function listRigs(c: GcClient, city: string) {
  return c.call("get-v0-city-by-city-name-rigs", { path: { cityName: city } });
}

/** GET a city's agents. */
export function listAgents(c: GcClient, city: string) {
  return c.call("get-v0-city-by-city-name-agents", { path: { cityName: city } });
}

/**
 * GET one page of a city's sessions (keyset-paginated: follow `next_cursor`).
 * No peek here; `wake_reasons` costs gc a runtime probe per session, so ask
 * for it only for an open detail.
 */
export function listSessions(
  c: GcClient,
  city: string,
  query: Pick<Query<"get-v0-city-by-city-name-sessions">, "limit" | "cursor" | "state" | "template" | "wake_reasons">,
) {
  return c.call("get-v0-city-by-city-name-sessions", { path: { cityName: city }, query });
}

/** GET one session; `peek` adds its last output. */
export function getSession(
  c: GcClient,
  city: string,
  id: string,
  query: Pick<Query<"get-v0-city-by-city-name-session-by-id">, "peek" | "peek_lines"> = {},
) {
  return c.call("get-v0-city-by-city-name-session-by-id", { path: { cityName: city, id }, query });
}

/** GET every pending interaction in a city. */
export function listPending(c: GcClient, city: string) {
  return c.call("get-v0-city-by-city-name-pending", { path: { cityName: city } });
}

/** GET one session's pending prompt and its options. */
export function getSessionPending(c: GcClient, city: string, id: string) {
  return c.call("get-v0-city-by-city-name-session-by-id-pending", { path: { cityName: city, id } });
}

/** GET a bounded page of work in gc's ready order (or by status). */
export function listWork(
  c: GcClient,
  city: string,
  query: Pick<Query<"get-v0-city-by-city-name-work-ready">, "limit" | "status" | "sort" | "exclude_type" | "exclude_label">,
) {
  return c.call("get-v0-city-by-city-name-work-ready", { path: { cityName: city }, query });
}

/** GET one bead. */
export function getBead(c: GcClient, city: string, id: string) {
  return c.call("get-v0-city-by-city-name-bead-by-id", { path: { cityName: city, id } });
}

/**
 * GET the newest events, newest first. Never blocking: without `index` gc
 * answers at once (design §7.0), so `index` and `wait` are not accepted. The
 * body's `total` is the event cursor (herdr's fetch cannot see X-GC-Index).
 */
export function pollEvents(c: GcClient, city: string, query: { limit: number }) {
  return c.call("get-v0-city-by-city-name-events", { path: { cityName: city }, query: { limit: query.limit } });
}

/** GET the outcome of a 202 request; `afterSeq` is the 202's `event_cursor`. */
export function getRequestOutcome(c: GcClient, city: string, requestId: string, afterSeq: string) {
  return c.call("get-request-outcome", { path: { cityName: city, requestId }, query: { after_seq: afterSeq } });
}

// ---- session mutations ------------------------------------------------------

/** POST a new session (202; follow with getRequestOutcome). */
export function createSession(c: GcClient, city: string, body: T.SessionCreateBody, idempotencyKey: string) {
  return c.call("create-session", { path: { cityName: city }, body, idempotencyKey });
}

/** POST input to a session (202). */
export function submitSession(c: GcClient, city: string, id: string, body: T.SessionSubmitInputBody, idempotencyKey: string) {
  return c.call("submit-session", { path: { cityName: city, id }, body, idempotencyKey });
}

/** POST a message to a session (202). */
export function sendSessionMessage(c: GcClient, city: string, id: string, body: T.SessionMessageInputBody, idempotencyKey: string) {
  return c.call("send-session-message", { path: { cityName: city, id }, body, idempotencyKey });
}

/** POST an answer to a session's pending prompt; `action` is one of the prompt's options. */
export function respondSession(c: GcClient, city: string, id: string, body: T.SessionRespondInputBody, idempotencyKey: string) {
  return c.call("respond-session", { path: { cityName: city, id }, body, idempotencyKey });
}

/** POST wake: the controller starts the session's runtime. */
export function wakeSession(c: GcClient, city: string, id: string, idempotencyKey: string) {
  return c.call("post-v0-city-by-city-name-session-by-id-wake", { path: { cityName: city, id }, idempotencyKey });
}

/** POST suspend. */
export function suspendSession(c: GcClient, city: string, id: string, idempotencyKey: string) {
  return c.call("post-v0-city-by-city-name-session-by-id-suspend", { path: { cityName: city, id }, idempotencyKey });
}

/** POST stop: ends the current turn; `body.turn` names the turn the person saw, when known. */
export function stopSession(c: GcClient, city: string, id: string, idempotencyKey: string, body?: T.SessionStopBody) {
  return c.call("post-v0-city-by-city-name-session-by-id-stop", { path: { cityName: city, id }, body, idempotencyKey });
}

/** POST close. */
export function closeSession(
  c: GcClient,
  city: string,
  id: string,
  idempotencyKey: string,
  query: Query<"post-v0-city-by-city-name-session-by-id-close"> = {},
) {
  return c.call("post-v0-city-by-city-name-session-by-id-close", { path: { cityName: city, id }, query, idempotencyKey });
}

/** POST kill. */
export function killSession(
  c: GcClient,
  city: string,
  id: string,
  idempotencyKey: string,
  query: Query<"post-v0-city-by-city-name-session-by-id-kill"> = {},
) {
  return c.call("post-v0-city-by-city-name-session-by-id-kill", { path: { cityName: city, id }, query, idempotencyKey });
}

/** POST pin (keep awake). gc declares no Idempotency-Key here (gap GA13). */
export function pinSession(c: GcClient, city: string, id: string) {
  return c.call("post-v0-city-by-city-name-session-by-id-pin", { path: { cityName: city, id } });
}

/** POST unpin. */
export function unpinSession(c: GcClient, city: string, id: string) {
  return c.call("post-v0-city-by-city-name-session-by-id-unpin", { path: { cityName: city, id } });
}

// ---- agent and rig mutations ------------------------------------------------

/**
 * POST suspend/resume an agent by its qualified name: "worker" (city-scoped)
 * or "<rig>/<name>" (rig-scoped, gc's /agent/{dir}/{base} route).
 */
export function agentAction(c: GcClient, city: string, agent: string, action: "suspend" | "resume") {
  const slash = agent.lastIndexOf("/");
  if (slash < 0) {
    return c.call("post-v0-city-by-city-name-agent-by-base-by-action", { path: { cityName: city, base: agent, action } });
  }
  return c.call("post-v0-city-by-city-name-agent-by-dir-by-base-by-action", {
    path: { cityName: city, dir: agent.slice(0, slash), base: agent.slice(slash + 1), action },
  });
}

/** POST suspend/resume/restart a rig. */
export function rigAction(c: GcClient, city: string, rig: string, action: "suspend" | "resume" | "restart") {
  return c.call("post-v0-city-by-city-name-rig-by-name-by-action", { path: { cityName: city, name: rig, action } });
}

// ---- work mutations ---------------------------------------------------------

/** POST sling: route a bead to an agent. No Idempotency-Key (gap GA13): a retry may route twice. */
export function sling(c: GcClient, city: string, body: T.SlingInputBody) {
  return c.call("post-v0-city-by-city-name-sling", { path: { cityName: city }, body });
}

/** POST a new bead. */
export function createBead(c: GcClient, city: string, body: T.BeadCreateInputBody, idempotencyKey: string) {
  return c.call("create-bead", { path: { cityName: city }, body, idempotencyKey });
}

/** POST close a bead, with an optional reason (recorded as close_reason). */
export function closeBead(c: GcClient, city: string, id: string, body?: T.BeadCloseBody) {
  return c.call("post-v0-city-by-city-name-bead-by-id-close", { path: { cityName: city, id }, body });
}

/** POST reopen a bead. */
export function reopenBead(c: GcClient, city: string, id: string) {
  return c.call("post-v0-city-by-city-name-bead-by-id-reopen", { path: { cityName: city, id } });
}
