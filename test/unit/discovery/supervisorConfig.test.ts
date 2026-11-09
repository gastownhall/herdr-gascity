// The strict reader of gc's supervisor.toml: only [supervisor] bind and port
// matter, in exactly the syntax gc writes; anything it cannot read for sure in
// those keys is an error shown to the person, never a guess.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SUPERVISOR_BIND, DEFAULT_SUPERVISOR_PORT, parseSupervisorConfig, supervisorApiUrl,
} from "../../../src/discovery/supervisorConfig.ts";

const PATH = "/home/u/.gc/supervisor.toml";
const parse = (text: string) => parseSupervisorConfig(text, PATH);
const listen = (text: string) => {
  const r = parse(text);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.value;
};
const failure = (text: string) => {
  const r = parse(text);
  if (r.ok) throw new Error(`expected an error for: ${text}`);
  return r.error;
};

describe("reading bind and port", () => {
  test("an empty file or one without [supervisor] leaves both unset", () => {
    expect(listen("")).toEqual({ bind: null, port: null });
    expect(listen("# just a comment\n\n[events.export]\nendpoint = \"https://x\"\n")).toEqual({ bind: null, port: null });
  });

  test("the keys gc writes", () => {
    const text = [
      "# gc supervisor",
      "[supervisor]",
      "port = 9443",
      'bind = "127.0.0.1"   # loopback',
      'patrol_interval = "10s"',
      "allow_mutations = true",
      "",
    ].join("\n");
    expect(listen(text)).toEqual({ bind: "127.0.0.1", port: 9443 });
  });

  test("literal strings, spaced headers, quoted and dotted keys that name the same keys", () => {
    expect(listen("[ supervisor ]\nbind = '::1'\n")).toEqual({ bind: "::1", port: null });
    expect(listen('["supervisor"]\n"port" = 8400\n')).toEqual({ bind: null, port: 8400 });
    expect(listen("supervisor.port = 8401\n")).toEqual({ bind: null, port: 8401 });
    expect(listen("[supervisor]\nport=8402\r\nbind=\"localhost\"\r\n")).toEqual({ bind: "localhost", port: 8402 });
  });

  test("keys of other tables with the same names are not the supervisor's", () => {
    const text = "[events.export]\nport = 1\nbind = \"10.0.0.1\"\n[supervisor.extra]\nport = 2\n[supervisor]\nport = 9000\n";
    expect(listen(text)).toEqual({ bind: null, port: 9000 });
  });

  test("other values are skipped, whatever they contain", () => {
    const text = [
      "[supervisor]",
      'allowed_origins = ["http://[::1]:3000", # a comment with port = 1',
      "  'http://localhost:5173',",
      "]",
      'write_auth_verify_key = """',
      "[supervisor]",
      "port = 1",
      '"""',
      "x = { a = [1, 2], b = 'c#d' }",
      "y = '''multi",
      "port = 2'''",
      'z = "quote \\" and # hash"',
      "port = 8500",
    ].join("\n");
    expect(listen(text)).toEqual({ bind: null, port: 8500 });
  });

  test("port 0 and an empty bind mean gc's defaults, as in gc", () => {
    expect(listen('[supervisor]\nport = 0\nbind = ""\n')).toEqual({ bind: null, port: null });
  });
});

describe("strict: anything else in those keys is an error with its line", () => {
  const cases: [string, string, number, RegExp][] = [
    ["a float port", "[supervisor]\nport = 8372.0\n", 2, /port must be a whole number/],
    ["a string port", '[supervisor]\nport = "8372"\n', 2, /port must be a whole number/],
    ["an underscored port", "[supervisor]\nport = 8_372\n", 2, /port must be a whole number/],
    ["a hex port", "[supervisor]\nport = 0x20b4\n", 2, /port must be a whole number/],
    ["a leading-zero port", "[supervisor]\nport = 08372\n", 2, /port must be a whole number/],
    ["a negative port", "[supervisor]\nport = -1\n", 2, /port must be a whole number/],
    ["a port over 65535", "[supervisor]\nport = 70000\n", 2, /port 70000 is out of range/],
    ["a bare bind", "[supervisor]\nbind = 127.0.0.1\n", 2, /bind must be a string/],
    ["an escaped bind", '[supervisor]\nbind = "127.0.0.\\u0031"\n', 2, /escapes are not supported/],
    ["a multi-line bind", '[supervisor]\nbind = """127.0.0.1"""\n', 2, /bind must be a string/],
    ["trailing text after a value", "[supervisor]\nport = 8372 9000\n", 2, /unexpected text after the value/],
    ["a duplicate key", "[supervisor]\nport = 1\nport = 2\n", 3, /port is set twice/],
    ["a duplicate table", "[supervisor]\nport = 1\n[supervisor]\nbind = \"x\"\n", 3, /\[supervisor\] is defined twice/],
    ["an inline supervisor table", "supervisor = { port = 9000 }\n", 1, /supervisor must be a \[supervisor\] table/],
    ["an array of supervisor tables", "[[supervisor]]\nport = 1\n", 1, /supervisor must be a \[supervisor\] table/],
    ["a line that is neither key nor table", "[supervisor]\nport 8372\n", 2, /expected `key = value` or a \[table\] header/],
    ["an unterminated header", "[supervisor\nport = 1\n", 1, /unterminated table header/],
    ["an unterminated string elsewhere", 'x = "abc\nport = 1\n', 1, /unterminated string/],
    ["an unterminated multi-line string", 'x = """abc\n', 1, /unterminated string/],
    ["an unterminated array", "x = [1, 2\n", 1, /unterminated array or inline table/],
    ["an escaped quoted key", '["super\\u0076isor"]\nport = 1\n', 1, /escapes are not supported/],
  ];
  for (const [name, text, line, issue] of cases) {
    test(name, () => {
      const e = failure(text);
      expect(e.kind).toBe("supervisor-config");
      if (e.kind !== "supervisor-config") return;
      expect(e.path).toBe(PATH);
      expect(e.line).toBe(line);
      expect(e.issue).toMatch(issue);
    });
  }
});

describe("the API URL gc itself dials (cmd/gc supervisorAPIBaseURL)", () => {
  test("defaults: 127.0.0.1:8372", () => {
    expect(DEFAULT_SUPERVISOR_BIND).toBe("127.0.0.1");
    expect(DEFAULT_SUPERVISOR_PORT).toBe(8372);
    expect(supervisorApiUrl({ bind: null, port: null })).toBe("http://127.0.0.1:8372");
  });

  test("wildcard binds dial loopback: 0.0.0.0 → 127.0.0.1, :: → ::1", () => {
    expect(supervisorApiUrl({ bind: "0.0.0.0", port: 9000 })).toBe("http://127.0.0.1:9000");
    expect(supervisorApiUrl({ bind: "::", port: 9000 })).toBe("http://[::1]:9000");
    expect(supervisorApiUrl({ bind: "[::]", port: null })).toBe("http://[::1]:8372");
  });

  test("IPv6 literals are bracketed; names and IPv4 are not", () => {
    expect(supervisorApiUrl({ bind: "::1", port: 1 })).toBe("http://[::1]:1");
    expect(supervisorApiUrl({ bind: "localhost", port: 2 })).toBe("http://localhost:2");
    expect(supervisorApiUrl({ bind: "10.0.0.5", port: 3 })).toBe("http://10.0.0.5:3");
  });
});
