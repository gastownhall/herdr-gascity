// The decode policy (design §5.2), shared by the generated schemas and the
// client:
//   - unknown extra fields are ignored (forward compatible);
//   - a missing required field or a wrong type is a `decode` error naming the
//     operation, the JSON path and the issues;
//   - a string enum value this pin does not know decodes to
//     {kind:"unrecognized", raw}: visible, not fatal;
//   - gc's ["array","null"] (a Go nil slice) decodes null to [] (and absent
//     to [] when the field is optional);
//   - list elements are decoded one by one, so one bad element becomes an
//     `unreadable` entry instead of failing the whole list.

import { err, ok, type Result } from "../result.ts";
import type { GcError } from "./errors.ts";
import * as z from "./zod.ts";

/** A decode failure. */
export type DecodeError = Extract<GcError, { kind: "decode" }>;

/** An enum value gc sent that this pin does not know. */
export interface Unrecognized {
  readonly kind: "unrecognized";
  readonly raw: string;
}

/** A gc string enum as decoded: a known value, or the raw unrecognized one. */
export type Drift<T extends string> = T | Unrecognized;

/** True for a decoded enum value this pin does not know. */
export function isUnrecognized(value: unknown): value is Unrecognized {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "unrecognized"
    && typeof (value as { raw?: unknown }).raw === "string";
}

/** A string enum that keeps unknown values as `Unrecognized` instead of failing. */
export function enumOf<const T extends readonly [string, ...string[]]>(values: T): z.ZodMiniType<Drift<T[number]>> {
  return z.union([
    z.enum(values),
    z.pipe(z.string(), z.transform((raw): Unrecognized => ({ kind: "unrecognized", raw }))),
  ]) as unknown as z.ZodMiniType<Drift<T[number]>>;
}

/** A required gc ["array","null"] (a Go nil slice): null decodes to []; absent is an error. */
export function nullableList<T>(item: z.ZodMiniType<T>): z.ZodMiniType<T[]> {
  return z.pipe(z.nullable(z.array(item)), z.transform((list): T[] => list ?? []));
}

/** An optional gc ["array","null"]: null and absent both decode to []. */
export function optionalNullableList<T>(item: z.ZodMiniType<T>): z.ZodMiniType<T[]> {
  return z.pipe(z.optional(z.nullable(z.array(item))), z.transform((list): T[] => list ?? []));
}

/** A list element that failed to decode; `id` is its `id` or `name` when it has one. */
export interface Unreadable {
  index: number;
  id: string | null;
  error: DecodeError;
}

/** A decoded list response: the readable elements plus the unreadable ones. */
export type Listed<E extends { items: unknown[] }, T> = Omit<E, "items"> & { items: T[]; unreadable: Unreadable[] };

const MAX_ISSUES = 20;

interface Issue {
  code: string;
  path: PropertyKey[];
  expected?: string;
  values?: unknown[];
  errors?: Issue[][];
}

/** `items[3].program_status.state`; the root is "". */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out;
}

function joinPath(base: string, rest: string): string {
  if (base === "") return rest;
  if (rest === "" || rest.startsWith("[")) return base + rest;
  return `${base}.${rest}`;
}

function at(value: unknown, path: readonly PropertyKey[]): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function describe(issue: Issue, input: unknown): string {
  const found = at(input, issue.path);
  switch (issue.code) {
    case "invalid_type":
      return found === undefined ? `missing required ${issue.expected ?? "value"}` : `expected ${issue.expected ?? "?"}, got ${kindOf(found)}`;
    case "invalid_value":
      return `expected one of ${JSON.stringify(issue.values ?? [])}, got ${JSON.stringify(found)}`;
    case "invalid_union":
      return `no accepted form matched ${kindOf(found)}`;
    default:
      return issue.code;
  }
}

function toDecodeError(operationId: string, base: string, issues: readonly Issue[], input: unknown): DecodeError {
  const lines = issues.slice(0, MAX_ISSUES).map((i) => `${joinPath(base, formatPath(i.path)) || "(root)"}: ${describe(i, input)}`);
  if (issues.length > MAX_ISSUES) lines.push(`… ${issues.length - MAX_ISSUES} more`);
  const first = issues[0];
  return { kind: "decode", operationId, path: joinPath(base, first ? formatPath(first.path) : ""), issues: lines };
}

/** Decodes `value` with `schema`; `path` prefixes the JSON paths in the error. */
export function decodeValue<T>(schema: z.ZodMiniType<T>, value: unknown, operationId: string, path = ""): Result<T, DecodeError> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err(toDecodeError(operationId, path, parsed.error.issues as unknown as Issue[], value));
}

function idOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const { id, name } = value as { id?: unknown; name?: unknown };
  if (typeof id === "string") return id;
  if (typeof name === "string") return name;
  return null;
}

/**
 * Decodes a list response: the envelope (with `items` as raw elements) must
 * decode, then each element is decoded on its own.
 */
export function decodeListed<E extends { items: unknown[] }, T>(
  envelope: z.ZodMiniType<E>,
  item: z.ZodMiniType<T>,
  value: unknown,
  operationId: string,
): Result<Listed<E, T>, DecodeError> {
  const outer = decodeValue(envelope, value, operationId);
  if (!outer.ok) return outer;
  const items: T[] = [];
  const unreadable: Unreadable[] = [];
  outer.value.items.forEach((raw, index) => {
    const decoded = decodeValue(item, raw, operationId, `items[${index}]`);
    if (decoded.ok) items.push(decoded.value);
    else unreadable.push({ index, id: idOf(raw), error: decoded.error });
  });
  return ok({ ...outer.value, items, unreadable });
}

/** Every unrecognized enum value in a decoded value, with its JSON path (for diagnostics). */
export function unrecognizedIn(value: unknown, path = ""): { path: string; raw: string }[] {
  if (isUnrecognized(value)) return [{ path, raw: value.raw }];
  if (Array.isArray(value)) return value.flatMap((v, i) => unrecognizedIn(v, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => unrecognizedIn(v, path === "" ? k : `${path}.${k}`));
  }
  return [];
}
