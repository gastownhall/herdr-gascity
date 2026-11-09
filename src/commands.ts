// The command grammar: what `herdr-app do gascity.<command>` and a keys.json
// `gascity.<command>` binding deliver to the shown copies' nextCommand().
//
// A command is a verb and its arguments, separated by ":" (herdr passes
// everything after the first "." unchanged). Each argument is
// percent-encoded (encodeURIComponent), so text may hold ":", "%" and "=":
//
//   submit:scratch:sc-20:close%20fe-1%20now
//
// The grammar is strict. An unknown verb, a wrong number of arguments, an
// empty id, a bad percent escape or a stray `confirm` is refused with a
// reason; nothing is guessed.
//
// herdr delivers a command to every copy on screen. So every command that
// changes gc state names its city first, and only a copy showing that city
// acts on it (copy.ts); and a delivery runs once per app (commandBook.ts):
// copies of the same city that get the same command text within a short
// window run it once. An optional last raw argument `nonce=<id>` makes a
// delivery distinct from an earlier one with the same text, keeps it unique
// for longer, and becomes the Idempotency-Key where gc declares one.
//
// Commands that change gc state name what they act on by gc's id (a session
// also by its exact alias or session name, refused when that matches more
// than one session); none acts on "the current selection".
//
// Destructive commands (the ones whose button asks first, and a new bead
// slung to an agent) take an explicit trailing `confirm`. Without it the
// command does what the button does — opens the same question or form —
// and sends nothing; with it, the command also answers the question, as
// clicking its button would. `confirm` is told apart by position only.
//
// Pure: no host calls.

import { err, ok, type Result } from "./result.ts";
import { cleanLine } from "./vm/sanitize.ts";

/** A command that changes gc state, in a named city. */
type InCity<T> = T & { city: string };

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
  | InCity<{ verb: "session-new"; agent: string; alias: string | null }>
  | InCity<{ verb: "wake" | "suspend" | "stop" | "pin" | "unpin"; session: string }>
  | InCity<{ verb: "close" | "kill" | "kill-force"; session: string; confirm: boolean }>
  | InCity<{ verb: "submit" | "interrupt" | "message"; session: string; text: string }>
  | InCity<{ verb: "answer"; session: string; requestId: string; option: string }>
  | InCity<{ verb: "agent-suspend"; name: string; confirm: boolean }>
  | InCity<{ verb: "rig-suspend"; name: string; confirm: boolean }>
  | InCity<{ verb: "agent-resume" | "rig-resume"; name: string }>
  | InCity<{ verb: "bead-new"; title: string; slingTo: string | null; confirm: boolean }>
  | InCity<{ verb: "sling"; bead: string; agent: string; confirm: boolean }>
  | InCity<{ verb: "bead-close"; bead: string; reason: string; confirm: boolean }>
  | InCity<{ verb: "bead-reopen"; bead: string }>;

/** A command that changes gc state (it names its city). */
export type MutatingCommand = Exclude<Extract<Command, { city: string }>, { verb: "focus-session" | "city" }>;

/** A parsed delivery: the command and its nonce, if it carried one. */
export interface Delivery {
  command: Command;
  nonce: string | null;
}

/** An argument: an id (non-empty), or text (may be empty). */
type Arg = { name: string; kind: "id" | "text" };

/** One verb's grammar. */
interface VerbSpec {
  /** It changes gc state: its first argument is the city, and a delivery runs once per app. */
  mutating: boolean;
  /** Required arguments, in order (after the city of a mutating verb). */
  args: readonly Arg[];
  /** Optional arguments after them (never with `confirm`, except bead-new's agent). */
  optional?: readonly Arg[];
  /** A trailing `confirm` argument answers the button's question. */
  confirm?: boolean;
  /** What it does, for the command reference. */
  summary: string;
  /** Builds the command; `a` starts with the city for a mutating verb. */
  build(a: readonly string[], confirm: boolean): Command;
}

const id = (name: string): Arg => ({ name, kind: "id" });
const text = (name: string): Arg => ({ name, kind: "text" });
const CITY = id("city");

/** The literal last argument of a confirmed destructive command. */
export const CONFIRM = "confirm";
/** An optional last raw argument `nonce=<id>`: letters, digits, ".", "_" and "-", at most 64. */
export const NONCE = /^nonce=([A-Za-z0-9._-]{1,64})$/;
/** Longer commands are refused. */
export const MAX_COMMAND_LENGTH = 8192;

const at = (a: readonly string[], i: number): string => a[i] ?? "";

/** Every verb, its arguments and what it does. The README's command reference lists exactly these. */
export const GRAMMAR: Readonly<Record<string, VerbSpec>> = {
  focus: {
    mutating: false,
    args: [],
    optional: [id("city"), id("session")],
    summary: "bare: take the keyboard; with a city and a session: select the city and open the session's detail",
    build: (a) => (a.length === 0 ? { verb: "focus" } : { verb: "focus-session", city: at(a, 0), session: at(a, 1) }),
  },
  city: {
    mutating: false, args: [id("city")], summary: "select a city (as the header's city list does; refused by a pinned copy)",
    build: (a) => ({ verb: "city", city: at(a, 0) }),
  },
  session: { mutating: false, args: [id("session")], summary: "open a session's detail (as clicking its row does)", build: (a) => ({ verb: "session", session: at(a, 0) }) },
  bead: { mutating: false, args: [id("bead")], summary: "open a bead's detail (as clicking its card does)", build: (a) => ({ verb: "bead", bead: at(a, 0) }) },
  refresh: { mutating: false, args: [], summary: "refetch everything now (Retry now; the r key)", build: () => ({ verb: "refresh" }) },
  probe: {
    mutating: false, args: [id("on-or-off")], summary: "turn the probe file on or off (shared for every copy)",
    build: (a) => ({ verb: "probe", on: at(a, 0) === "on" }),
  },
  cancel: { mutating: false, args: [], summary: "close the open question or form without acting (Cancel)", build: () => ({ verb: "cancel" }) },
  "session-new": {
    mutating: true,
    args: [id("agent")],
    optional: [text("alias")],
    summary: "start a session of an agent, with an optional alias (New session…, then Start session)",
    build: (a) => ({ verb: "session-new", city: at(a, 0), agent: at(a, 1), alias: a.length > 2 && at(a, 2) !== "" ? at(a, 2) : null }),
  },
  wake: { mutating: true, args: [id("session")], summary: "wake a session (Wake)", build: (a) => ({ verb: "wake", city: at(a, 0), session: at(a, 1) }) },
  suspend: { mutating: true, args: [id("session")], summary: "suspend a session (Suspend)", build: (a) => ({ verb: "suspend", city: at(a, 0), session: at(a, 1) }) },
  stop: { mutating: true, args: [id("session")], summary: "stop a session's current turn (Stop turn)", build: (a) => ({ verb: "stop", city: at(a, 0), session: at(a, 1) }) },
  pin: { mutating: true, args: [id("session")], summary: "pin a session awake (Pin)", build: (a) => ({ verb: "pin", city: at(a, 0), session: at(a, 1) }) },
  unpin: { mutating: true, args: [id("session")], summary: "clear a session's pin (Unpin)", build: (a) => ({ verb: "unpin", city: at(a, 0), session: at(a, 1) }) },
  close: {
    mutating: true, args: [id("session")], confirm: true, summary: "close a session (Close…, then Close)",
    build: (a, confirm) => ({ verb: "close", city: at(a, 0), session: at(a, 1), confirm }),
  },
  kill: {
    mutating: true, args: [id("session")], confirm: true, summary: "kill a session's runtime (Kill…, then Kill)",
    build: (a, confirm) => ({ verb: "kill", city: at(a, 0), session: at(a, 1), confirm }),
  },
  "kill-force": {
    mutating: true, args: [id("session")], confirm: true, summary: "force-kill a session's runtime (Kill…, then Force kill)",
    build: (a, confirm) => ({ verb: "kill-force", city: at(a, 0), session: at(a, 1), confirm }),
  },
  submit: {
    mutating: true, args: [id("session"), text("text")], summary: "send input to a session (Send)",
    build: (a) => ({ verb: "submit", city: at(a, 0), session: at(a, 1), text: at(a, 2) }),
  },
  interrupt: {
    mutating: true, args: [id("session"), text("text")], summary: "interrupt the turn and send input (Interrupt and send)",
    build: (a) => ({ verb: "interrupt", city: at(a, 0), session: at(a, 1), text: at(a, 2) }),
  },
  message: {
    mutating: true, args: [id("session"), text("text")], summary: "send a queued message to a session (Send as message)",
    build: (a) => ({ verb: "message", city: at(a, 0), session: at(a, 1), text: at(a, 2) }),
  },
  answer: {
    mutating: true,
    args: [id("session"), id("request"), id("option")],
    summary: "answer a session's pending prompt with one of gc's options (its answer button); the session's detail must show that prompt",
    build: (a) => ({ verb: "answer", city: at(a, 0), session: at(a, 1), requestId: at(a, 2), option: at(a, 3) }),
  },
  "agent-suspend": {
    mutating: true, args: [id("agent")], confirm: true, summary: "suspend an agent (Suspend agent…, then Suspend agent)",
    build: (a, confirm) => ({ verb: "agent-suspend", city: at(a, 0), name: at(a, 1), confirm }),
  },
  "agent-resume": {
    mutating: true, args: [id("agent")], summary: "resume an agent (Resume agent)",
    build: (a) => ({ verb: "agent-resume", city: at(a, 0), name: at(a, 1) }),
  },
  "rig-suspend": {
    mutating: true, args: [id("rig")], confirm: true, summary: "suspend a rig (Suspend rig…, then Suspend rig)",
    build: (a, confirm) => ({ verb: "rig-suspend", city: at(a, 0), name: at(a, 1), confirm }),
  },
  "rig-resume": {
    mutating: true, args: [id("rig")], summary: "resume a rig (Resume rig)",
    build: (a) => ({ verb: "rig-resume", city: at(a, 0), name: at(a, 1) }),
  },
  "bead-new": {
    mutating: true,
    args: [text("title")],
    optional: [id("agent")],
    confirm: true,
    summary: "create a bead (+ New bead, then Create); with an agent it is also slung there, which needs confirm (else the form opens filled in)",
    build: (a, confirm) => ({ verb: "bead-new", city: at(a, 0), title: at(a, 1), slingTo: a.length > 2 ? at(a, 2) : null, confirm }),
  },
  sling: {
    mutating: true, args: [id("bead"), id("agent")], confirm: true, summary: "sling a bead to an agent (Sling…, then the agent)",
    build: (a, confirm) => ({ verb: "sling", city: at(a, 0), bead: at(a, 1), agent: at(a, 2), confirm }),
  },
  "bead-close": {
    mutating: true, args: [id("bead"), text("reason")], confirm: true, summary: "close a bead with a reason, which may be empty (Close…, then Close bead)",
    build: (a, confirm) => ({ verb: "bead-close", city: at(a, 0), bead: at(a, 1), reason: at(a, 2), confirm }),
  },
  "bead-reopen": {
    mutating: true, args: [id("bead")], summary: "reopen a closed bead (Reopen)",
    build: (a) => ({ verb: "bead-reopen", city: at(a, 0), bead: at(a, 1) }),
  },
};

/** Whether a command changes gc state (and so names its city and runs once per app). */
export function isMutating(c: Command): c is MutatingCommand {
  const spec = GRAMMAR[c.verb];
  return spec?.mutating === true;
}

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

/** The argument counts a verb takes without `confirm` (a mutating verb's city included). */
function counts(verb: string, spec: VerbSpec): number[] {
  const lead = spec.mutating ? 1 : 0;
  if (verb === "focus") return [0, 2];
  const required = lead + spec.args.length;
  return Array.from({ length: (spec.optional?.length ?? 0) + 1 }, (_, k) => required + k);
}

/** Parses one delivery (the text after `gascity.`). */
export function parseCommand(raw: string): Result<Delivery, string> {
  if (raw.length > MAX_COMMAND_LENGTH) return err(`longer than ${MAX_COMMAND_LENGTH} characters`);
  const [verb = "", ...rest] = raw.split(":");
  const spec = Object.hasOwn(GRAMMAR, verb) ? GRAMMAR[verb] : undefined;
  if (!spec) return err(`unknown command "${shownCommand(verb)}"`);
  let parts = rest;
  let nonce: string | null = null;
  const last = NONCE.exec(parts.at(-1) ?? "");
  if (last) {
    nonce = last[1] ?? null;
    parts = parts.slice(0, -1);
  }
  const args: string[] = [];
  for (const [i, part] of parts.entries()) {
    const d = decode(part, i + 1);
    if (!d.ok) return d;
    args.push(d.value);
  }
  const allowed = counts(verb, spec);
  const most = Math.max(...allowed);
  let confirm = false;
  if (spec.confirm && args.length === most + 1) {
    if (args[most] !== CONFIRM) return err(`${verb}: the argument after ${placeholders(verb)} can only be "${CONFIRM}"`);
    confirm = true;
    args.pop();
  }
  if (!allowed.includes(args.length)) return err(`${verb}: expected ${usage(verb)}`);
  const kinds = [...(spec.mutating ? [CITY] : []), ...spec.args, ...(spec.optional ?? [])];
  for (const [i, value] of args.entries()) {
    const arg = kinds[i];
    if (arg?.kind === "id" && value.trim() === "") return err(`${verb}: <${arg.name}> is empty`);
  }
  if (verb === "probe" && args[0] !== "on" && args[0] !== "off") return err(`probe: expected "on" or "off", got "${shownCommand(args[0] ?? "")}"`);
  return ok({ command: spec.build(args, confirm), nonce });
}

/** A verb's arguments before a `confirm`, e.g. `<city>:<session>`. */
function placeholders(verb: string): string {
  const spec = GRAMMAR[verb];
  if (!spec) return "";
  return [...(spec.mutating ? [CITY] : []), ...spec.args, ...(spec.optional ?? [])].map((a) => `<${a.name}>`).join(":");
}

/** How a verb is written, e.g. `close:<city>:<session>[:confirm]`. */
export function usage(verb: string): string {
  const spec = GRAMMAR[verb];
  if (!spec) return verb;
  const req = [...(spec.mutating ? [CITY] : []), ...spec.args].map((a) => `:<${a.name}>`).join("");
  if (verb === "focus") return "focus[:<city>:<session>]";
  if (verb === "bead-new") return `bead-new${req}[:<agent>[:${CONFIRM}]]`;
  const opt = (spec.optional ?? []).map((a) => `[:<${a.name}>]`).join("");
  return `${verb}${req}${opt}${spec.confirm ? `[:${CONFIRM}]` : ""}`;
}

const enc = encodeURIComponent;
const confirmed = (c: { confirm: boolean }) => (c.confirm ? [CONFIRM] : []);

/** Writes a command in the grammar parseCommand reads (parseCommand(formatCommand(c, n)) gives c and n back). */
export function formatCommand(c: Command, nonce: string | null = null): string {
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
        return [c.verb, c.session];
      case "bead":
        return [c.verb, c.bead];
      case "probe":
        return [c.verb, c.on ? "on" : "off"];
      case "wake":
      case "suspend":
      case "stop":
      case "pin":
      case "unpin":
        return [c.verb, c.city, c.session];
      case "bead-reopen":
        return [c.verb, c.city, c.bead];
      case "session-new":
        return c.alias === null ? [c.verb, c.city, c.agent] : [c.verb, c.city, c.agent, c.alias];
      case "close":
      case "kill":
      case "kill-force":
        return [c.verb, c.city, c.session, ...confirmed(c)];
      case "submit":
      case "interrupt":
      case "message":
        return [c.verb, c.city, c.session, c.text];
      case "answer":
        return [c.verb, c.city, c.session, c.requestId, c.option];
      case "agent-suspend":
      case "rig-suspend":
        return [c.verb, c.city, c.name, ...confirmed(c)];
      case "agent-resume":
      case "rig-resume":
        return [c.verb, c.city, c.name];
      case "bead-new":
        return c.slingTo === null ? [c.verb, c.city, c.title] : [c.verb, c.city, c.title, c.slingTo, ...confirmed(c)];
      case "sling":
        return [c.verb, c.city, c.bead, c.agent, ...confirmed(c)];
      case "bead-close":
        return [c.verb, c.city, c.bead, c.reason, ...confirmed(c)];
    }
  })();
  const [verb, ...args] = parts;
  return [verb, ...args.map(enc), ...(nonce === null ? [] : [`nonce=${nonce}`])].join(":");
}
