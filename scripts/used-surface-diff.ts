// Compares another gc OpenAPI spec (gc main's) with the pin, restricted to
// what this mod uses: the operations in api/used-surface.json, the listed
// fields of the models they reach, and their parameters, request bodies and
// success responses. Everything else in gc's API is ignored.
//
// A change is breaking when the mod, built from the pin, would stop working
// against the other spec: a used operation, field or parameter gone or moved;
// a response field gc may now omit or send with another type; a request gc
// would now refuse (a new required field or parameter, a narrower type or
// enum). Additions the decoders already absorb (a new enum value, a narrower
// response type, a renamed model with the same fields) are compatible: listed,
// not failing. Models are matched by where the operations reach them, not by
// name, so a renamed component is compared with its old self.
//
// Usage:
//   bun run scripts/used-surface-diff.ts --upstream <openapi.json> --upstream-commit <sha> [--upstream-ref main] [--report <file.md>]
// Exits 1 when a used operation or field changed incompatibly.

import { readFile, writeFile } from "node:fs/promises";
import {
  PINNED_SPEC, PIN_FILE, ROOT, USED_SURFACE, operationsById, parsePin, readJson, refName, requestBody, successResponse,
  type LocatedOperation, type Parameter, type Pin, type Schema, type Spec, type UsedSurface,
} from "./gc-spec.ts";
import { PROBLEM_MODEL, component, componentProperties, isObjectModel } from "./gen-gc.ts";

/** One difference in the used surface. */
export interface Finding {
  level: "breaking" | "compatible";
  /** The operation, parameter or Model.field that changed. */
  where: string;
  /** The first used operation that reaches it. */
  via: string;
  change: string;
}

/** decode = gc sends it and the mod decodes it; send = the mod sends it and gc validates it. */
type Side = "decode" | "send";

/** Where a model sits on both sides, with the field chain that led to it. */
interface Pair {
  pinned: string;
  upstream: string;
}

class Differ {
  readonly findings: Finding[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly pinned: Spec, private readonly upstream: Spec, private readonly used: UsedSurface) {}

  private add(level: Finding["level"], where: string, via: string, change: string): void {
    this.findings.push({ level, where, via, change });
  }

  operation(id: string, pin: LocatedOperation, up: LocatedOperation | undefined): void {
    if (!up) {
      this.add("breaking", id, id, "operation removed (or its operationId changed)");
      return;
    }
    if (pin.path !== up.path) this.add("breaking", id, id, `path changed: ${pin.path} -> ${up.path}`);
    if (pin.method !== up.method) this.add("breaking", id, id, `method changed: ${pin.method.toUpperCase()} -> ${up.method.toUpperCase()}`);
    this.parameters(id, pin.op.parameters ?? [], up.op.parameters ?? []);

    const pinOk = successResponse(pin.op);
    let upOk: ReturnType<typeof successResponse>;
    try {
      upOk = successResponse(up.op);
    } catch (err) {
      this.add("breaking", id, id, `success response: ${(err as Error).message}`);
      return;
    }
    if (pinOk.status !== upOk.status) this.add("breaking", id, id, `success status changed: ${pinOk.status} -> ${upOk.status}`);
    this.schema(`${id} response`, id, pinOk.schema, upOk.schema, "decode");

    const pinBody = requestBody(pin.op);
    const upBody = requestBody(up.op);
    if (pinBody && !upBody) this.add("breaking", id, id, "request body removed");
    else if (!pinBody && upBody?.required) this.add("breaking", id, id, "new required request body");
    else if (pinBody && upBody) {
      if (!pinBody.required && upBody.required) this.add("breaking", id, id, "request body now required");
      this.schema(`${id} body`, id, pinBody.schema, upBody.schema, "send");
    }
  }

  private parameters(id: string, pin: Parameter[], up: Parameter[]): void {
    const key = (p: Parameter) => `${p.in} ${p.name}`;
    const upByKey = new Map(up.map((p) => [key(p), p]));
    const pinKeys = new Set(pin.map(key));
    for (const p of pin) {
      const where = `${id} ${key(p)}`;
      const u = upByKey.get(key(p));
      if (!u) {
        this.add("breaking", where, id, "removed");
        continue;
      }
      if (!p.required && u.required) this.add("breaking", where, id, "now required");
      this.schema(where, id, p.schema ?? {}, u.schema ?? {}, "send");
    }
    for (const u of up) {
      if (!pinKeys.has(key(u)) && u.required) this.add("breaking", `${id} ${key(u)}`, id, "new required parameter");
    }
  }

  /** Compares a model reached at the same place on both sides. */
  model(where: string, via: string, pair: Pair, side: Side): void {
    const seenKey = `${pair.pinned}|${pair.upstream}|${side}`;
    if (this.seen.has(seenKey)) return;
    this.seen.add(seenKey);
    if (pair.pinned !== pair.upstream) this.add("compatible", where, via, `model renamed: ${pair.pinned} -> ${pair.upstream}`);
    const entry = this.used.models[pair.pinned];
    if (!entry) throw new Error(`${pair.pinned} is reached from the pin but not listed in ${USED_SURFACE}`);
    const pinProps = componentProperties(this.pinned, pair.pinned);
    const upProps = componentProperties(this.upstream, pair.upstream);
    for (const field of entry.fields) {
      const at = `${pair.pinned}.${field}`;
      const p = pinProps.get(field);
      if (!p) throw new Error(`${at} is listed in ${USED_SURFACE} but not in the pin`);
      const u = upProps.get(field);
      if (!u) {
        this.add("breaking", at, via, "removed");
        continue;
      }
      if (p.required !== u.required) {
        if (side === "decode" && p.required) this.add("breaking", at, via, "no longer required: gc may omit it");
        else if (side === "send" && u.required) this.add("breaking", at, via, "now required");
        else this.add("compatible", at, via, u.required ? "now required" : "no longer required");
      }
      this.schema(at, via, p.schema, u.schema, side);
    }
    if (side === "send") {
      const sent = new Set(entry.fields);
      for (const [field, u] of upProps) {
        if (u.required && !sent.has(field)) this.add("breaking", `${pair.pinned}.${field}`, via, "new required request field the mod does not send");
      }
    }
  }

  private schema(where: string, via: string, pin: Schema, up: Schema, side: Side): void {
    const pinModel = this.objectRef(this.pinned, pin);
    const upModel = this.objectRef(this.upstream, up);
    if (pinModel || upModel) {
      if (pinModel && upModel) this.model(where, via, { pinned: pinModel, upstream: upModel }, side);
      else this.add("breaking", where, via, `shape changed: ${pinModel ?? describe(pin)} -> ${upModel ?? describe(up)}`);
      return;
    }
    const p = scalar(this.pinned, pin);
    const u = scalar(this.upstream, up);
    const pTypes = types(p);
    const uTypes = types(u);
    // decode: every value gc may send must be one the mod accepts; send: every
    // value the mod may send must be one gc accepts.
    const [from, to] = side === "decode" ? [uTypes, pTypes] : [pTypes, uTypes];
    if (!accepts(to, from)) this.add("breaking", where, via, `type changed: ${label(pTypes)} -> ${label(uTypes)}`);
    else if (label(pTypes) !== label(uTypes)) this.add("compatible", where, via, `type changed: ${label(pTypes)} -> ${label(uTypes)}`);
    this.enums(where, via, p.enum, u.enum, side);
    if (p.items || u.items) this.schema(`${where}[]`, via, p.items ?? {}, u.items ?? {}, side);
    const pAdd = objectOrNull(p.additionalProperties);
    const uAdd = objectOrNull(u.additionalProperties);
    if (pAdd || uAdd) this.schema(`${where}{}`, via, pAdd ?? {}, uAdd ?? {}, side);
  }

  private enums(where: string, via: string, pin: unknown[] | undefined, up: unknown[] | undefined, side: Side): void {
    const list = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join(", ");
    if (side === "decode") {
      // Response enums decode an unknown value to {kind:"unrecognized"}.
      if (pin && up) {
        const added = up.filter((v) => !pin.includes(v));
        if (added.length > 0) this.add("compatible", where, via, `new enum values (decoded as unrecognized): ${list(added)}`);
      } else if (pin && !up) this.add("compatible", where, via, "no longer an enum (values decode as unrecognized)");
      return;
    }
    if (up && !pin) this.add("breaking", where, via, `now restricted to: ${list(up)}`);
    else if (pin && up) {
      const removed = pin.filter((v) => !up.includes(v));
      const added = up.filter((v) => !pin.includes(v));
      if (removed.length > 0) this.add("breaking", where, via, `enum values removed: ${list(removed)}`);
      if (added.length > 0) this.add("compatible", where, via, `new enum values: ${list(added)}`);
    }
  }

  /** The object model a schema refers to, or null for a scalar or inline schema. */
  private objectRef(spec: Spec, schema: Schema): string | null {
    if (!schema.$ref) return null;
    const name = refName(schema.$ref);
    if (!spec.components.schemas[name]) throw new Error(`dangling $ref ${schema.$ref}`);
    return isObjectModel(spec, name) ? name : null;
  }
}

/** A scalar schema with a $ref to a scalar component resolved (both apply: the enums intersect). */
function scalar(spec: Spec, schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const { $ref, ...siblings } = schema;
  const target = scalar(spec, component(spec, refName($ref)));
  const out: Schema = { ...target, ...siblings };
  if (target.enum && siblings.enum) out.enum = target.enum.filter((v) => siblings.enum!.includes(v));
  else if (target.enum) out.enum = target.enum;
  return out;
}

/** The JSON types a schema allows; null = any. */
function types(schema: Schema): Set<string> | null {
  if (schema.type === undefined) return schema.const !== undefined ? new Set([typeof schema.const]) : null;
  return new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
}

/** True when every value of `from` is also a value of `to` (an integer is a number). */
function accepts(to: Set<string> | null, from: Set<string> | null): boolean {
  if (to === null) return true;
  if (from === null) return false;
  return [...from].every((t) => to.has(t) || (t === "integer" && to.has("number")));
}

function label(t: Set<string> | null): string {
  return t === null ? "any" : [...t].sort().join("|");
}

function describe(schema: Schema): string {
  return schema.$ref ? refName(schema.$ref) : label(types(schema));
}

function objectOrNull(value: Schema["additionalProperties"]): Schema | null {
  return value && typeof value === "object" ? value : null;
}

/** Every difference between the pin and `upstream` in what the mod uses, breaking first. */
export function diffUsedSurface(pinned: Spec, upstream: Spec, used: UsedSurface): Finding[] {
  const d = new Differ(pinned, upstream, used);
  const pinOps = operationsById(pinned);
  const upOps = operationsById(upstream);
  for (const id of Object.keys(used.operations)) {
    const pin = pinOps.get(id);
    if (!pin) throw new Error(`operation ${id} is not in the pin`);
    d.operation(id, pin, upOps.get(id));
  }
  // Named, not reached from an operation: every error body, and event payloads.
  for (const name of [PROBLEM_MODEL, ...used.payloadModels]) {
    if (!upstream.components.schemas[name]) d.findings.push({ level: "breaking", where: name, via: name, change: "model removed" });
    else d.model(name, name, { pinned: name, upstream: name }, "decode");
  }
  const rank = (f: Finding) => (f.level === "breaking" ? 0 : 1);
  return d.findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}

/** The upstream spec a run compared with. */
export interface UpstreamRef {
  ref: string;
  commit: string;
}

const cell = (s: string) => s.replaceAll("|", "\\|");

/** A Markdown report for the job summary. */
export function formatReport(findings: Finding[], meta: { pinned: Pin; upstream: UpstreamRef }): string {
  const broken = findings.filter((f) => f.level === "breaking");
  const fine = findings.filter((f) => f.level === "compatible");
  const out = [
    "## gc used-surface drift",
    "",
    `Pinned: \`${meta.pinned.repo}@${meta.pinned.commit}\` (${meta.pinned.committed}). ` +
      `Compared with: \`${meta.pinned.repo}@${meta.upstream.commit}\` (${meta.upstream.ref}).`,
    "",
  ];
  const table = (rows: Finding[]) => [
    "| Where | Change | Reached from |",
    "| --- | --- | --- |",
    ...rows.map((f) => `| \`${cell(f.where)}\` | ${cell(f.change)} | \`${cell(f.via)}\` |`),
    "",
  ];
  if (findings.length === 0) out.push("No change to the operations and fields this mod uses.", "");
  if (broken.length > 0) {
    out.push(
      `**${broken.length} breaking change${broken.length === 1 ? "" : "s"}** to what this mod uses:`,
      "",
      ...table(broken),
      "The mod built from the pin would fail against this gc. Adapt the mod and re-pin " +
        "(`bun run pin:gc`, `bun run gen:gc`, re-record fixtures), or raise it upstream if the change is unintended.",
      "",
    );
  }
  if (fine.length > 0) {
    out.push(`${fine.length} compatible change${fine.length === 1 ? "" : "s"} (no action needed until the next re-pin):`, "", ...table(fine));
  }
  return out.join("\n");
}

function arg(args: string[], name: string, fallback?: string): string {
  const at = args.indexOf(name);
  const value = at >= 0 ? args[at + 1] : fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const upstream = JSON.parse(await readFile(arg(args, "--upstream"), "utf8")) as Spec;
  const pinned = await readJson<Spec>(ROOT, PINNED_SPEC);
  const used = await readJson<UsedSurface>(ROOT, USED_SURFACE);
  const pin = parsePin(await readFile(`${ROOT}/${PIN_FILE}`, "utf8"));
  const findings = diffUsedSurface(pinned, upstream, used);
  const report = formatReport(findings, {
    pinned: pin,
    upstream: { ref: arg(args, "--upstream-ref", "main"), commit: arg(args, "--upstream-commit") },
  });
  const reportPath = args.includes("--report") ? arg(args, "--report") : null;
  if (reportPath) await writeFile(reportPath, report);
  console.log(report);
  const broken = findings.filter((f) => f.level === "breaking");
  // GitHub annotations: one per breaking change, on the run's summary page.
  if (process.env["GITHUB_ACTIONS"] === "true") {
    for (const f of broken) console.log(`::error title=gc drift::${f.where}: ${f.change} (reached from ${f.via})`);
  }
  if (broken.length > 0) process.exit(1);
}
