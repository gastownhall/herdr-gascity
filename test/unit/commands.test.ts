// The command grammar (src/commands.ts): every command round-trips through
// formatCommand/parseCommand; malformed commands are refused with a reason,
// never guessed; commands that change gc state name their city; an optional
// `nonce=<id>` rides along.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  CONFIRM, GRAMMAR, MAX_COMMAND_LENGTH, formatCommand, isMutating, parseCommand, shownCommand, usage, type Command, type Delivery,
} from "../../src/commands.ts";

const parsed = (raw: string): Delivery => {
  const r = parseCommand(raw);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.value;
};
const command = (raw: string): Command => parsed(raw).command;
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
  { verb: "session-new", city: "scratch", agent: "frontend/builder", alias: null },
  { verb: "session-new", city: "scratch", agent: "worker", alias: "canary-n1" },
  { verb: "wake", city: "scratch", session: "sc-20" },
  { verb: "suspend", city: "scratch", session: "sc-20" },
  { verb: "stop", city: "scratch", session: "sc-20" },
  { verb: "pin", city: "scratch", session: "sc-20" },
  { verb: "unpin", city: "scratch", session: "sc-20" },
  { verb: "close", city: "scratch", session: "sc-20", confirm: false },
  { verb: "close", city: "scratch", session: "sc-20", confirm: true },
  { verb: "kill", city: "scratch", session: "sc-20", confirm: true },
  { verb: "kill-force", city: "scratch", session: "sc-20", confirm: false },
  { verb: "submit", city: "scratch", session: "sc-20", text: "close fe-1: done 100% a=b" },
  { verb: "interrupt", city: "scratch", session: "sc-20", text: "stop\nnow" },
  { verb: "message", city: "scratch", session: "sc-20", text: "" },
  { verb: "answer", city: "scratch", session: "sc-20", requestId: "perm-1", option: "approve" },
  { verb: "agent-suspend", city: "scratch", name: "frontend/builder", confirm: true },
  { verb: "agent-resume", city: "scratch", name: "worker" },
  { verb: "rig-suspend", city: "scratch", name: "frontend", confirm: false },
  { verb: "rig-resume", city: "scratch", name: "frontend" },
  { verb: "bead-new", city: "scratch", title: "canary: n1", slingTo: null, confirm: false },
  { verb: "bead-new", city: "scratch", title: "t", slingTo: "worker", confirm: false },
  { verb: "bead-new", city: "scratch", title: "t", slingTo: "worker", confirm: true },
  { verb: "sling", city: "scratch", bead: "fe-1", agent: "worker", confirm: true },
  { verb: "bead-close", city: "scratch", bead: "fe-1", reason: "", confirm: true },
  { verb: "bead-close", city: "scratch", bead: "fe-1", reason: "confirm", confirm: false },
  { verb: "bead-reopen", city: "scratch", bead: "fe-1" },
];

describe("round trip", () => {
  for (const c of EXAMPLES) {
    test(`${JSON.stringify(c)}`, () => {
      expect(parsed(formatCommand(c))).toEqual({ command: c, nonce: null });
      expect(parsed(formatCommand(c, "n-1.a_b"))).toEqual({ command: c, nonce: "n-1.a_b" });
    });
  }

  test("every verb of the grammar has an example", () => {
    const verbs = new Set(EXAMPLES.map((c) => formatCommand(c).split(":")[0]));
    expect([...verbs].sort()).toEqual(Object.keys(GRAMMAR).sort());
  });

  test("every command that changes gc state names its city first; the others do not", () => {
    for (const c of EXAMPLES) {
      const verb = formatCommand(c).split(":")[0] ?? "";
      expect(isMutating(c)).toBe(GRAMMAR[verb]?.mutating === true);
      if (isMutating(c)) expect(usage(verb)).toStartWith(`${verb}:<city>`);
    }
    expect(Object.entries(GRAMMAR).filter(([, s]) => !s.mutating).map(([v]) => v).sort())
      .toEqual(["bead", "cancel", "city", "focus", "probe", "refresh", "session"]);
  });

  test("the canary's commands read as written", () => {
    expect(parsed("probe:on")).toEqual({ command: { verb: "probe", on: true }, nonce: null });
    expect(parsed("session-new:scratch:canary-agent:canary-n1:nonce=n1")).toEqual({
      command: { verb: "session-new", city: "scratch", agent: "canary-agent", alias: "canary-n1" }, nonce: "n1",
    });
    expect(command("focus:scratch:sc-20")).toEqual({ verb: "focus-session", city: "scratch", session: "sc-20" });
    expect(command("bead-new:scratch:canary%20n1")).toEqual({ verb: "bead-new", city: "scratch", title: "canary n1", slingTo: null, confirm: false });
    expect(command("submit:scratch:sc-20:close%20fe-1%20n1")).toEqual({ verb: "submit", city: "scratch", session: "sc-20", text: "close fe-1 n1" });
    expect(command("focus")).toEqual({ verb: "focus" });
  });

  test("text keeps colons, percent and equals signs only when encoded; a raw last nonce=… is the nonce", () => {
    expect(formatCommand({ verb: "submit", city: "c", session: "s", text: "a:b%c=d" })).toBe("submit:c:s:a%3Ab%25c%3Dd");
    expect(refusal("submit:c:s:a:b")).toBe("submit: expected submit:<city>:<session>:<text>");
    expect(command("submit:c:s:nonce%3Dx")).toMatchObject({ text: "nonce=x" });
    expect(parsed("submit:c:s:hi:nonce=x")).toEqual({ command: { verb: "submit", city: "c", session: "s", text: "hi" }, nonce: "x" });
    expect(parsed("refresh:nonce=r2").nonce).toBe("r2");
  });
});

describe("refusals", () => {
  test("an unknown verb, or a known one with different case", () => {
    expect(refusal("explode:sc-20")).toBe('unknown command "explode"');
    expect(refusal("Wake:scratch:sc-20")).toBe('unknown command "Wake"');
    expect(refusal("")).toBe('unknown command ""');
    expect(refusal("toString")).toBe('unknown command "toString"');
    expect(refusal("__proto__:x")).toBe('unknown command "__proto__"');
  });

  test("a wrong number of arguments says the usage; a command that changes gc state without its city is refused", () => {
    expect(refusal("wake")).toBe("wake: expected wake:<city>:<session>");
    expect(refusal("wake:sc-20")).toBe("wake: expected wake:<city>:<session>");
    expect(refusal("wake:a:b:c")).toBe("wake: expected wake:<city>:<session>");
    expect(refusal("focus:scratch")).toBe("focus: expected focus[:<city>:<session>]");
    expect(refusal("answer:scratch:sc-20:perm-1")).toBe("answer: expected answer:<city>:<session>:<request>:<option>");
    expect(refusal("refresh:now")).toBe("refresh: expected refresh");
    expect(refusal("session-new:s:a:b:c")).toBe("session-new: expected session-new:<city>:<agent>[:<alias>]");
    expect(refusal("bead-new:s")).toBe("bead-new: expected bead-new:<city>:<title>[:<agent>[:confirm]]");
  });

  test("an empty id is refused; empty text is the copy's to refuse", () => {
    expect(refusal("wake:scratch:")).toBe("wake: <session> is empty");
    expect(refusal("wake::sc-1")).toBe("wake: <city> is empty");
    expect(refusal("wake:scratch:%20")).toBe("wake: <session> is empty");
    expect(refusal("sling:scratch::worker")).toBe("sling: <bead> is empty");
    expect(refusal("focus::sc-1")).toBe("focus: <city> is empty");
    expect(command("message:scratch:sc-20:")).toEqual({ verb: "message", city: "scratch", session: "sc-20", text: "" });
  });

  test("confirm is a fixed, literal last argument of destructive commands only", () => {
    expect(refusal("close:scratch:sc-20:yes")).toBe('close: the argument after <city>:<session> can only be "confirm"');
    expect(refusal("close:scratch:sc-20:Confirm")).toBe('close: the argument after <city>:<session> can only be "confirm"');
    expect(refusal("close:scratch:sc-20:confirm:confirm")).toBe("close: expected close:<city>:<session>[:confirm]");
    expect(refusal("wake:scratch:sc-20:confirm")).toBe("wake: expected wake:<city>:<session>");
    // By position only: here "confirm" is the agent (which the copy then refuses unless the city has one).
    expect(command("sling:scratch:fe-1:confirm")).toEqual({ verb: "sling", city: "scratch", bead: "fe-1", agent: "confirm", confirm: false });
    expect(refusal("sling:scratch:fe-1")).toBe("sling: expected sling:<city>:<bead>:<agent>[:confirm]");
    // A new bead slung to an agent confirms after the agent; one without an agent needs none.
    expect(command("bead-new:s:t:worker:confirm")).toMatchObject({ slingTo: "worker", confirm: true });
    expect(command("bead-new:s:t:confirm")).toMatchObject({ slingTo: "confirm", confirm: false });
    expect(refusal("bead-new:s:t:worker:yes")).toBe('bead-new: the argument after <city>:<title>:<agent> can only be "confirm"');
    expect(CONFIRM).toBe("confirm");
  });

  test("probe takes on or off", () => {
    expect(refusal("probe:yes")).toBe('probe: expected "on" or "off", got "yes"');
    expect(refusal("probe")).toBe("probe: expected probe:<on-or-off>");
  });

  test("a bad percent escape, a bad nonce, and an over-long command", () => {
    expect(refusal("submit:scratch:sc-20:100%")).toBe("argument 3 has a bad percent escape");
    expect(refusal("wake:scratch:sc-20:nonce=a b")).toBe("wake: expected wake:<city>:<session>");
    expect(refusal(`wake:scratch:sc-20:nonce=${"x".repeat(65)}`)).toBe("wake: expected wake:<city>:<session>");
    expect(refusal(`submit:scratch:sc-20:${"a".repeat(MAX_COMMAND_LENGTH)}`)).toBe(`longer than ${MAX_COMMAND_LENGTH} characters`);
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
