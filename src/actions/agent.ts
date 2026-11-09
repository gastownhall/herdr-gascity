// Agent actions: suspend and resume, by gc's qualified agent name ("worker"
// for a city agent, "<rig>/<name>" for a rig-scoped one, which gc serves at
// its own route). gc declares no Idempotency-Key on these, so a retry is a
// new request.

import * as ops from "../gc/ops.ts";
import { OPERATIONS, type OperationId } from "../gc/operations.gen.ts";
import { ok } from "../result.ts";
import type { ActionSpec } from "./activity.ts";
import { statusDetail } from "./answers.ts";

function operationFor(name: string): OperationId {
  return name.includes("/") ? "post-v0-city-by-city-name-agent-by-dir-by-base-by-action" : "post-v0-city-by-city-name-agent-by-base-by-action";
}

function agentAction(name: string, action: "suspend" | "resume"): ActionSpec {
  const operationId = operationFor(name);
  return {
    kind: action === "suspend" ? "agent.suspend" : "agent.resume",
    verb: action === "suspend" ? "Suspend agent" : "Resume agent",
    target: { kind: "agent", name },
    operationId,
    idempotent: OPERATIONS[operationId].idempotencyKey,
    confirm: action === "suspend"
      ? { question: `Suspend agent ${name}?`, detail: "gc suspends the agent and does not run its sessions until it is resumed." }
      : null,
    refresh: ["agents", "sessions"],
    send: async (c, city) => {
      const r = await ops.agentAction(c, city, name, action);
      return r.ok ? ok({ kind: "done" as const, detail: statusDetail(r.value) }) : r;
    },
  };
}

/** Suspends an agent (asks first). */
export function agentSuspend(name: string): ActionSpec {
  return agentAction(name, "suspend");
}

/** Resumes an agent. */
export function agentResume(name: string): ActionSpec {
  return agentAction(name, "resume");
}
