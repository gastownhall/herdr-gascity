// The header view-model: connection chip, where the gc API URL came from, the
// copy's city and the other cities' health, notices as banners, the cities
// an unpinned copy can choose from, and the discovery diagnostics. Pure: it
// reads only the city machine.

import type { CityMachine, CityNotice, CityState } from "../discovery/city.ts";
import type { Attempt, EndpointSource, NoEndpoint } from "../discovery/resolve.ts";
import type { GcError } from "../gc/errors.ts";
import type { CityInfo } from "../gc/types.gen.ts";
import { LOOPBACK_ONLY, errorText } from "./errorText.ts";

/** How each source is named in the header and diagnostics. */
export const SOURCE_LABELS: Readonly<Record<EndpointSource, string>> = {
  setting: "apiUrl setting",
  "gc-reported": "gc supervisor status",
  "supervisor-config": "~/.gc/supervisor.toml",
  default: "built-in default",
};

export type Tone = "ok" | "busy" | "warn" | "error";

/** A city as a choice or a health dot. */
export interface CityChoice {
  name: string;
  label: string;
}

export interface OtherCity {
  name: string;
  running: boolean;
  label: string;
}

export interface HeaderModel {
  chip: { tone: Tone; text: string };
  /** "gc <version> at <url> (from <source>)", once an endpoint answered. */
  endpoint: string | null;
  /** The copy's city; "(pinned)" for a pinned copy. */
  city: string | null;
  /** The other cities gc lists, for the health dots. */
  others: OtherCity[];
  banners: string[];
  /** Cities an unpinned copy may switch to, when it must or may choose; null when there is no choice to offer. */
  choices: CityChoice[] | null;
  /** Whether "retry now" (rediscover) is offered. */
  canRetry: boolean;
  diagnostics: string[];
}

function cityLabel(c: CityInfo): string {
  return c.running ? "running" : (c.status ?? "stopped");
}

function attemptLine(a: Attempt): string {
  const label = SOURCE_LABELS[a.source];
  switch (a.outcome) {
    case "absent":
      return `${label}: ${a.detail}`;
    case "unavailable":
      return `${label}: ${errorText(a.error)}`;
    case "refused":
      return `${label}: ${a.url} refused: ${errorText(a.error)}`;
    case "unreachable":
      return `${label}: ${a.url} unreachable: ${errorText(a.error)}`;
    case "ok":
      return `${label}: ${a.url} ok (gc ${a.version})`;
  }
}

function noEndpointChip(failure: NoEndpoint): string {
  if (failure.reason === "refused") {
    const url = failure.error.kind === "not-loopback" ? failure.error.url : "";
    return `refusing ${url} (${SOURCE_LABELS[failure.source]}): ${LOOPBACK_ONLY}`;
  }
  if (failure.reason === "invalid") {
    // An unreadable settings value may be any of its keys, not only apiUrl.
    const what = failure.source === "setting" ? "gascity.settings" : SOURCE_LABELS[failure.source];
    return `cannot use ${what}: ${errorText(failure.error)}`;
  }
  const tried = failure.attempts.filter((a): a is Extract<Attempt, { outcome: "unreachable" }> => a.outcome === "unreachable");
  const first = tried[0];
  if (!first) return "gc not reachable";
  const more = tried.length > 1 ? `; ${tried.length - 1} more tried` : "";
  return `gc not reachable at ${first.url} (${SOURCE_LABELS[first.source]})${more}`;
}

function isTransport(e: GcError): boolean {
  return e.kind === "unreachable" || e.kind === "timeout";
}

function noticeBanner(n: CityNotice, version: string): string {
  switch (n.kind) {
    case "write-grant-required":
      return `This city requires signed write grants; the Herdr mod does not mint them, so it is read-only here (gc: ${n.detail}).`;
    case "read-grant-required":
      return `This city requires signed read grants; the Herdr mod does not mint them, so it cannot show this city's data (gc: ${n.detail}).`;
    case "read-only":
      return `gc serves this API read-only (${n.detail}).`;
    case "api-missing":
      return `gc ${version} lacks ${n.operationId}: update gc.`;
  }
}

/** The chip of a running city: the most limiting notice, else connected. */
function runningChip(notices: CityNotice[]): HeaderModel["chip"] {
  if (notices.some((n) => n.kind === "read-grant-required")) return { tone: "error", text: "read grant required" };
  const readOnly = notices.find((n) => n.kind === "read-only");
  if (readOnly) return { tone: "warn", text: "read-only server" };
  const missing = notices.find((n) => n.kind === "api-missing");
  if (missing) return { tone: "warn", text: `gc too old (needs ${missing.operationId})` };
  if (notices.some((n) => n.kind === "write-grant-required")) return { tone: "warn", text: "connected, read-only" };
  return { tone: "ok", text: "connected" };
}

function chipOf(state: CityState): HeaderModel["chip"] {
  switch (state.phase) {
    case "discovering":
      return { tone: "busy", text: "looking for gc" };
    case "no-endpoint":
      return { tone: "error", text: noEndpointChip(state.failure) };
    case "listing":
      return { tone: "busy", text: `loading cities from ${state.endpoint.url}` };
    case "cities-failed": {
      const e = state.error;
      if (isTransport(e)) return { tone: "error", text: `gc not reachable at ${state.endpoint.url} (${SOURCE_LABELS[state.endpoint.source]})` };
      return { tone: "error", text: errorText(e) };
    }
    case "choose-city":
      return { tone: "warn", text: state.cities.items.length === 0 ? "gc manages no cities" : "choose a city" };
    case "city-unknown":
      return { tone: "error", text: `city "${state.city}" is not registered with gc at ${state.endpoint.url}` };
    case "city-stopped": {
      const status = state.cause === "api" ? "gc answered: not running" : (state.city.status ?? "not running");
      const error = state.city.error ? `: ${state.city.error}` : "";
      return { tone: "warn", text: `city stopped (${status})${error}` };
    }
    case "city-running":
      return runningChip(state.notices);
  }
}

/** The header for one copy; `hostErrors` are host calls that failed outside the machine. */
export function headerModel(m: CityMachine, hostErrors: readonly GcError[] = []): HeaderModel {
  const { state, copy } = m;
  const endpoint = "endpoint" in state ? state.endpoint : null;
  const cities = "cities" in state ? state.cities : null;
  const cityName = state.phase === "city-running" || state.phase === "city-stopped" ? state.city.name
    : state.phase === "city-unknown" ? state.city : null;

  const banners: string[] = [];
  if ((state.phase === "city-running" || state.phase === "city-stopped") && endpoint) {
    for (const n of state.notices) banners.push(noticeBanner(n, endpoint.version));
  }
  if (cities && cities.unreadable.length > 0) {
    const n = cities.unreadable.length;
    banners.push(`${n} city ${n === 1 ? "entry" : "entries"} from gc could not be read (see diagnostics).`);
  }

  for (const e of hostErrors) banners.push(`Herdr: ${errorText(e)}.`);

  const attempts = endpoint ? endpoint.attempts : state.phase === "no-endpoint" ? state.failure.attempts : [];
  const diagnostics = attempts.map(attemptLine);
  if (state.phase === "no-endpoint" && state.failure.reason === "invalid") {
    diagnostics.push(`${SOURCE_LABELS[state.failure.source]}: ${errorText(state.failure.error)}`);
  }
  for (const u of cities?.unreadable ?? []) {
    diagnostics.push(`unreadable city ${u.id ?? "(no name)"} (items[${u.index}]): ${errorText(u.error)}`);
  }

  const offerChoice = copy.pinned === null && cities !== null
    && (state.phase === "choose-city" || state.phase === "city-unknown" || state.phase === "city-running" || state.phase === "city-stopped");
  const choices = offerChoice
    ? cities.items.filter((c) => c.name !== cityName).map((c) => ({ name: c.name, label: cityLabel(c) }))
    : null;

  return {
    chip: chipOf(state),
    endpoint: endpoint ? `gc ${endpoint.version} at ${endpoint.url} (from ${SOURCE_LABELS[endpoint.source]})` : null,
    city: cityName === null ? null : copy.pinned !== null ? `${cityName} (pinned)` : cityName,
    others: (cities?.items ?? []).filter((c) => c.name !== cityName).map((c) => ({ name: c.name, running: c.running, label: cityLabel(c) })),
    banners,
    choices,
    canRetry: state.phase !== "discovering" && state.phase !== "listing",
    diagnostics,
  };
}
