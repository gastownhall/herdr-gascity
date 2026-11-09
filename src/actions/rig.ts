// Rig actions: suspend and resume. gc answers with the sessions it stopped
// and the ones it could not, which the activity log shows. gc declares no
// Idempotency-Key on these, so a retry is a new request.

import * as ops from "../gc/ops.ts";
import { OPERATIONS } from "../gc/operations.gen.ts";
import { ok } from "../result.ts";
import type { ActionSpec } from "./activity.ts";
import { rigDetail } from "./answers.ts";

const OP = "post-v0-city-by-city-name-rig-by-name-by-action";

function rigAction(name: string, action: "suspend" | "resume"): ActionSpec {
  return {
    kind: action === "suspend" ? "rig.suspend" : "rig.resume",
    verb: action === "suspend" ? "Suspend rig" : "Resume rig",
    target: { kind: "rig", name },
    operationId: OP,
    idempotent: OPERATIONS[OP].idempotencyKey,
    confirm: action === "suspend"
      ? { question: `Suspend rig ${name}?`, detail: "gc suspends the rig and may stop its running sessions; they do not run again until the rig is resumed." }
      : null,
    refresh: ["rigs", "agents", "sessions"],
    send: async (c, city) => {
      const r = await ops.rigAction(c, city, name, action);
      return r.ok ? ok({ kind: "done" as const, detail: rigDetail(r.value) }) : r;
    },
  };
}

/** Suspends a rig (asks first). */
export function rigSuspend(name: string): ActionSpec {
  return rigAction(name, "suspend");
}

/** Resumes a rig. */
export function rigResume(name: string): ActionSpec {
  return rigAction(name, "resume");
}
