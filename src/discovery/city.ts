// The city state machine of one copy of the mod. Pure: events in, a new
// machine out; the controller (controller.ts) performs the I/O and feeds the
// results back.
//
//   discovering ─► no-endpoint
//               └► listing ─► cities-failed
//                           ├► choose-city            (unpinned, nothing to select)
//                           ├► city-unknown           (the copy's city is not in gc's list)
//                           └► city-running ⇄ city-stopped
//
// A copy shows one city. A pinned copy (opened with props {city}) shows only
// that city and offers no switcher. An unpinned copy keeps the city it shows;
// with none it takes its last selection (per-copy localStorage) if gc lists
// it, else the only running city, else asks. Several cities at once are
// several copies.

import { err, ok, type Result } from "../result.ts";
import type { Listed } from "../gc/decode.ts";
import type { GcError } from "../gc/errors.ts";
import type { CityInfo, SupervisorCitiesOutputBody } from "../gc/types.gen.ts";
import type { Endpoint, NoEndpoint } from "./resolve.ts";

/** gc's city list as the client decodes it. */
export type CityList = Listed<SupervisorCitiesOutputBody, CityInfo>;

/** What this copy was opened with and what it remembers. */
export interface CopyContext {
  /** props().city: the copy shows only this city. */
  pinned: string | null;
  /** The city this copy's person last chose (unpinned copies only write it). */
  lastSelection: string | null;
}

/** Something gc said about the selected city that limits what the copy can do. */
export type CityNotice =
  | { kind: "write-grant-required"; detail: string }
  | { kind: "read-grant-required"; detail: string }
  | { kind: "read-only"; detail: string }
  | { kind: "api-missing"; operationId: string };

/** The errors of a city-scoped call that change the city state; transport failures are the sync engine's backoff. */
export type CityScopedError = Extract<GcError, { kind: "city-not-running" | "write-grant-required" | "read-grant-required" | "read-only" | "api-missing" }>;

export type CityState =
  | { phase: "discovering" }
  | { phase: "no-endpoint"; failure: NoEndpoint }
  | { phase: "listing"; endpoint: Endpoint }
  | { phase: "cities-failed"; endpoint: Endpoint; error: GcError; selected: string | null }
  | { phase: "choose-city"; endpoint: Endpoint; cities: CityList }
  | { phase: "city-unknown"; endpoint: Endpoint; cities: CityList; city: string }
  | { phase: "city-stopped"; endpoint: Endpoint; cities: CityList; city: CityInfo; cause: "list" | "api"; notices: CityNotice[] }
  | { phase: "city-running"; endpoint: Endpoint; cities: CityList; city: CityInfo; notices: CityNotice[] };

export interface CityMachine {
  copy: CopyContext;
  state: CityState;
}

export type CityEvent =
  /** Start (or restart) discovery. */
  | { type: "discover" }
  | { type: "resolved"; result: Result<Endpoint, NoEndpoint> }
  /** A /v0/cities answer. */
  | { type: "cities"; result: Result<CityList, GcError> }
  /** The person chose a city (unpinned copies). */
  | { type: "select"; city: string }
  /** A city-scoped call for `city` failed in a way that changes the city state. */
  | { type: "city-error"; city: string; error: CityScopedError };

/** The props() api name in errors. */
const PROPS_API = "props()";

/** Reads the copy context from herdr's props() (null for an unpinned copy) and the stored last selection. */
export function decodeCopy(props: unknown, lastSelection: string | null): Result<CopyContext, GcError> {
  if (props === null || props === undefined) return ok({ pinned: null, lastSelection });
  if (typeof props !== "object" || Array.isArray(props)) {
    return err({ kind: "host-decode", api: PROPS_API, path: "", issues: [`(root): expected an object or null, got ${JSON.stringify(props)}`] });
  }
  if (!Object.hasOwn(props, "city")) return ok({ pinned: null, lastSelection });
  const city: unknown = (props as Record<string, unknown>)["city"];
  if (typeof city !== "string" || city === "") {
    return err({ kind: "host-decode", api: PROPS_API, path: "city", issues: [`city: expected a non-empty string, got ${JSON.stringify(city)}`] });
  }
  return ok({ pinned: city, lastSelection });
}

/** A copy that has not discovered anything yet. */
export function initialMachine(copy: CopyContext): CityMachine {
  return { copy, state: { phase: "discovering" } };
}

/** The city this copy shows, if it has chosen one. */
export function selectedCity(state: CityState): string | null {
  switch (state.phase) {
    case "city-running":
    case "city-stopped":
      return state.city.name;
    case "city-unknown":
      return state.city;
    case "cities-failed":
      return state.selected;
    default:
      return null;
  }
}

function noticesOf(state: CityState, city: string): CityNotice[] {
  if ((state.phase === "city-running" || state.phase === "city-stopped") && state.city.name === city) return state.notices;
  return [];
}

/** The state for `cities`, keeping `current` (this copy's city) when there is one. */
function withCities(prev: CityState, copy: CopyContext, endpoint: Endpoint, cities: CityList, current: string | null): CityState {
  const listed = (name: string | null) => (name === null ? undefined : cities.items.find((c) => c.name === name));
  let name: string | null = copy.pinned ?? current;
  if (name === null) name = listed(copy.lastSelection)?.name ?? null;
  if (name === null) {
    const running = cities.items.filter((c) => c.running);
    if (running.length === 1) name = running[0]!.name;
  }
  if (name === null) return { phase: "choose-city", endpoint, cities };
  const info = listed(name);
  if (!info) return { phase: "city-unknown", endpoint, cities, city: name };
  const notices = noticesOf(prev, name);
  if (info.running) return { phase: "city-running", endpoint, cities, city: info, notices };
  return { phase: "city-stopped", endpoint, cities, city: info, cause: "list", notices };
}

function endpointOf(state: CityState): Endpoint | null {
  return "endpoint" in state ? state.endpoint : null;
}

function citiesOf(state: CityState): CityList | null {
  return "cities" in state ? state.cities : null;
}

/** One notice per kind, and per operation for api-missing; the first one's detail is kept. */
function noticeKey(n: CityNotice): string {
  return n.kind === "api-missing" ? `api-missing:${n.operationId}` : n.kind;
}

function addNotice(notices: CityNotice[], notice: CityNotice): CityNotice[] {
  const key = noticeKey(notice);
  return notices.some((n) => noticeKey(n) === key) ? notices : [...notices, notice];
}

function onCityError(state: CityState, city: string, error: CityScopedError): CityState {
  if ((state.phase !== "city-running" && state.phase !== "city-stopped") || state.city.name !== city) return state;
  switch (error.kind) {
    case "city-not-running":
      return {
        phase: "city-stopped", endpoint: state.endpoint, cities: state.cities, city: { ...state.city, running: false },
        cause: "api", notices: state.notices,
      };
    case "write-grant-required":
      return { ...state, notices: addNotice(state.notices, { kind: "write-grant-required", detail: error.detail }) };
    case "read-grant-required":
      return { ...state, notices: addNotice(state.notices, { kind: "read-grant-required", detail: error.detail }) };
    case "read-only":
      return { ...state, notices: addNotice(state.notices, { kind: "read-only", detail: error.detail }) };
    case "api-missing":
      return { ...state, notices: addNotice(state.notices, { kind: "api-missing", operationId: error.operationId }) };
  }
}

/** The next machine after `event`. Returns `m` itself when the event changes nothing. */
export function step(m: CityMachine, event: CityEvent): CityMachine {
  const { copy, state } = m;
  switch (event.type) {
    case "discover":
      return { copy, state: { phase: "discovering" } };
    case "resolved":
      return {
        copy,
        state: event.result.ok ? { phase: "listing", endpoint: event.result.value } : { phase: "no-endpoint", failure: event.result.error },
      };
    case "cities": {
      const endpoint = endpointOf(state);
      if (endpoint === null) return m;
      const current = selectedCity(state);
      if (!event.result.ok) return { copy, state: { phase: "cities-failed", endpoint, error: event.result.error, selected: current } };
      return { copy, state: withCities(state, copy, endpoint, event.result.value, current) };
    }
    case "select": {
      const endpoint = endpointOf(state);
      const cities = citiesOf(state);
      if (copy.pinned !== null || endpoint === null || cities === null) return m;
      const next = { ...copy, lastSelection: event.city };
      return { copy: next, state: withCities(state, next, endpoint, cities, event.city) };
    }
    case "city-error": {
      const next = onCityError(state, event.city, event.error);
      return next === state ? m : { copy, state: next };
    }
  }
}
