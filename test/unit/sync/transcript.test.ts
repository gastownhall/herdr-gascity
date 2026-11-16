// The open session pane's transcript: which read comes next, how an answer
// joins what is kept, and gc's "cursor invalidated" answer.

import { describe, expect, test } from "bun:test";
import type { GcError } from "../../../src/gc/errors.ts";
import type * as T from "../../../src/gc/types.gen.ts";
import { MAX_TURNS, cursorInvalidated, mergeTranscript, transcriptQuery, type Transcript } from "../../../src/sync/transcript.ts";

function turn(id: string | undefined, text: string, role = "assistant"): T.OutputTurn {
  return id === undefined ? { role, text } : { id, role, text };
}

function conversation(turns: T.OutputTurn[], hasOlder = false): T.SessionTranscriptGetResponse {
  return { id: "s-1", format: "conversation", turns, pagination: { has_older_messages: hasOlder } };
}

function text(capture: string): T.SessionTranscriptGetResponse {
  return { id: "s-1", format: "text", turns: capture === "" ? [] : [turn(undefined, capture, "output")] };
}

describe("transcriptQuery", () => {
  test("the first read asks for the last compaction segment", () => {
    expect(transcriptQuery(null)).toEqual({ tail: "1" });
  });

  test("a conversation is followed from its last turn's id", () => {
    const t = mergeTranscript(null, null, conversation([turn("u1", "hi", "user"), turn("a1", "hello")]));
    expect(transcriptQuery(t)).toEqual({ after: "a1" });
  });

  test("an empty conversation, or one whose last turn has no id, is read again from the tail", () => {
    expect(transcriptQuery(mergeTranscript(null, null, conversation([])))).toEqual({ tail: "1" });
    expect(transcriptQuery(mergeTranscript(null, null, conversation([turn("a1", "x"), turn(undefined, "y")])))).toEqual({ tail: "1" });
  });

  test("a terminal capture (format text, no ids) is read whole every time", () => {
    expect(transcriptQuery(mergeTranscript(null, null, text("CANARY READY")))).toEqual({ tail: "1" });
  });
});

describe("mergeTranscript", () => {
  test("a read without a cursor replaces what was kept", () => {
    const first = mergeTranscript(null, null, conversation([turn("a1", "one")]));
    const again = mergeTranscript(first, null, conversation([turn("a2", "two")], true));
    expect(again).toEqual({ format: "conversation", turns: [turn("a2", "two")], olderHidden: true });
  });

  test("a read after a cursor appends the new turns, skipping any it already has", () => {
    const first = mergeTranscript(null, null, conversation([turn("u1", "hi", "user"), turn("a1", "hello")]));
    const next = mergeTranscript(first, "a1", conversation([turn("a1", "hello"), turn("u2", "more", "user"), turn("a2", "sure")]));
    expect(next.turns.map((x) => x.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(next.olderHidden).toBe(false);
  });

  test("an empty read after a cursor keeps the same object (nothing changed)", () => {
    const first = mergeTranscript(null, null, conversation([turn("a1", "hello")]));
    expect(mergeTranscript(first, "a1", conversation([]))).toBe(first);
  });

  test("a text answer to a cursor read (the session log went away) replaces the conversation", () => {
    const first = mergeTranscript(null, null, conversation([turn("a1", "hello")]));
    expect(mergeTranscript(first, "a1", text("$ prompt"))).toEqual({ format: "text", turns: [turn(undefined, "$ prompt", "output")], olderHidden: false });
  });

  test(`at most ${MAX_TURNS} turns are kept, the newest; dropping some says older turns are hidden`, () => {
    const many = Array.from({ length: MAX_TURNS + 5 }, (_, i) => turn(`t${i}`, `turn ${i}`));
    const t = mergeTranscript(null, null, conversation(many));
    expect(t.turns).toHaveLength(MAX_TURNS);
    expect(t.turns[0]?.id).toBe("t5");
    expect(t.olderHidden).toBe(true);
    const more = mergeTranscript(t, `t${MAX_TURNS + 4}`, conversation([turn("new", "newest")]));
    expect(more.turns).toHaveLength(MAX_TURNS);
    expect(more.turns.at(-1)?.id).toBe("new");
    expect(more.olderHidden).toBe(true);
  });

  test("a format this pin does not know is kept as text: read whole each time", () => {
    const t = mergeTranscript(null, null, { id: "s-1", format: { kind: "unrecognized", raw: "future" }, turns: [turn("x", "y")] });
    expect(t.format).toBe("text");
    expect(transcriptQuery(t)).toEqual({ tail: "1" });
  });
});

describe("cursorInvalidated", () => {
  test("gc's 409 transcript-cursor-invalidated problem", () => {
    const e: GcError = { kind: "http", status: 409, problem: { status: 409, code: "transcript-cursor-invalidated", errors: [] } };
    expect(cursorInvalidated(e)).toBe(true);
  });

  test("any other error is not", () => {
    expect(cursorInvalidated({ kind: "http", status: 409, problem: { status: 409, code: "session-conflict", errors: [] } })).toBe(false);
    expect(cursorInvalidated({ kind: "http", status: 500, problem: null })).toBe(false);
    expect(cursorInvalidated({ kind: "timeout", url: "u", ms: 30_000 })).toBe(false);
  });
});
