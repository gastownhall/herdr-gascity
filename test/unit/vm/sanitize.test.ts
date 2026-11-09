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
