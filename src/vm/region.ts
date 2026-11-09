// How a region of the panel says how current its data is (US8): "data N s
// old", stale data kept greyed with the error above it, a loading state
// before the first answer, and a failure before any data. Never silently
// cleared, never silently kept.

import type { Freshness } from "../sync/staleness.ts";
import { errorText } from "./errorText.ts";

/** A region's data state. */
export interface RegionModel {
  /** loading: no data and no error yet; failed: no data, an error; ok: data (maybe stale). */
  kind: "loading" | "failed" | "ok";
  /** "data N s old" once there is data. */
  age: string | null;
  /** Show the data greyed: it may be out of date. */
  stale: boolean;
  /** The first error, named by its part ("sessions: …"). */
  error: string | null;
}

/** "3 s", "2 min", "1 h". */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}

/** One region's state from the freshness of each part it shows, most important part first. */
export function regionModel(parts: readonly (readonly [name: string, freshness: Freshness])[]): RegionModel {
  let error: string | null = null;
  const note = (name: string, e: Parameters<typeof errorText>[0] | null) => {
    if (error === null && e !== null) error = `${name}: ${errorText(e)}`;
  };
  let never = false;
  let stale = false;
  let age = 0;
  for (const [name, f] of parts) {
    if (f.kind === "never") {
      never = true;
      note(name, f.error);
      continue;
    }
    age = Math.max(age, f.ageMs);
    if (f.kind === "stale") {
      stale = true;
      note(name, f.error);
    }
  }
  if (never) return error === null ? { kind: "loading", age: null, stale: false, error: null } : { kind: "failed", age: null, stale: true, error };
  return { kind: "ok", age: `data ${ageText(age)} old`, stale, error };
}
