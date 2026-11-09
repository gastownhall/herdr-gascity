// Endpoint resolution: where is gc's API? Candidates in order, first that
// answers GET /health wins:
//   1. the apiUrl setting (machine-wide, shared store);
//   2. the URL gc reports (`gc supervisor status --json` → api_url, when gc
//      prints one);
//   3. ~/.gc/supervisor.toml [supervisor] bind/port (strict reader);
//   4. http://127.0.0.1:8372, gc's default.
// Every candidate's outcome is kept, so the header and diagnostics say where
// the URL came from and what was tried.
//
// Fallback rules:
//   - a source with nothing to offer (no setting, gc says nothing or cannot be
//     run, no supervisor.toml) is recorded and skipped;
//   - a candidate that does not answer /health within 5 s of the request
//     being sent, or answers with something that is not gc's health, is
//     recorded and the next one tried. Probes go through the app-wide fetch
//     budget, and the 5 s run from when the request leaves its queue: time
//     spent waiting behind other requests is not gc's. A probe still queued
//     after HEALTH_QUEUE_MS is dropped. A probe that lost its race stays
//     counted in flight until herdr's fetch settles (it holds a pool thread
//     until then);
//   - a probe the mod cancelled (dropped from the queue, or reclaimed with a
//     closed copy) says nothing about gc: it is tried once more before it is
//     recorded and the next candidate tried;
//   - a candidate that is not loopback is refused, and a source that exists
//     but cannot be read for sure (malformed settings or supervisor.toml) is
//     an error: resolution stops there instead of guessing a later candidate,
//     because the person configured something and it is not being honoured.

import { err, ok, type Result } from "../result.ts";
import { createGcClient, type HostFetch } from "../gc/client.ts";
import type { GcError } from "../gc/errors.ts";
import { getHealth } from "../gc/ops.ts";
import type { SupervisorHealthOutputBody } from "../gc/types.gen.ts";
import { GC_STATUS_COMMAND, parseGcStatus } from "./gcStatus.ts";
import { decodeSettings } from "./settings.ts";
import { parseSupervisorConfig, supervisorApiUrl } from "./supervisorConfig.ts";

/** gc's default API URL. */
export const DEFAULT_API_URL = "http://127.0.0.1:8372";
/** How long a sent /health probe may take before the next candidate is tried. */
export const HEALTH_PROBE_MS = 5_000;
/**
 * How long a /health probe may wait in the fetch queue before it is dropped.
 * A slot is reclaimed RECLAIM_AFTER_MS (35 s) after herdr cancelled its fetch,
 * so a queue this old is stuck behind requests that will never settle.
 */
export const HEALTH_QUEUE_MS = 40_000;
/** Probes of one candidate the mod cancelled (not sent, or reclaimed) before it is recorded as unreachable. */
export const PROBE_ATTEMPTS = 2;

/** Where a candidate URL came from, in resolution order. */
export type EndpointSource = "setting" | "gc-reported" | "supervisor-config" | "default";

/** What happened to one source or candidate. */
export type Attempt =
  /** The source offered no candidate. */
  | { source: EndpointSource; outcome: "absent"; detail: string }
  /** The source could not be asked (gc could not be run, or printed something unreadable). */
  | { source: EndpointSource; outcome: "unavailable"; error: GcError }
  /** The candidate is not a loopback URL: not probed. */
  | { source: EndpointSource; outcome: "refused"; url: string; error: GcError }
  /** The candidate did not answer /health as gc. */
  | { source: EndpointSource; outcome: "unreachable"; url: string; error: GcError }
  /** The candidate answered /health. */
  | { source: EndpointSource; outcome: "ok"; url: string; version: string };

/** The resolved gc API. */
export interface Endpoint {
  /** Normalized base URL, without a trailing slash. */
  url: string;
  source: EndpointSource;
  /** gc's version from /health. */
  version: string;
  /** The gc program from the settings (for later attach tabs). */
  gcBin: string;
  attempts: Attempt[];
}

/** Why there is no endpoint. */
export type NoEndpoint =
  /** A source exists but cannot be used: a refused URL or an unreadable setting/config. */
  | { reason: "refused" | "invalid"; source: EndpointSource; error: GcError; attempts: Attempt[] }
  /** No candidate answered. */
  | { reason: "none-reachable"; attempts: Attempt[] };

/** What resolution needs from the host; injected so it is tested without herdr. */
export interface ResolveHost {
  /** The raw shared settings value. */
  settings(): unknown;
  /** Runs `gcBin supervisor status --json` and returns its stdout (exit 0), or why it could not. */
  gcStatus(gcBin: string): Promise<Result<string, GcError>>;
  /** supervisor.toml's path and text (null when the file does not exist). */
  readSupervisorConfig(): Promise<Result<{ path: string; text: string | null }, GcError>>;
  fetch: HostFetch;
  /**
   * A fresh budgeted fetch for one /health probe: `sent` resolves when its
   * request leaves the fetch queue; `drop` drops it while still queued (it
   * then rejects as cancelled) and returns how many it dropped.
   */
  probeFetch(): { fetch: HostFetch; drop(): number; sent: Promise<void> };
  /** Resolves after `ms` (the async context's sleep). */
  sleep(ms: number): Promise<void>;
}

/** A candidate URL from one source, or why the source has none. */
type Candidate =
  | { kind: "url"; url: string }
  | { kind: "absent"; detail: string }
  | { kind: "unavailable"; error: GcError }
  | { kind: "invalid"; error: GcError };

const SOURCE_NAMES: Readonly<Record<EndpointSource, string>> = {
  setting: "the apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "supervisor.toml",
  default: "the default",
};

/**
 * Probes GET /health: ok with gc's health, or the failure. The request waits
 * in the fetch queue up to HEALTH_QUEUE_MS (then it is dropped: a
 * cancellation), and from when it is sent gets HEALTH_PROBE_MS.
 */
async function probe(host: ResolveHost, url: string): Promise<Result<SupervisorHealthOutputBody, GcError>> {
  const pf = host.probeFetch();
  const client = createGcClient({ baseUrl: url, fetch: pf.fetch });
  if (!client.ok) return client;
  const answer = getHealth(client.value);
  const waited = await Promise.race([
    answer.then(() => "answered" as const),
    pf.sent.then(() => "sent" as const),
    host.sleep(HEALTH_QUEUE_MS).then(() => "queue-expired" as const),
  ]);
  // Dropped from the queue, it rejects as cancelled; one that left the queue meanwhile gets its 5 s.
  if (waited === "answered" || (waited === "queue-expired" && pf.drop() > 0)) return answer;
  const deadline = host.sleep(HEALTH_PROBE_MS).then((): Result<SupervisorHealthOutputBody, GcError> =>
    err({ kind: "timeout", url: `${client.value.baseUrl}/health`, ms: HEALTH_PROBE_MS }));
  return Promise.race([answer, deadline]);
}

/** Probes a candidate; a probe the mod cancelled was not an answer from gc, so it is tried again (PROBE_ATTEMPTS). */
async function probeCandidate(host: ResolveHost, url: string): Promise<Result<SupervisorHealthOutputBody, GcError>> {
  let health = await probe(host, url);
  for (let attempt = 1; attempt < PROBE_ATTEMPTS && !health.ok && health.error.kind === "cancelled"; attempt++) health = await probe(host, url);
  return health;
}

/** Resolves the gc API endpoint. Never throws. */
export async function resolveEndpoint(host: ResolveHost): Promise<Result<Endpoint, NoEndpoint>> {
  const attempts: Attempt[] = [];
  const settings = decodeSettings(host.settings());
  if (!settings.ok) return err({ reason: "invalid", source: "setting", error: settings.error, attempts });
  const { apiUrl, gcBin } = settings.value;

  const sources: [EndpointSource, () => Promise<Candidate>][] = [
    ["setting", async () => (apiUrl === null ? { kind: "absent", detail: "no apiUrl setting" } : { kind: "url", url: apiUrl })],
    ["gc-reported", async () => {
      const ran = await host.gcStatus(gcBin);
      if (!ran.ok) return { kind: "unavailable", error: ran.error };
      const parsed = parseGcStatus(ran.value);
      if (!parsed.ok) return { kind: "unavailable", error: parsed.error };
      return parsed.value === null ? { kind: "absent", detail: `${GC_STATUS_COMMAND} reports no api_url` } : { kind: "url", url: parsed.value };
    }],
    ["supervisor-config", async () => {
      const read = await host.readSupervisorConfig();
      if (!read.ok) return { kind: "invalid", error: read.error };
      if (read.value.text === null) return { kind: "absent", detail: `${read.value.path} does not exist` };
      const listen = parseSupervisorConfig(read.value.text, read.value.path);
      return listen.ok ? { kind: "url", url: supervisorApiUrl(listen.value) } : { kind: "invalid", error: listen.error };
    }],
    ["default", async () => ({ kind: "url", url: DEFAULT_API_URL })],
  ];

  const probed = new Map<string, EndpointSource>();
  for (const [source, candidate] of sources) {
    const c = await candidate();
    if (c.kind === "absent") {
      attempts.push({ source, outcome: "absent", detail: c.detail });
      continue;
    }
    if (c.kind === "unavailable") {
      attempts.push({ source, outcome: "unavailable", error: c.error });
      continue;
    }
    if (c.kind === "invalid") return err({ reason: "invalid", source, error: c.error, attempts });

    const client = createGcClient({ baseUrl: c.url, fetch: host.fetch });
    if (!client.ok) {
      attempts.push({ source, outcome: "refused", url: c.url, error: client.error });
      return err({ reason: "refused", source, error: client.error, attempts });
    }
    const url = client.value.baseUrl;
    const earlier = probed.get(url);
    if (earlier !== undefined) {
      attempts.push({ source, outcome: "absent", detail: `same URL as ${SOURCE_NAMES[earlier]}, already tried` });
      continue;
    }
    probed.set(url, source);
    const health = await probeCandidate(host, url);
    if (!health.ok) {
      attempts.push({ source, outcome: "unreachable", url, error: health.error });
      continue;
    }
    attempts.push({ source, outcome: "ok", url, version: health.value.version });
    return ok({ url, source, version: health.value.version, gcBin, attempts });
  }
  return err({ reason: "none-reachable", attempts });
}
