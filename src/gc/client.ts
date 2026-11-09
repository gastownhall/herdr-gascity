// The gc API client, written against herdr-app's
// constrained `fetch` (gpui-kit shell, standard/fetch.rs): options are
// {method, headers, body} only; the whole body is read before the promise
// resolves; the response has status/ok/url/text() and NO headers; a fixed
// 30 s timeout and an 8 MiB request/response cap reject the promise with
// herdr's own message.
//
// Rules:
//   - loopback gc API URLs only (`not-loopback` otherwise);
//   - every mutation sends `X-GC-Request: herdr-gascity/<version>`;
//   - `Idempotency-Key` only on operations whose pinned spec declares it (the
//     types require a key there and reject one elsewhere);
//   - nothing is retried here: reads are retried by the sync engine's backoff,
//     mutations never automatically. A mutation whose transport fails is
//     `outcome-unknown`, because it may have been applied.

import { err, ok, type Result } from "../result.ts";
import { MOD_VERSION } from "../version.ts";
import { decodeListed, decodeValue } from "./decode.ts";
import { httpError, type GcError } from "./errors.ts";
import { OPERATIONS, type OperationId, type OperationTypes } from "./operations.gen.ts";
import type * as z from "./zod.ts";

/** herdr's fetch timeout (fetch.rs TIMEOUT). */
export const HERDR_FETCH_TIMEOUT_MS = 30_000;
/** herdr's fetch body cap, both directions (fetch.rs MAX_BODY_BYTES). */
export const HERDR_FETCH_MAX_BODY_BYTES = 8 * 1024 * 1024;
/** A rejection this close to the timeout is a timeout, whatever its message says. */
const TIMEOUT_SLACK_MS = 1_000;

/** The X-GC-Request value: any non-empty value satisfies gc; this one makes gc logs attributable. */
export const X_GC_REQUEST = `herdr-gascity/${MOD_VERSION}`;

const ACCEPT = "application/json, application/problem+json";

/** The request herdr's fetch takes. */
export interface HostRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The response herdr's fetch gives: no headers. */
export interface HostResponse {
  status: number;
  ok: boolean;
  url: string;
  text(): Promise<string>;
}

/** herdr's global fetch, injected so tests and the sync engine's budget can wrap it. */
export type HostFetch = (url: string, init: HostRequest) => Promise<HostResponse>;

export interface GcClientOptions {
  /** e.g. http://127.0.0.1:8372; must be a loopback literal. */
  baseUrl: string;
  fetch: HostFetch;
  /** Milliseconds clock, for telling a timeout from a fast failure. Default Date.now. */
  now?: () => number;
}

type Types<Op extends OperationId> = OperationTypes[Op];

/** Operations whose pinned spec declares Idempotency-Key. */
export type IdempotentOperation = {
  [K in OperationId]: (typeof OPERATIONS)[K]["idempotencyKey"] extends true ? K : never;
}[OperationId];

type BodyArg<B> = [B] extends [undefined] ? { body?: undefined } : undefined extends B ? { body?: B } : { body: B };
type QueryArg<Q> = {} extends Q ? { query?: Q } : { query: Q };
type KeyArg<Op extends OperationId> = Op extends IdempotentOperation ? { idempotencyKey: string } : { idempotencyKey?: never };

/** The arguments of one call: typed path/query params, body and idempotency key. */
export type CallArgs<Op extends OperationId> =
  & { path: Types<Op>["path"] }
  & QueryArg<Types<Op>["query"]>
  & BodyArg<Types<Op>["body"]>
  & KeyArg<Op>;

/** A gc API client for one loopback endpoint. */
export interface GcClient {
  readonly baseUrl: string;
  /** Calls one operation and decodes its answer; never throws. */
  call<Op extends OperationId>(op: Op, args: CallArgs<Op>): Promise<Result<Types<Op>["decoded"], GcError>>;
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})\/?$/;

/** Is this an http URL of a loopback literal (127.0.0.1, localhost, [::1]) with a port and no path? */
export function isLoopbackApiUrl(url: string): boolean {
  const m = LOOPBACK.exec(url);
  return m !== null && Number(m[2]) <= 65535;
}

/** Creates a client, refusing any API URL that is not a loopback literal with a port. */
export function createGcClient(options: GcClientOptions): Result<GcClient, GcError> {
  if (!isLoopbackApiUrl(options.baseUrl)) return err({ kind: "not-loopback", url: options.baseUrl });
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const now = options.now ?? (() => Date.now());
  return ok({
    baseUrl,
    call: (op, args) => call(baseUrl, options.fetch, now, op, args),
  });
}

/** "scheme://host:port" of a URL, lower-cased, with http's default port dropped as reqwest does. */
function originOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return "";
  const scheme = m[1]!.toLowerCase();
  const authority = m[2]!.toLowerCase();
  return `${scheme}://${scheme === "http" ? authority.replace(/:80$/, "") : authority}`;
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

function buildUrl(baseUrl: string, template: string, path: Record<string, string>, query: Record<string, QueryValue>): string {
  const filled = template.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(path[name] ?? ""));
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const values = typeof value === "object" ? value : [value];
    for (const v of values) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return `${baseUrl}${filled}${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

/** UTF-8 length of a string, without TextEncoder (not guaranteed in herdr's engine). */
function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

type TransportFailure = Extract<GcError, { kind: "unreachable" | "timeout" | "too-large" }>;

/** Classifies a fetch rejection by herdr's messages and the time it took. */
function transportFailure(url: string, cause: unknown, elapsedMs: number): TransportFailure {
  const message = messageOf(cause);
  if (/exceeded the \d+ byte limit/.test(message)) {
    return { kind: "too-large", url, direction: /request body/.test(message) ? "request" : "response", limitBytes: HERDR_FETCH_MAX_BODY_BYTES };
  }
  if (/timed out|timeout/i.test(message) || elapsedMs >= HERDR_FETCH_TIMEOUT_MS - TIMEOUT_SLACK_MS) {
    return { kind: "timeout", url, ms: HERDR_FETCH_TIMEOUT_MS };
  }
  return { kind: "unreachable", url, cause: message };
}

async function call<Op extends OperationId>(
  baseUrl: string,
  fetch: HostFetch,
  now: () => number,
  op: Op,
  args: CallArgs<Op>,
): Promise<Result<Types<Op>["decoded"], GcError>> {
  const meta = OPERATIONS[op];
  const mutation = meta.method !== "GET";
  const loose = args as { path: Record<string, string>; query?: Record<string, QueryValue>; body?: unknown; idempotencyKey?: string };
  const url = buildUrl(baseUrl, meta.path, loose.path, loose.query ?? {});

  const headers: Record<string, string> = { Accept: ACCEPT };
  if (mutation) headers["X-GC-Request"] = X_GC_REQUEST;
  if (meta.idempotencyKey && loose.idempotencyKey !== undefined) headers["Idempotency-Key"] = loose.idempotencyKey;
  const init: HostRequest = { method: meta.method, headers };
  if (loose.body !== undefined) {
    const body = JSON.stringify(loose.body);
    if (utf8Length(body) > HERDR_FETCH_MAX_BODY_BYTES) {
      return err({ kind: "too-large", url, direction: "request", limitBytes: HERDR_FETCH_MAX_BODY_BYTES });
    }
    headers["Content-Type"] = "application/json";
    init.body = body;
  }

  const started = now();
  let status: number;
  let text: string;
  let finalUrl: string;
  try {
    const response = await fetch(url, init);
    status = response.status;
    finalUrl = response.url;
    text = await response.text();
  } catch (cause) {
    const failure = transportFailure(url, cause, now() - started);
    if (mutation && !(failure.kind === "too-large" && failure.direction === "request")) {
      return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: failure.kind });
    }
    return err(failure);
  }

  // herdr's fetch follows redirects; an answer from anywhere but this loopback
  // origin is not gc's, whatever it says.
  if (originOf(finalUrl) !== originOf(baseUrl)) {
    if (mutation) {
      return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: "redirected", issues: [`answered from ${finalUrl}`] });
    }
    return err({ kind: "not-loopback", url: finalUrl });
  }

  if (status < 200 || status > 299) return err(httpError(op, status, text));

  let decoded: Result<unknown, Extract<GcError, { kind: "decode" }>>;
  try {
    const json: unknown = JSON.parse(text);
    decoded = meta.item
      ? decodeListed(meta.response as z.ZodMiniType<{ items: unknown[] }>, meta.item as z.ZodMiniType<unknown>, json, op)
      : decodeValue(meta.response as z.ZodMiniType<unknown>, json, op);
  } catch (cause) {
    decoded = err({ kind: "decode", operationId: op, path: "", issues: [`(root): body is not JSON: ${messageOf(cause)}`] });
  }
  // gc answered 2xx, so a mutation most likely took effect: an unreadable
  // answer must not look like a failure the person could simply retry.
  if (!decoded.ok && mutation) {
    return err({ kind: "outcome-unknown", requestId: null, operationId: op, cause: "unreadable-response", issues: decoded.error.issues });
  }
  return decoded as Result<Types<Op>["decoded"], GcError>;
}
