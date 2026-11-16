// The open session pane's conversation, read from gc's per-session
// transcript (GET …/session/{id}/transcript) while the pane is open and on
// screen.
//
// Polled, not streamed: herdr's fetch reads a whole body under a 30 s total
// timeout, so it cannot read gc's session stream (SSE never ends: the read
// would hold a fetch slot for 30 s and then fail with nothing delivered).
//
// A conversation (format "conversation", from the session's log) is read once
// from its last compaction segment (`tail=1`), then followed with
// `after=<last turn id>`, so each poll carries only new turns. gc answers 409
// transcript-cursor-invalidated when it no longer has that entry (the log was
// rotated or replaced): the next read starts again from the tail. A session
// without a log (format "text") is a capture of its terminal with no ids: it
// is read whole each time.

import { isUnrecognized } from "../gc/decode.ts";
import type { GcError } from "../gc/errors.ts";
import type * as T from "../gc/types.gen.ts";

/** Turns kept per open pane, the newest. */
export const MAX_TURNS = 200;

/** What the pane shows: the newest turns, oldest first. */
export interface Transcript {
  /** "text" also stands for a format this pin does not know: read whole each time. */
  readonly format: "conversation" | "text";
  readonly turns: readonly T.OutputTurn[];
  /** Older turns exist that are not kept (gc said so, or MAX_TURNS dropped some). */
  readonly olderHidden: boolean;
}

/** The query of the next read: follow a conversation from its last turn id, else read from the tail. */
export function transcriptQuery(cur: Transcript | null): { tail: string } | { after: string } {
  const last = cur?.format === "conversation" ? cur.turns.at(-1)?.id : undefined;
  return last !== undefined && last !== "" ? { after: last } : { tail: "1" };
}

function bounded(turns: readonly T.OutputTurn[], olderHidden: boolean): Pick<Transcript, "turns" | "olderHidden"> {
  if (turns.length <= MAX_TURNS) return { turns, olderHidden };
  return { turns: turns.slice(turns.length - MAX_TURNS), olderHidden: true };
}

/** Joins an answer to what is kept. `after` is the cursor the read sent, or null for a read from the tail. */
export function mergeTranscript(cur: Transcript | null, after: string | null, r: T.SessionTranscriptGetResponse): Transcript {
  const format = isUnrecognized(r.format) ? "text" : r.format;
  if (cur !== null && after !== null && format === "conversation" && cur.format === "conversation") {
    const known = new Set(cur.turns.map((t) => t.id).filter((id) => id !== undefined));
    const fresh = r.turns.filter((t) => t.id === undefined || !known.has(t.id));
    if (fresh.length === 0) return cur;
    return { format, ...bounded([...cur.turns, ...fresh], cur.olderHidden) };
  }
  return { format, ...bounded(r.turns, r.pagination?.has_older_messages === true) };
}

/** gc no longer has the entry an `after` read named. */
export function cursorInvalidated(e: GcError): boolean {
  return e.kind === "http" && e.status === 409 && e.problem?.code === "transcript-cursor-invalidated";
}
