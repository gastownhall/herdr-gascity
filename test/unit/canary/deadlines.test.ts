// Every product stage's own deadlines end before its workflow step's timeout,
// so a stuck stage fails with its own message (classed by the stage) instead
// of being killed by the runner (classed infra by result.sh). A stage's
// deadline sum counts each `poll N`, `do_ok N` and `timeout N` in its function,
// and the sums of the helpers it calls (send, select_mod, ...).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SCRIPT = readFileSync(join(ROOT, "canary/canary-linux.sh"), "utf8");
const WORKFLOW = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/canary.yml"), "utf8")) as {
  jobs: Record<string, { steps: { run?: string; "timeout-minutes"?: number }[] }>;
};
/** Seconds a step's timeout must leave past the deadlines: a poll's last check (a 10 s curl) and the stage's own bookkeeping. */
const MARGIN_S = 60;

/** Top-level functions: `name() {` at column 0 up to the next `}` at column 0. */
function functions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^([a-z_]+)\(\) \{\n([\s\S]*?)^\}/gm)) out.set(m[1]!, m[2]!);
  return out;
}

const FNS = functions(SCRIPT);

/** The longest a function can wait on its own deadlines, in seconds. */
function deadlines(name: string, seen: string[] = []): number {
  const body = FNS.get(name);
  if (body === undefined) throw new Error(`no function ${name} in canary-linux.sh`);
  if (seen.includes(name)) throw new Error(`recursion through ${[...seen, name].join(" -> ")}`);
  let sum = 0;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/"[^"]*"/g, '""').replace(/#.*$/, "");
    if (/^\s*[a-z_]+\(\) \{/.test(line)) {
      // A predicate defined inline: its own calls run inside the enclosing poll.
      continue;
    }
    for (const m of line.matchAll(/\b(?:poll|do_ok|timeout) (\d+)\b/g)) sum += Number(m[1]);
    // A call is a word in command position: a line's start, or after ; & | ( { ! or $(.
    for (const m of line.matchAll(/(?:^|[;&|({!])\s*([a-z_]+)\b/g)) {
      if (m[1] !== name && FNS.has(m[1]!)) sum += deadlines(m[1]!, [...seen, name]);
    }
  }
  return sum;
}

/** stage -> its function, from the script's dispatcher. */
const STAGES = [...SCRIPT.matchAll(/^ {2}([a-z-]+)\) run_stage \1 [a-z]+ ([a-z_]+) ;;$/gm)].map((m) => ({ stage: m[1]!, fn: m[2]! }));

function stepTimeout(stage: string): number {
  const steps = WORKFLOW.jobs["canary"]!.steps.filter((s) => s.run === `canary/canary-linux.sh ${stage}`);
  expect({ stage, steps: steps.length }).toEqual({ stage, steps: 1 });
  return steps[0]!["timeout-minutes"]! * 60;
}

describe("stage deadlines end before the step's timeout", () => {
  test("the dispatcher lists every product stage", () => {
    expect(STAGES.map((s) => s.stage)).toEqual(["discover", "session", "output", "attach", "scope-audit", "keyboard", "bead-input", "bead-closed", "authority"]);
  });

  test("the helpers' sums are what the stages build on", () => {
    expect(deadlines("select_tab")).toBe(15);
    expect(deadlines("select_mod")).toBe(30);
    expect(deadlines("send")).toBe(60);
  });

  for (const { stage, fn } of STAGES) {
    test(`${stage}: its deadlines plus ${MARGIN_S}s fit in its step`, () => {
      const own = deadlines(fn);
      expect({ stage, fits: own + MARGIN_S <= stepTimeout(stage), own, step: stepTimeout(stage) }).toMatchObject({ stage, fits: true });
    });
  }

  test("keyboard's window focus has a deadline of its own", () => {
    expect(FNS.get("keyboard")).toMatch(/timeout \d+ xdotool windowfocus --sync/);
  });
});
