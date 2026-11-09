// What gc's events carry that the mod reads. Event payloads are untyped on the
// envelope (TypedEventStreamEnvelope.payload); the ones the mod uses are
// decoded here with the generated schemas, so a payload that does not match
// the pin is a decode error, never an untyped value flowing on.

import { decodeValue, type DecodeError } from "./decode.ts";
import { BeadEventPayloadSchema } from "./schemas.gen.ts";
import type * as T from "./types.gen.ts";
import { ok, type Result } from "../result.ts";

/** Event types whose payload is gc's BeadEventPayload: the whole bead after the change. */
const BEAD_PAYLOAD_EVENTS: ReadonlySet<string> = new Set(["bead.created", "bead.updated", "bead.closed", "bead.deleted"]);

/** The bead a bead event carries (decoded); null for an event type that carries none. */
export function eventBead(e: T.TypedEventStreamEnvelope): Result<T.Bead | null, DecodeError> {
  if (!BEAD_PAYLOAD_EVENTS.has(e.type)) return ok(null);
  const r = decodeValue(BeadEventPayloadSchema, e.payload, "get-v0-city-by-city-name-events", `event ${e.seq} ${e.type} payload`);
  return r.ok ? ok(r.value.bead) : r;
}
