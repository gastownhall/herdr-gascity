// The agent-UI target list: the TOML file, kept in the company's private
// repo, that names each agent UI the canary metric counts, its designated
// canary job and the metric's step list. This parses it and checks that this
// repo's canary is the job the list designates for its UI, with every step
// mapped onto stages the canary runs.
//
// The file is private and this repo's logs are public, so publicReport says
// only what concerns this canary's own entry; problems in other entries are
// counted, never quoted, and a parse error quotes nothing from the file.
//
// CLI: bun canary/targets.ts --file <list.toml> [--workflow .github/workflows/canary.yml]
// exits (EXIT) 0 when the whole list checks out; 3 when this canary's entry
// checks out but other entries or the list as a whole have problems (not this
// canary's to report: the list's own repository tests those); 1 when this
// canary's own entry has a problem or is missing; 2 when it cannot check (a
// usage error, a file it cannot read, a list that does not parse, so whose
// entry is at fault is unknown).

import { readFileSync } from "node:fs";

/** A canary lane (canary.yml): what the metric counts is the latest-release lane. */
export type Lane = "latest-release" | "main";
const LANES: readonly Lane[] = ["latest-release", "main"];
/** The words a UI with no canary job carries in place of its job table. */
export const NO_JOB = "no job yet";

/** One step of the metric's run, in the list's order. */
export interface Step {
  id: string;
  text: string;
}

/** A UI's designated job: the workflow, its lane, and the stages that prove each step. */
export interface Job {
  repo: string;
  workflow: string;
  lane: Lane;
  stages: Record<string, string[]>;
}

/** One UI on the list; job is null when the list says "no job yet". */
export interface Ui {
  id: string;
  name: string;
  outcome: string;
  job: Job | null;
}

/** The parsed list. */
export interface TargetList {
  owner: string;
  metric: string;
  steps: Step[];
  uis: Ui[];
}

/** A problem in the list; ui is the entry it is in, null for the list as a whole. */
export interface ListError {
  ui: string | null;
  message: string;
}

/** The list (null when it cannot be read at all) and every problem in it. */
export interface Parsed {
  list: TargetList | null;
  errors: ListError[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Parses and validates the list; never throws. */
export function parseTargetList(text: string): Parsed {
  // Bun's TOML parser stops without an error at some non-ASCII characters
  // outside strings (a no-break space, a BOM) and drops the rest of the file,
  // which would read as this canary's entry missing. The list is ASCII, so
  // anything else means it does not parse.
  if (/[^\t\n\r\x20-\x7e]/.test(text)) return { list: null, errors: [{ ui: null, message: "the target list is not valid TOML" }] };
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch {
    return { list: null, errors: [{ ui: null, message: "the target list is not valid TOML" }] };
  }
  if (!isRecord(raw)) return { list: null, errors: [{ ui: null, message: "the target list is not a table" }] };
  const errors: ListError[] = [];
  const top = (message: string) => errors.push({ ui: null, message });

  const owner = str(raw["owner"]) ? raw["owner"] : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) top("owner is not an email address");
  const metric = str(raw["metric"]) ? raw["metric"] : "";
  if (metric === "") top("metric is missing");

  const steps: Step[] = [];
  const rawSteps = Array.isArray(raw["step"]) ? raw["step"] : [];
  if (rawSteps.length === 0) top("the list has no steps");
  for (const s of rawSteps) {
    if (!isRecord(s) || !str(s["id"]) || !ID.test(s["id"]) || !str(s["text"])) {
      top("a step needs an id (lowercase, digits, -) and a text");
      continue;
    }
    if (steps.some((t) => t.id === s["id"])) top(`step "${s["id"]}" is listed twice`);
    else steps.push({ id: s["id"], text: s["text"] });
  }

  const uis: Ui[] = [];
  const rawUis = Array.isArray(raw["ui"]) ? raw["ui"] : [];
  if (rawUis.length === 0) top("the list has no UIs");
  for (const [i, u] of rawUis.entries()) {
    if (!isRecord(u) || !str(u["id"]) || !ID.test(u["id"])) {
      top(`UI ${i + 1} has no id (lowercase, digits, -)`);
      continue;
    }
    const id = u["id"];
    const err = (message: string) => errors.push({ ui: id, message });
    if (uis.some((v) => v.id === id)) err("listed twice");
    if (!str(u["name"])) err("name is missing");
    if (!str(u["outcome"])) err("outcome (the work's outcome in the UI's own model) is missing");
    const job = parseJob(u["job"], steps, err);
    uis.push({ id, name: str(u["name"]) ? u["name"] : "", outcome: str(u["outcome"]) ? u["outcome"] : "", job });
  }
  return { list: { owner, metric, steps, uis }, errors };
}

function parseJob(raw: unknown, steps: readonly Step[], err: (m: string) => void): Job | null {
  if (raw === NO_JOB) return null;
  if (!isRecord(raw)) {
    err(`job is neither a table nor "${NO_JOB}"`);
    return null;
  }
  if (!str(raw["repo"]) || !/^[\w.-]+\/[\w.-]+$/.test(raw["repo"])) err("job.repo is not owner/name");
  if (!str(raw["workflow"]) || !raw["workflow"].startsWith(".github/workflows/")) err("job.workflow is not a path under .github/workflows/");
  const lane = raw["lane"];
  if (!LANES.includes(lane as Lane)) err("lane must be latest-release or main");
  const stages: Record<string, string[]> = {};
  const map = isRecord(raw["stages"]) ? raw["stages"] : {};
  for (const s of steps) {
    const v = map[s.id];
    if (!Array.isArray(v) || v.length === 0 || !v.every(str)) err(`step "${s.id}" maps to no stage`);
    else stages[s.id] = v;
  }
  for (const k of Object.keys(map)) if (!steps.some((s) => s.id === k)) err(`stage map names "${k}", which is not a step`);
  return { repo: str(raw["repo"]) ? raw["repo"] : "", workflow: str(raw["workflow"]) ? raw["workflow"] : "", lane: lane as Lane, stages };
}

/** This canary: its repo, its workflow path, and the stages it runs. */
export interface Canary {
  repo: string;
  workflow: string;
  stages: readonly string[];
}

/** The entry that designates this canary, and what does not fit it. */
export interface EntryCheck {
  ui: string | null;
  lane: Lane | null;
  steps: number;
  findings: string[];
}

/** Finds the UI whose job is this canary and checks every mapped stage is one the canary runs. */
export function checkCanaryEntry(list: TargetList, me: Canary): EntryCheck {
  const ui = list.uis.find((u) => u.job !== null && u.job.repo === me.repo && u.job.workflow === me.workflow);
  if (ui === undefined || ui.job === null) {
    return { ui: null, lane: null, steps: 0, findings: [`no UI on the list designates ${me.repo} ${me.workflow} as its job`] };
  }
  const findings: string[] = [];
  for (const [step, stages] of Object.entries(ui.job.stages)) {
    for (const stage of stages) if (!me.stages.includes(stage)) findings.push(`step "${step}" maps to stage "${stage}", which this canary does not run`);
  }
  return { ui: ui.id, lane: ui.job.lane, steps: Object.keys(ui.job.stages).length, findings };
}

/** The check's outcome for this canary; see the CLI's exit codes. */
export type Verdict = "ok" | "ok-others" | "mismatch" | "unchecked";

/** The CLI's exit code for each verdict. */
export const EXIT: Readonly<Record<Verdict, number>> = { ok: 0, mismatch: 1, unchecked: 2, "ok-others": 3 };

/** Whose problem the list has: none, only others', this canary's own, or unknown (it does not parse). */
export function verdict(parsed: Parsed, me: Canary): Verdict {
  if (parsed.list === null) return "unchecked";
  const check = checkCanaryEntry(parsed.list, me);
  if (check.ui === null || check.findings.length > 0 || parsed.errors.some((e) => e.ui === check.ui)) return "mismatch";
  return parsed.errors.length > 0 ? "ok-others" : "ok";
}

/** What may go to a public log: this canary's entry and counts, nothing else from the list. */
export function publicReport(parsed: Parsed, me: Canary): string[] {
  if (parsed.list === null) return parsed.errors.map((e) => `target list: ${e.message}`);
  const check = checkCanaryEntry(parsed.list, me);
  const mine = (e: ListError) => e.ui !== null && e.ui === check.ui;
  const lines: string[] = [];
  if (check.ui !== null && check.findings.length === 0 && !parsed.errors.some(mine)) {
    lines.push(`target list: ${check.ui}, lane ${check.lane}, ${check.steps} steps mapped onto this canary's stages`);
  }
  for (const f of check.findings) lines.push(`target list: ${f}`);
  for (const e of parsed.errors.filter(mine)) lines.push(`target list: ${check.ui}: ${e.message}`);
  const others = parsed.errors.filter((e) => !mine(e)).length;
  if (others > 0) lines.push(`target list: ${others} problem${others === 1 ? "" : "s"} in other entries (not shown: the list is private)`);
  return lines;
}

/** The stages canary.yml runs, from its CANARY_STAGES. */
export function workflowStages(yaml: string): string[] {
  const w = Bun.YAML.parse(yaml) as { env?: Record<string, unknown> };
  const stages = w.env?.["CANARY_STAGES"];
  if (typeof stages !== "string") throw new Error("the workflow has no CANARY_STAGES");
  return stages.split(/\s+/).filter((s) => s !== "");
}

/** Reads a file for the CLI; a failure names the file's role and the error code, never its contents. */
function read(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    throw new Error(`could not read ${what} (${typeof code === "string" ? code : "error"})`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = flag("--file");
  const workflow = flag("--workflow") ?? ".github/workflows/canary.yml";
  if (file === undefined) {
    console.error("usage: bun canary/targets.ts --file <list.toml> [--workflow .github/workflows/canary.yml]");
    process.exit(EXIT.unchecked);
  }
  let me: Canary;
  let text: string;
  try {
    me = { repo: process.env["GITHUB_REPOSITORY"] ?? "gastownhall/herdr-gascity", workflow, stages: workflowStages(read(workflow, "the workflow")) };
    text = read(file, "the target list");
  } catch (e) {
    console.error(`targets: ${(e as Error).message}`);
    process.exit(EXIT.unchecked);
  }
  const parsed = parseTargetList(text);
  for (const l of publicReport(parsed, me)) console.log(l);
  process.exit(EXIT[verdict(parsed, me)]);
}
