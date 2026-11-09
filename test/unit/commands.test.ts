// The command grammar (src/commands.ts): every command round-trips through
// formatCommand/parseCommand; malformed commands are refused with a reason,
// never guessed.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CONFIRM, GRAMMAR, MAX_COMMAND_LENGTH, formatCommand, parseCommand, shownCommand, usage, type Command } from "../../src/commands.ts";

const parsed = (raw: string) => {
  const r = parseCommand(raw);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.value;
};
const refusal = (raw: string) => {
  const r = parseCommand(raw);
  if (r.ok) throw new Error(`accepted: ${JSON.stringify(r.value)}`);
  return r.error;
};

/** One command of every shape, with text that needs encoding. */
const EXAMPLES: Command[] = [
  { verb: "focus" },
  { verb: "focus-session", city: "my city", session: "sc-20" },
  { verb: "city", city: "scratch" },
  { verb: "session", session: "frontend/builder" },
  { verb: "bead", bead: "fe-1" },
  { verb: "refresh" },
  { verb: "probe", on: true },
  { verb: "probe", on: false },
  { verb: "cancel" },
  { verb: "session-new", agent: "frontend/builder", alias: null },
  { verb: "session-new", agent: "worker", alias: "canary-n1" },
  { verb: "wake", session: "sc-20" },
  { verb: "suspend", session: "sc-20" },
  { verb: "stop", session: "sc-20" },
  { verb: "pin", session: "sc-20" },
  { verb: "unpin", session: "sc-20" },
  { verb: "close", session: "sc-20", confirm: false },
  { verb: "close", session: "sc-20", confirm: true },
  { verb: "kill", session: "sc-20", confirm: true },
  { verb: "kill-force", session: "sc-20", confirm: false },
  { verb: "submit", session: "sc-20", text: "close fe-1: done 100%" },
  { verb: "interrupt", session: "sc-20", text: "stop\nnow" },
  { verb: "message", session: "sc-20", text: "" },
  { verb: "answer", session: "sc-20", requestId: "perm-1", option: "approve" },
  { verb: "agent-suspend", name: "frontend/builder", confirm: true },
  { verb: "agent-resume", name: "worker" },
  { verb: "rig-suspend", name: "frontend", confirm: false },
  { verb: "rig-resume", name: "frontend" },
  { verb: "bead-new", title: "canary: n1", slingTo: null },
  { verb: "bead-new", title: "t", slingTo: "worker" },
  { verb: "sling", bead: "fe-1", agent: "worker", confirm: true },
  { verb: "bead-close", bead: "fe-1", reason: "", confirm: true },
  { verb: "bead-close", bead: "fe-1", reason: "confirm", confirm: false },
  { verb: "bead-reopen", bead: "fe-1" },
];

describe("round trip", () => {
  for (const c of EXAMPLES) {
    test(`${JSON.stringify(c)}`, () => {
      const text = formatCommand(c);
      expect(parsed(text)).toEqual(c);
    });
  }

  test("every verb of the grammar has an example", () => {
    const verbs = new Set(EXAMPLES.map((c) => formatCommand(c).split(":")[0]));
    expect([...verbs].sort()).toEqual(Object.keys(GRAMMAR).sort());
  });

  test("the canary's commands read as written", () => {
    expect(parsed("probe:on")).toEqual({ verb: "probe", on: true });
    expect(parsed("session-new:canary-agent:canary-n1")).toEqual({ verb: "session-new", agent: "canary-agent", alias: "canary-n1" });
    expect(parsed("focus:scratch:sc-20")).toEqual({ verb: "focus-session", city: "scratch", session: "sc-20" });
    expect(parsed("bead-new:canary%20n1")).toEqual({ verb: "bead-new", title: "canary n1", slingTo: null });
    expect(parsed("submit:sc-20:close%20fe-1%20n1")).toEqual({ verb: "submit", session: "sc-20", text: "close fe-1 n1" });
    expect(parsed("focus")).toEqual({ verb: "focus" });
  });

  test("text keeps colons and percent signs only when encoded", () => {
    expect(formatCommand({ verb: "submit", session: "s", text: "a:b%c" })).toBe("submit:s:a%3Ab%25c");
    // An unencoded colon is an argument separator: one argument too many.
    expect(refusal("submit:s:a:b")).toBe("submit: expected submit:<session>:<text>");
  });
});

describe("refusals", () => {
  test("an unknown verb, or a known one with different case", () => {
    expect(refusal("explode:sc-20")).toBe('unknown command "explode"');
    expect(refusal("Wake:sc-20")).toBe('unknown command "Wake"');
    expect(refusal("")).toBe('unknown command ""');
    expect(refusal("toString")).toBe('unknown command "toString"');
    expect(refusal("__proto__:x")).toBe('unknown command "__proto__"');
  });

  test("a wrong number of arguments says the usage", () => {
    expect(refusal("wake")).toBe("wake: expected wake:<session>");
    expect(refusal("wake:a:b")).toBe("wake: expected wake:<session>");
    expect(refusal("focus:scratch")).toBe("focus: expected focus[:<city>:<session>]");
    expect(refusal("answer:sc-20:perm-1")).toBe("answer: expected answer:<session>:<request>:<option>");
    expect(refusal("refresh:now")).toBe("refresh: expected refresh");
    expect(refusal("session-new:a:b:c")).toBe("session-new: expected session-new:<agent>[:<alias>]");
  });

  test("an empty id is refused; empty text is the copy's to refuse", () => {
    expect(refusal("wake:")).toBe("wake: <session> is empty");
    expect(refusal("wake:%20")).toBe("wake: <session> is empty");
    expect(refusal("sling::worker")).toBe("sling: <bead> is empty");
    expect(refusal("focus::sc-1")).toBe("focus: <city> is empty");
    expect(parsed("message:sc-20:")).toEqual({ verb: "message", session: "sc-20", text: "" });
  });

  test("confirm is a fixed, literal last argument of destructive commands only", () => {
    expect(refusal("close:sc-20:yes")).toBe('close: the argument after <session> can only be "confirm"');
    expect(refusal("close:sc-20:Confirm")).toBe('close: the argument after <session> can only be "confirm"');
    expect(refusal("close:sc-20:confirm:confirm")).toBe("close: expected close:<session>[:confirm]");
    expect(refusal("wake:sc-20:confirm")).toBe("wake: expected wake:<session>");
    // By position only: here "confirm" is the agent (which the copy then refuses unless the city has one).
    expect(parsed("sling:fe-1:confirm")).toEqual({ verb: "sling", bead: "fe-1", agent: "confirm", confirm: false });
    expect(refusal("sling:fe-1")).toBe("sling: expected sling:<bead>:<agent>[:confirm]");
    expect(CONFIRM).toBe("confirm");
  });

  test("probe takes on or off", () => {
    expect(refusal("probe:yes")).toBe('probe: expected "on" or "off", got "yes"');
    expect(refusal("probe")).toBe("probe: expected probe:<on-or-off>");
  });

  test("a bad percent escape, and an over-long command", () => {
    expect(refusal("submit:sc-20:100%")).toBe("argument 2 has a bad percent escape");
    expect(refusal(`submit:sc-20:${"a".repeat(MAX_COMMAND_LENGTH)}`)).toBe(`longer than ${MAX_COMMAND_LENGTH} characters`);
  });

  test("what a refusal quotes is cleaned and shortened", () => {
    expect(refusal("\u001b[31mevil‮")).toBe('unknown command "evil"');
    expect(shownCommand("x".repeat(200))).toHaveLength(80);
    expect(refusal("probe:\u0007on")).toBe('probe: expected "on" or "off", got "on"');
  });
});

describe("the reference", () => {
  test("the README lists every verb with its usage and what it does", async () => {
    const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
    for (const [verb, spec] of Object.entries(GRAMMAR)) {
      expect(readme).toContain(`\`${usage(verb)}\``);
      expect(readme).toContain(spec.summary);
    }
  });
});
