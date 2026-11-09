// A strict reader of gc's supervisor.toml (gc: internal/supervisor/config.go)
// for the two keys discovery needs: [supervisor] bind and port. It is not a
// TOML parser. It walks the file's structure (table headers, keys, and the
// extent of every value, including multi-line strings and arrays) so a key in
// another table or inside a string is never mistaken for the supervisor's,
// and it reads bind and port only in the plain forms gc and people write:
// a decimal integer and a string without escapes. Anything else in those keys,
// or a file whose structure it cannot follow, is a `supervisor-config` error
// with the line, shown to the person instead of guessed around.

import { err, ok, type Result } from "../result.ts";
import type { GcError } from "../gc/errors.ts";

/** gc's defaults (Section.BindOrDefault / PortOrDefault). */
export const DEFAULT_SUPERVISOR_BIND = "127.0.0.1";
export const DEFAULT_SUPERVISOR_PORT = 8372;

/** [supervisor] bind and port; null = not set (gc's default applies). */
export interface SupervisorListen {
  bind: string | null;
  port: number | null;
}

export type SupervisorConfigError = Extract<GcError, { kind: "supervisor-config" }>;

const MAX_PORT = 65535;
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

class ParseFailure {
  constructor(readonly line: number, readonly issue: string) {}
}

/** A cursor over the file text that counts lines. */
class Cursor {
  pos = 0;
  line = 1;
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.pos >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text.charAt(this.pos + offset);
  }

  startsWith(s: string): boolean {
    return this.text.startsWith(s, this.pos);
  }

  advance(n = 1): void {
    for (let i = 0; i < n && this.pos < this.text.length; i++) {
      if (this.text.charAt(this.pos) === "\n") this.line++;
      this.pos++;
    }
  }

  fail(issue: string, line = this.line): never {
    throw new ParseFailure(line, issue);
  }

  /** Spaces and tabs (not newlines). */
  skipBlanks(): void {
    while (this.peek() === " " || this.peek() === "\t") this.advance();
  }

  /** A comment, if one starts here, up to (not including) the newline. */
  skipComment(): void {
    if (this.peek() !== "#") return;
    while (!this.done && this.peek() !== "\n") this.advance();
  }

  /** Requires the rest of the line to be blanks and an optional comment, then consumes the newline. */
  endLine(): void {
    this.skipBlanks();
    this.skipComment();
    if (this.peek() === "\r") this.advance();
    if (this.done) return;
    if (this.peek() !== "\n") this.fail("unexpected text after the value");
    this.advance();
  }
}

/** A quoted key or table-name part: "..." or '...', single-line, without escapes. */
function readQuotedKey(c: Cursor): string {
  const quote = c.peek();
  c.advance();
  let out = "";
  for (;;) {
    if (c.done || c.peek() === "\n") c.fail("unterminated quoted key");
    const ch = c.peek();
    if (ch === quote) {
      c.advance();
      return out;
    }
    if (quote === '"' && ch === "\\") c.fail("escapes are not supported in quoted keys");
    out += ch;
    c.advance();
  }
}

/** A dotted key (`a.b."c"`), stopping before `stop` (`=` or `]`). */
function readDottedKey(c: Cursor, stop: string, what: string): string[] {
  const parts: string[] = [];
  for (;;) {
    c.skipBlanks();
    const ch = c.peek();
    if (ch === '"' || ch === "'") {
      parts.push(readQuotedKey(c));
    } else {
      let bare = "";
      while (!c.done && BARE_KEY.test(c.peek())) {
        bare += c.peek();
        c.advance();
      }
      if (bare === "") c.fail(what);
      parts.push(bare);
    }
    c.skipBlanks();
    if (c.peek() === ".") {
      c.advance();
      continue;
    }
    if (c.peek() === stop) return parts;
    c.fail(what);
  }
}

/** Skips a basic or literal string, single- or multi-line; the cursor is on its opening quote. */
function skipString(c: Cursor): void {
  const quote = c.peek();
  const startLine = c.line;
  const triple = quote.repeat(3);
  if (c.startsWith(triple)) {
    c.advance(3);
    for (;;) {
      if (c.done) c.fail("unterminated string", startLine);
      if (quote === '"' && c.peek() === "\\") {
        c.advance(2);
        continue;
      }
      if (c.startsWith(triple)) {
        c.advance(3);
        // A multi-line string may end with up to two more quotes of its kind.
        if (c.peek() === quote) c.advance();
        if (c.peek() === quote) c.advance();
        return;
      }
      c.advance();
    }
  }
  c.advance();
  for (;;) {
    if (c.done || c.peek() === "\n") c.fail("unterminated string", startLine);
    if (quote === '"' && c.peek() === "\\") {
      c.advance(2);
      continue;
    }
    if (c.peek() === quote) {
      c.advance();
      return;
    }
    c.advance();
  }
}

/** Skips any value up to the end of its line (arrays may span lines); does not judge it. */
function skipValue(c: Cursor): void {
  const startLine = c.line;
  let depth = 0;
  for (;;) {
    if (c.done) {
      if (depth > 0) c.fail("unterminated array or inline table", startLine);
      return;
    }
    const ch = c.peek();
    if (ch === '"' || ch === "'") skipString(c);
    else if (ch === "#") c.skipComment();
    else if (ch === "[" || ch === "{") {
      depth++;
      c.advance();
    } else if (ch === "]" || ch === "}") {
      if (depth === 0) c.fail("unbalanced bracket");
      depth--;
      c.advance();
    } else if (ch === "\n" && depth === 0) {
      return;
    } else c.advance();
  }
}

/** The raw text of a value that must sit on one line: up to a comment or the end of the line. */
function lineValue(c: Cursor): string {
  let out = "";
  while (!c.done && c.peek() !== "\n" && c.peek() !== "#") {
    out += c.peek();
    c.advance();
  }
  return out.replace(/\r$/, "").trim();
}

function readPort(c: Cursor): number | null {
  const line = c.line;
  const raw = lineValue(c);
  if (/^\d+\s+\S/.test(raw)) c.fail("unexpected text after the value", line);
  if (!DECIMAL.test(raw)) c.fail(`port must be a whole number from 0 to ${MAX_PORT}, written in decimal: ${raw}`, line);
  const port = Number(raw);
  if (port > MAX_PORT) c.fail(`port ${port} is out of range (0-${MAX_PORT})`, line);
  return port === 0 ? null : port;
}

function readBind(c: Cursor): string | null {
  const line = c.line;
  const quote = c.peek();
  if ((quote !== '"' && quote !== "'") || c.startsWith(quote.repeat(3))) {
    c.fail(`bind must be a string on one line: ${lineValue(c)}`, line);
  }
  c.advance();
  let out = "";
  for (;;) {
    if (c.done || c.peek() === "\n") c.fail("unterminated string", line);
    const ch = c.peek();
    if (ch === quote) {
      c.advance();
      break;
    }
    if (quote === '"' && ch === "\\") c.fail("bind: escapes are not supported", line);
    out += ch;
    c.advance();
  }
  return out === "" ? null : out;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/** Reads [supervisor] bind and port from supervisor.toml text; `path` names the file in errors. */
export function parseSupervisorConfig(text: string, path: string): Result<SupervisorListen, SupervisorConfigError> {
  const c = new Cursor(text);
  const result: SupervisorListen = { bind: null, port: null };
  const seen = new Set<string>();
  let table: string[] = [];
  let supervisorHeaderSeen = false;
  try {
    while (!c.done) {
      c.skipBlanks();
      c.skipComment();
      if (c.peek() === "\r") c.advance();
      if (c.done) break;
      if (c.peek() === "\n") {
        c.advance();
        continue;
      }
      const line = c.line;
      if (c.peek() === "[") {
        const arrayOfTables = c.peek(1) === "[";
        c.advance(arrayOfTables ? 2 : 1);
        if (c.done || c.peek() === "\n") c.fail("unterminated table header", line);
        const name = readDottedKey(c, "]", "unterminated table header");
        c.advance();
        if (arrayOfTables) {
          if (c.peek() !== "]") c.fail("unterminated table header", line);
          c.advance();
        }
        if (name[0] === "supervisor" && name.length === 1) {
          if (arrayOfTables) c.fail("supervisor must be a [supervisor] table", line);
          if (supervisorHeaderSeen) c.fail("[supervisor] is defined twice", line);
          supervisorHeaderSeen = true;
        }
        table = name;
        c.endLine();
        continue;
      }
      const key = [...table, ...readDottedKey(c, "=", "expected `key = value` or a [table] header")];
      c.advance();
      c.skipBlanks();
      if (samePath(key, ["supervisor"])) c.fail("supervisor must be a [supervisor] table", line);
      const which = samePath(key, ["supervisor", "port"]) ? "port" : samePath(key, ["supervisor", "bind"]) ? "bind" : null;
      if (which === null) {
        skipValue(c);
      } else {
        if (seen.has(which)) c.fail(`${which} is set twice`, line);
        seen.add(which);
        if (which === "port") result.port = readPort(c);
        else result.bind = readBind(c);
      }
      c.endLine();
    }
  } catch (e) {
    if (e instanceof ParseFailure) return err({ kind: "supervisor-config", path, line: e.line, issue: e.issue });
    throw e;
  }
  return ok(result);
}

/**
 * The API URL gc itself dials for this config (gc: cmd/gc supervisorAPIBaseURL):
 * defaults applied, wildcard binds mapped to loopback (0.0.0.0 → 127.0.0.1,
 * :: → ::1), IPv6 literals bracketed. It may still be non-loopback; the
 * caller's loopback guard decides.
 */
export function supervisorApiUrl(listen: SupervisorListen): string {
  let bind = listen.bind ?? DEFAULT_SUPERVISOR_BIND;
  if (bind === "0.0.0.0") bind = "127.0.0.1";
  else if (bind === "::" || bind === "[::]") bind = "::1";
  const host = bind.includes(":") && !bind.startsWith("[") ? `[${bind}]` : bind;
  return `http://${host}:${listen.port ?? DEFAULT_SUPERVISOR_PORT}`;
}
