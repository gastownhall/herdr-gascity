import { describe, expect, test } from "bun:test";
import { cleanLine, cleanText } from "../../../src/vm/sanitize.ts";

describe("cleanLine: one line of gc-supplied text", () => {
  test("plain text is unchanged", () => {
    expect(cleanLine("worker-1 fix login")).toBe("worker-1 fix login");
    expect(cleanLine("")).toBe("");
    expect(cleanLine("naïve — 東京 ✓")).toBe("naïve — 東京 ✓");
  });

  test("C0, DEL and C1 control characters are removed; line breaks and tabs become one space", () => {
    expect(cleanLine("a\u0000b\u0007c\u007fd\u0085e\u0080f")).toBe("abcdef");
    expect(cleanLine("one\r\ntwo\tthree\nfour")).toBe("one two three four");
  });

  test("ANSI escape sequences are removed whole, not left as visible debris", () => {
    expect(cleanLine("\u001b[31mred\u001b[0m")).toBe("red");
    expect(cleanLine("\u001b]8;;http://evil.example\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(cleanLine("\u001b]0;title\u001b\\after")).toBe("after");
    expect(cleanLine("\u009b2Jcleared")).toBe("cleared");
  });

  test("bidirectional overrides and zero-width format characters are removed", () => {
    expect(cleanLine("abc\u202edcba\u202c\u2066x\u2069\u200by\ufeff")).toBe("abcdcbaxy");
  });

  test("a lone escape at the end is removed", () => {
    expect(cleanLine("tail\u001b")).toBe("tail");
  });
});

describe("cleanText: multi-line output (peek)", () => {
  test("keeps line breaks and tabs; normalises CRLF and lone CR", () => {
    expect(cleanText("a\r\nb\rc\n\td")).toBe("a\nb\nc\n\td");
  });

  test("strips escapes and other controls", () => {
    expect(cleanText("\u001b[1mCANARY READY\u001b[0m\n\u0007done\u0000")).toBe("CANARY READY\ndone");
  });
});

describe("characters that reorder or hide text, or break lines out of band", () => {
  test("the Arabic letter mark (U+061C) is removed like the other bidi marks", () => {
    expect(cleanLine("abc\u061cdef")).toBe("abcdef");
  });

  test("Unicode tag characters (U+E0000–U+E007F) are removed: they carry invisible text", () => {
    // "hi" hidden as tag characters between a and b, plus the cancel tag
    expect(cleanLine("a\u{E0068}\u{E0069}b\u{E007F}c\u{E0000}")).toBe("abc");
    // characters next to the tag block are kept
    expect(cleanLine("\u{E0100}\u{1F600}")).toBe("\u{E0100}\u{1F600}");
  });

  test("line and paragraph separators (U+2028, U+2029) are line breaks: kept as LF in text, one space in a line", () => {
    expect(cleanText("a\u2028b\u2029c")).toBe("a\nb\nc");
    expect(cleanLine("a\u2028b\u2029c")).toBe("a b c");
  });

  test("cleaning stays idempotent", () => {
    const once = cleanText("x\u061c\u2028\u{E0041}y");
    expect(cleanText(once)).toBe(once);
  });
});
