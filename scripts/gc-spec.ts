// Shared helpers for the pinned gc OpenAPI spec (design §5.2, §13.2): the
// used-surface list, $ref walking, and the PIN record. Used by
// scripts/pin-gc-spec.ts, scripts/gen-gc.ts and the contract tests.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const PINNED_SPEC = "api/openapi.pinned.json";
export const PIN_FILE = "api/PIN";
export const USED_SURFACE = "api/used-surface.json";

/** A JSON Schema node as gc's Huma-generated OpenAPI 3.1 spec writes it. */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  not?: Schema;
  format?: string;
  [key: string]: unknown;
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: Schema;
}

export interface Operation {
  operationId: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Schema }> } | null;
  responses: Record<string, { content?: Record<string, { schema?: Schema }> }>;
  [key: string]: unknown;
}

export interface Spec {
  openapi: string;
  info?: unknown;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Schema>; [section: string]: Record<string, unknown> };
  [key: string]: unknown;
}

export interface ModelEntry {
  fields: string[];
  /** A list field whose elements are decoded one by one (design §5.2 item-level decode errors). */
  itemLevel?: string;
}

export interface UsedSurface {
  operations: Record<string, string>;
  models: Record<string, ModelEntry>;
  payloadModels: string[];
}

/** The HTTP methods an OpenAPI path item can hold. */
export const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export interface LocatedOperation {
  path: string;
  method: (typeof METHODS)[number];
  op: Operation;
}

/** Every operation in the spec by operationId. */
export function operationsById(spec: Spec): Map<string, LocatedOperation> {
  const out = new Map<string, LocatedOperation>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method] as Operation | undefined;
      if (op?.operationId) out.set(op.operationId, { path, method, op });
    }
  }
  return out;
}

/** "#/components/schemas/Bead" -> ["schemas", "Bead"]. */
export function refTarget(ref: string): [section: string, name: string] {
  const m = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref ${ref}: only #/components/<section>/<name> is handled`);
  return [m[1]!, m[2]!];
}

/** The component name a schema $ref points at. */
export function refName(ref: string): string {
  return refTarget(ref)[1];
}

/** Calls `visit` for every $ref under `node`, depth-first. */
export function eachRef(node: unknown, visit: (ref: string) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) eachRef(child, visit);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") visit(value);
      else eachRef(value, visit);
    }
  }
}

/** The JSON body schema of an operation's single 2xx response, with its status. */
export function successResponse(op: Operation): { status: number; schema: Schema } {
  const ok = Object.entries(op.responses).filter(([code]) => /^2\d\d$/.test(code));
  if (ok.length !== 1) throw new Error(`${op.operationId}: expected one 2xx response, found ${ok.map(([c]) => c).join(",") || "none"}`);
  const [code, response] = ok[0]!;
  const schema = response.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`${op.operationId}: ${code} response has no application/json schema`);
  return { status: Number(code), schema };
}

/** The JSON request body schema, if the operation takes one. */
export function requestBody(op: Operation): { required: boolean; schema: Schema } | null {
  const schema = op.requestBody?.content?.["application/json"]?.schema;
  return schema ? { required: op.requestBody?.required === true, schema } : null;
}

export async function readJson<T>(root: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(root, file), "utf8")) as T;
}

/** The api/PIN record: where the pinned spec came from. */
export interface Pin {
  repo: string;
  commit: string;
  committed: string;
  path: string;
  /** sha256 of the full upstream file at that commit, before pruning. */
  sha256: string;
}

const PIN_KEYS = ["repo", "commit", "committed", "path", "sha256"] as const;

export function formatPin(pin: Pin): string {
  return PIN_KEYS.map((k) => `${k}=${pin[k]}`).join("\n") + "\n";
}

export function parsePin(text: string): Pin {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`api/PIN: bad line ${JSON.stringify(line)}`);
    out[line.slice(0, at)] = line.slice(at + 1);
  }
  for (const k of PIN_KEYS) if (!out[k]) throw new Error(`api/PIN: missing ${k}`);
  return out as unknown as Pin;
}
