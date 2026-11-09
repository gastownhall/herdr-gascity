// The command grammar: what `herdr-app do gascity.<command>` and a keys.json
// `gascity.<command>` binding deliver to a shown copy's nextCommand().
//
// A command is a verb and its arguments, separated by ":" (herdr passes
// everything after the first "." unchanged). Each argument is
// percent-encoded (encodeURIComponent), so text may hold ":" and "%":
//
//   submit:sc-20:close%20fe-1%20now
//
// The grammar is strict. An unknown verb, a wrong number of arguments, an
// empty id, a bad percent escape or a stray `confirm` is refused with a
// reason; nothing is guessed. Commands that mutate name what they act on by
// gc's id (a session also by its exact alias or session name, refused when
// that matches more than one session); none acts on "the current selection".
//
// Destructive commands (the ones whose button asks first) take an explicit
// trailing `confirm` argument. Without it the command does what the button
// does — opens the same question — and sends nothing; with it, the command
// also answers the question, exactly as clicking its button would. Their
// argument count is fixed, so `confirm` is told apart by position only.
//
// Pure: no host calls. copy.ts runs a parsed command through the same
// methods the buttons call.

import { err, ok, type Result } from "./result.ts";
import { cleanLine } from "./vm/sanitize.ts";

/** What a command does, by verb. */
export type Command =
  /** Bare `focus` (herdr sends it when pane.go hands this copy the keyboard): focus the copy. */
  | { verb: "focus" }
  /** Show `session` of `city` (selects the city, then opens the session's detail). */
  | { verb: "focus-session"; city: string; session: string }
  | { verb: "city"; city: string }
  | { verb: "session"; session: string }
  | { verb: "bead"; bead: string }
  | { verb: "refresh" }
  | { verb: "probe"; on: boolean }
  | { verb: "cancel" }
  | { verb: "session-new"; agent: string; alias: string | null }
  | { verb: "wake" | "suspend" | "stop" | "pin" | "unpin"; session: string }
  | { verb: "close" | "kill" | "kill-force"; session: string; confirm: boolean }
  | { verb: "submit" | "interrupt" | "message"; session: string; text: string }
  | { verb: "answer"; session: string; requestId: string; option: string }
  | { verb: "agent-suspend" | "rig-suspend"; name: string; confirm: boolean }
  | { verb: "agent-resume" | "rig-resume"; name: string }
  | { verb: "bead-new"; title: string; slingTo: string | null }
  | { verb: "sling"; bead: string; agent: string; confirm: boolean }
  | { verb: "bead-close"; bead: string; reason: string; confirm: boolean }
  | { verb: "bead-reopen"; bead: string };

/** An argument: an id (non-empty), or text (may be empty). */
type Arg = { name: string; kind: "id" | "text" };

/** One verb's grammar. */
interface VerbSpec {
  /** Required arguments, in order. */
  args: readonly Arg[];
  /** Optional arguments after them (never with `confirm`). */
  optional?: readonly Arg[];
  /** A trailing `confirm` argument answers the button's question. */
  confirm?: boolean;
  /** What it does, for the command reference. */
  summary: string;
  build(a: readonly string[], confirm: boolean): Command;
}

const id = (name: string): Arg => ({ name, kind: "id" });
const text = (name: string): Arg => ({ name, kind: "text" });

/** The literal last argument of a confirmed destructive command. */
export const CONFIRM = "confirm";
/** Longer commands are refused. */
export const MAX_COMMAND_LENGTH = 8192;

const at = (a: readonly string[], i: number): string => a[i] ?? "";

/** Every verb, its arguments and what it does. The README's command reference lists exactly these. */
export const GRAMMAR: Readonly<Record<string, VerbSpec>> = {
  focus: {
    args: [],
    optional: [id("city"), id("session")],
    summary: "bare: take the keyboard; with a city and a session: select the city and open the session's detail",
    build: (a) => (a.length === 0 ? { verb: "focus" } : { verb: "focus-session", city: at(a, 0), session: at(a, 1) }),
  },
  city: { args: [id("city")], summary: "select a city (as the header's city list does)", build: (a) => ({ verb: "city", city: at(a, 0) }) },
  session: { args: [id("session")], summary: "open a session's detail (as clicking its row does)", build: (a) => ({ verb: "session", session: at(a, 0) }) },
  bead: { args: [id("bead")], summary: "open a bead's detail (as clicking its card does)", build: (a) => ({ verb: "bead", bead: at(a, 0) }) },
  refresh: { args: [], summary: "refetch everything now (Retry now; the r key)", build: () => ({ verb: "refresh" }) },
  probe: { args: [id("on-or-off")], summary: "turn the probe file on or off (shared for every copy)", build: (a) => ({ verb: "probe", on: at(a, 0) === "on" }) },
  cancel: { args: [], summary: "close the open question or form without acting (Cancel)", build: () => ({ verb: "cancel" }) },
  "session-new": {
    args: [id("agent")],
    optional: [text("alias")],
    summary: "start a session of an agent, with an optional alias (New session…, then Start session)",
    build: (a) => ({ verb: "session-new", agent: at(a, 0), alias: a.length > 1 && at(a, 1) !== "" ? at(a, 1) : null }),
  },
  wake: { args: [id("session")], summary: "wake a session (Wake)", build: (a) => ({ verb: "wake", session: at(a, 0) }) },
  suspend: { args: [id("session")], summary: "suspend a session (Suspend)", build: (a) => ({ verb: "suspend", session: at(a, 0) }) },
  stop: { args: [id("session")], summary: "stop a session's current turn (Stop turn)", build: (a) => ({ verb: "stop", session: at(a, 0) }) },
  pin: { args: [id("session")], summary: "pin a session awake (Pin)", build: (a) => ({ verb: "pin", session: at(a, 0) }) },
  unpin: { args: [id("session")], summary: "clear a session's pin (Unpin)", build: (a) => ({ verb: "unpin", session: at(a, 0) }) },
  close: {
    args: [id("session")], confirm: true, summary: "close a session (Close…, then Close)",
    build: (a, confirm) => ({ verb: "close", session: at(a, 0), confirm }),
  },
  kill: {
    args: [id("session")], confirm: true, summary: "kill a session's runtime (Kill…, then Kill)",
    build: (a, confirm) => ({ verb: "kill", session: at(a, 0), confirm }),
  },
  "kill-force": {
    args: [id("session")], confirm: true, summary: "force-kill a session's runtime (Kill…, then Force kill)",
    build: (a, confirm) => ({ verb: "kill-force", session: at(a, 0), confirm }),
  },
  submit: {
    args: [id("session"), text("text")], summary: "send input to a session (Send)",
    build: (a) => ({ verb: "submit", session: at(a, 0), text: at(a, 1) }),
  },
  interrupt: {
    args: [id("session"), text("text")], summary: "interrupt the turn and send input (Interrupt and send)",
    build: (a) => ({ verb: "interrupt", session: at(a, 0), text: at(a, 1) }),
  },
  message: {
    args: [id("session"), text("text")], summary: "send a queued message to a session (Send as message)",
    build: (a) => ({ verb: "message", session: at(a, 0), text: at(a, 1) }),
  },
  answer: {
    args: [id("session"), id("request"), id("option")],
    summary: "answer a session's pending prompt with one of gc's options (its answer button); the session's detail must show that prompt",
    build: (a) => ({ verb: "answer", session: at(a, 0), requestId: at(a, 1), option: at(a, 2) }),
  },
  "agent-suspend": {
    args: [id("agent")], confirm: true, summary: "suspend an agent (Suspend agent…, then Suspend agent)",
    build: (a, confirm) => ({ verb: "agent-suspend", name: at(a, 0), confirm }),
  },
  "agent-resume": { args: [id("agent")], summary: "resume an agent (Resume agent)", build: (a) => ({ verb: "agent-resume", name: at(a, 0) }) },
  "rig-suspend": {
    args: [id("rig")], confirm: true, summary: "suspend a rig (Suspend rig…, then Suspend rig)",
    build: (a, confirm) => ({ verb: "rig-suspend", name: at(a, 0), confirm }),
  },
  "rig-resume": { args: [id("rig")], summary: "resume a rig (Resume rig)", build: (a) => ({ verb: "rig-resume", name: at(a, 0) }) },
  "bead-new": {
    args: [text("title")],
    optional: [id("agent")],
    summary: "create a bead, and sling it to an agent if one is given (+ New bead, then Create / Create and sling)",
    build: (a) => ({ verb: "bead-new", title: at(a, 0), slingTo: a.length > 1 ? at(a, 1) : null }),
  },
  sling: {
    args: [id("bead"), id("agent")], confirm: true, summary: "sling a bead to an agent (Sling…, then the agent)",
    build: (a, confirm) => ({ verb: "sling", bead: at(a, 0), agent: at(a, 1), confirm }),
  },
  "bead-close": {
    args: [id("bead"), text("reason")], confirm: true, summary: "close a bead with a reason, which may be empty (Close…, then Close bead)",
    build: (a, confirm) => ({ verb: "bead-close", bead: at(a, 0), reason: at(a, 1), confirm }),
  },
  "bead-reopen": { args: [id("bead")], summary: "reopen a closed bead (Reopen)", build: (a) => ({ verb: "bead-reopen", bead: at(a, 0) }) },
};

/** The command as the person (or script) wrote it, safe to show: cleaned and shortened. */
export function shownCommand(raw: string): string {
  const line = cleanLine(raw);
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function decode(part: string, index: number): Result<string, string> {
  try {
    return ok(decodeURIComponent(part));
  } catch {
    return err(`argument ${index} has a bad percent escape`);
  }
}

/** Parses one command (the text after `gascity.`). */
export function parseCommand(raw: string): Result<Command, string> {
  if (raw.length > MAX_COMMAND_LENGTH) return err(`longer than ${MAX_COMMAND_LENGTH} characters`);
  const [verb = "", ...parts] = raw.split(":");
  const spec = Object.hasOwn(GRAMMAR, verb) ? GRAMMAR[verb] : undefined;
  if (!spec) return err(`unknown command "${shownCommand(verb)}"`);
  const args: string[] = [];
  for (const [i, part] of parts.entries()) {
    const d = decode(part, i + 1);
    if (!d.ok) return d;
    args.push(d.value);
  }
  const required = spec.args.length;
  const optional = spec.optional?.length ?? 0;
  let confirm = false;
  if (spec.confirm && args.length === required + 1) {
    if (args[required] !== CONFIRM) return err(`${verb}: the argument after ${spec.args.map((a) => `<${a.name}>`).join(":")} can only be "${CONFIRM}"`);
    confirm = true;
    args.pop();
  }
  // The optional arguments of `focus` come together (a city and a session).
  const counts = verb === "focus" ? [0, 2] : Array.from({ length: optional + 1 }, (_, k) => required + k);
  if (!counts.includes(args.length)) return err(`${verb}: expected ${usage(verb)}`);
  const kinds = [...spec.args, ...(spec.optional ?? [])];
  for (const [i, value] of args.entries()) {
    const arg = kinds[i];
    if (arg?.kind === "id" && value.trim() === "") return err(`${verb}: <${arg.name}> is empty`);
  }
  if (verb === "probe" && args[0] !== "on" && args[0] !== "off") return err(`probe: expected "on" or "off", got "${shownCommand(args[0] ?? "")}"`);
  return ok(spec.build(args, confirm));
}

/** How a verb is written, e.g. `close:<session>[:confirm]`. */
export function usage(verb: string): string {
  const spec = GRAMMAR[verb];
  if (!spec) return verb;
  const req = spec.args.map((a) => `:<${a.name}>`).join("");
  const opt = verb === "focus" ? "[:<city>:<session>]" : (spec.optional ?? []).map((a) => `[:<${a.name}>]`).join("");
  return `${verb}${req}${opt}${spec.confirm ? `[:${CONFIRM}]` : ""}`;
}

const enc = encodeURIComponent;

/** Writes a command in the grammar parseCommand reads (parseCommand(formatCommand(c)) equals c). */
export function formatCommand(c: Command): string {
  const parts = ((): string[] => {
    switch (c.verb) {
      case "focus":
      case "refresh":
      case "cancel":
        return [c.verb];
      case "focus-session":
        return ["focus", c.city, c.session];
      case "city":
        return [c.verb, c.city];
      case "session":
      case "wake":
      case "suspend":
      case "stop":
      case "pin":
      case "unpin":
        return [c.verb, c.session];
      case "bead":
      case "bead-reopen":
        return [c.verb, c.bead];
      case "probe":
        return [c.verb, c.on ? "on" : "off"];
      case "session-new":
        return c.alias === null ? [c.verb, c.agent] : [c.verb, c.agent, c.alias];
      case "close":
      case "kill":
      case "kill-force":
        return [c.verb, c.session, ...(c.confirm ? [CONFIRM] : [])];
      case "submit":
      case "interrupt":
      case "message":
        return [c.verb, c.session, c.text];
      case "answer":
        return [c.verb, c.session, c.requestId, c.option];
      case "agent-suspend":
      case "rig-suspend":
        return [c.verb, c.name, ...(c.confirm ? [CONFIRM] : [])];
      case "agent-resume":
      case "rig-resume":
        return [c.verb, c.name];
      case "bead-new":
        return c.slingTo === null ? [c.verb, c.title] : [c.verb, c.title, c.slingTo];
      case "sling":
        return [c.verb, c.bead, c.agent, ...(c.confirm ? [CONFIRM] : [])];
      case "bead-close":
        return [c.verb, c.bead, c.reason, ...(c.confirm ? [CONFIRM] : [])];
    }
  })();
  const [verb, ...args] = parts;
  return [verb, ...args.map(enc)].join(":");
}
