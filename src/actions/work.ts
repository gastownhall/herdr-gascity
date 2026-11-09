// Work actions: create a bead (optionally slinging it to an agent), sling an
// existing bead, close and reopen a bead. Each is one gc API call (ops.ts);
// a new bead with a sling target is two, the sling being the create's
// follow-up (activity.ts FollowUp), sent for the bead gc created once the
// create is done.
//
// Idempotency-Key goes exactly where the pinned spec declares it: on
// create-bead, not on sling, close or reopen. So a retry of a create whose
// outcome is unknown is deduplicated by gc, while a retry of a sling is a new
// request that may route the bead twice; the sling asks first and says so.

import * as ops from "../gc/ops.ts";
import { OPERATIONS } from "../gc/operations.gen.ts";
import { isUnrecognized } from "../gc/decode.ts";
import type * as T from "../gc/types.gen.ts";
import { ok } from "../result.ts";
import type { Domain } from "../sync/invalidate.ts";
import type { ActionSpec } from "./activity.ts";
import { statusDetail } from "./answers.ts";

/** What the sling confirmation (and its retry) says about a repeat. */
export const SLING_MAY_ROUTE_TWICE =
  "gc cannot deduplicate a sling: if its outcome is unknown, a retry may route the bead twice. Check the board first.";

/** A new bead lands in Ready. */
const CREATED: readonly Domain[] = ["ready"];
/** A sling assigns the bead (it may move to In progress) and may start or nudge a session. */
const SLUNG: readonly Domain[] = ["ready", "inProgress", "sessions"];
/** Close and reopen move a bead between the board's columns (the closed list follows gc's events). */
const MOVED: readonly Domain[] = ["ready", "inProgress"];

/** The new-bead form, as the person filled it in. */
export interface NewBead {
  /** Required by gc (non-empty). */
  title: string;
  /** Blank: none. */
  description: string;
  /** null: gc's default. */
  priority: number | null;
  /** Empty: none. */
  labels: readonly string[];
}

/** Creates a bead; with `slingTo` (an agent's qualified name), slings it there once gc has created it. */
export function beadCreate(bead: NewBead, slingTo: string | null): ActionSpec {
  const body: T.BeadCreateInputBody = { title: bead.title };
  if (bead.description.trim() !== "") body.description = bead.description;
  if (bead.priority !== null) body.priority = bead.priority;
  if (bead.labels.length > 0) body.labels = [...bead.labels];
  const spec: ActionSpec = {
    kind: "bead.create",
    verb: "New bead",
    target: { kind: "new-bead", title: bead.title },
    operationId: "create-bead",
    idempotent: OPERATIONS["create-bead"].idempotencyKey,
    confirm: null,
    refresh: CREATED,
    send: async (c, city, key) => {
      const r = await ops.createBead(c, city, body, key);
      return r.ok ? ok({ kind: "done" as const, detail: `gc: created bead ${r.value.id}`, created: r.value.id }) : r;
    },
  };
  if (slingTo === null) return spec;
  return { ...spec, then: { verb: slingVerb(slingTo), spec: (created) => beadSling(created, slingTo) } };
}

function slingVerb(agent: string): string {
  return `Sling to ${agent}`;
}

/** What gc says it did with a sling. */
export function slingDetail(r: T.SlingResponse, bead: string): string {
  const status = isUnrecognized(r.status) ? r.status.raw : r.status;
  const parts = [`gc: ${status} bead ${r.bead ?? bead} to ${r.target}`];
  if (r.workflow_id !== undefined) parts.push(`workflow ${r.workflow_id}`);
  if (r.convoy_id !== undefined) parts.push(`convoy ${r.convoy_id}`);
  if (r.warnings.length > 0) parts.push(`warnings: ${r.warnings.join("; ")}`);
  return parts.join("; ");
}

/** Routes a bead to an agent (asks first: a retry may route it twice). */
export function beadSling(id: string, agent: string): ActionSpec {
  return {
    kind: "bead.sling",
    verb: slingVerb(agent),
    target: { kind: "bead", id },
    operationId: "post-v0-city-by-city-name-sling",
    idempotent: OPERATIONS["post-v0-city-by-city-name-sling"].idempotencyKey,
    confirm: {
      question: `Sling bead ${id} to ${agent}?`,
      detail: `gc routes the bead to ${agent} (and applies the agent's default formula, if it has one). ${SLING_MAY_ROUTE_TWICE}`,
    },
    refresh: SLUNG,
    send: async (c, city) => {
      const r = await ops.sling(c, city, { target: agent, bead: id });
      return r.ok ? ok({ kind: "done" as const, detail: slingDetail(r.value, id) }) : r;
    },
  };
}

/** Closes a bead with `reason` as its close reason (blank: none). Asks first. */
export function beadClose(id: string, reason: string): ActionSpec {
  const why = reason.trim();
  return {
    kind: "bead.close",
    verb: "Close",
    target: { kind: "bead", id },
    operationId: "post-v0-city-by-city-name-bead-by-id-close",
    idempotent: OPERATIONS["post-v0-city-by-city-name-bead-by-id-close"].idempotencyKey,
    confirm: {
      question: `Close bead ${id}?`,
      detail: why === "" ? "gc closes the bead, with no reason. Reopen brings it back." : `gc closes the bead with the reason "${why}". Reopen brings it back.`,
    },
    refresh: MOVED,
    send: async (c, city) => {
      const r = why === "" ? await ops.closeBead(c, city, id) : await ops.closeBead(c, city, id, { reason: why });
      return r.ok ? ok({ kind: "done" as const, detail: statusDetail(r.value) }) : r;
    },
  };
}

/** Reopens a closed bead. */
export function beadReopen(id: string): ActionSpec {
  return {
    kind: "bead.reopen",
    verb: "Reopen",
    target: { kind: "bead", id },
    operationId: "post-v0-city-by-city-name-bead-by-id-reopen",
    idempotent: OPERATIONS["post-v0-city-by-city-name-bead-by-id-reopen"].idempotencyKey,
    confirm: null,
    refresh: MOVED,
    send: async (c, city) => {
      const r = await ops.reopenBead(c, city, id);
      return r.ok ? ok({ kind: "done" as const, detail: statusDetail(r.value) }) : r;
    },
  };
}
