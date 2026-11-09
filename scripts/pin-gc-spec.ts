// Pins gc's OpenAPI spec for the mod's used surface (design §5.2, §12).
//
// Reads gc's full internal/api/openapi.json at one commit and writes
// api/openapi.pinned.json: the operations listed in api/used-surface.json
// (only their methods), every component they reach through $ref, and the
// top-level fields. Upstream key order is kept, so re-pinning the same commit
// gives the same bytes. api/PIN records the commit and the sha256 of the full
// upstream file, so anyone can re-derive the pin.
//
// Usage:
//   git -C <gascity> show <commit>:internal/api/openapi.json > /tmp/openapi.json
//   bun run scripts/pin-gc-spec.ts --spec /tmp/openapi.json --commit <sha> --committed <iso date>
// then `bun run gen:gc` to regenerate src/gc/*.gen.ts.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  METHODS, PINNED_SPEC, PIN_FILE, ROOT, USED_SURFACE, eachRef, formatPin, readJson, refTarget,
  type Pin, type Spec, type UsedSurface,
} from "./gc-spec.ts";

export const UPSTREAM_REPO = "gastownhall/gascity";
export const UPSTREAM_PATH = "internal/api/openapi.json";

/** Prunes `spec` to the used operations and the components they reach. */
export function pruneSpec(spec: Spec, used: UsedSurface): Spec {
  const wanted = new Set(Object.keys(used.operations));
  const found = new Set<string>();
  const paths: Spec["paths"] = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      const isMethod = (METHODS as readonly string[]).includes(key);
      const id = isMethod ? (value as { operationId?: string }).operationId : undefined;
      if (id && wanted.has(id)) {
        kept[key] = value;
        found.add(id);
      } else if (!isMethod) {
        kept[key] = value; // path-level fields such as shared parameters
      }
    }
    if (Object.keys(kept).some((k) => (METHODS as readonly string[]).includes(k))) paths[path] = kept;
  }
  const missing = [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`operations not in the spec: ${missing.join(", ")}`);

  const reached = new Map<string, Set<string>>();
  const visit = (ref: string) => {
    const [section, name] = refTarget(ref);
    const names = reached.get(section) ?? new Set<string>();
    reached.set(section, names);
    if (names.has(name)) return;
    names.add(name);
    const target = spec.components[section]?.[name];
    if (target === undefined) throw new Error(`dangling $ref ${ref}`);
    eachRef(target, visit);
  };
  eachRef(paths, visit);
  for (const name of used.payloadModels) visit(`#/components/schemas/${name}`);

  const components: Spec["components"] = { schemas: {} };
  for (const [section, entries] of Object.entries(spec.components)) {
    const names = reached.get(section);
    if (!names) continue;
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(entries)) if (names.has(name)) kept[name] = value;
    components[section] = kept;
  }

  const out: Spec = { ...spec, paths, components };
  delete out["webhooks"];
  return out;
}

/** The pinned file's text: two-space JSON with a trailing newline. */
export function formatSpec(spec: Spec): string {
  return JSON.stringify(spec, null, 2) + "\n";
}

function arg(args: string[], name: string): string {
  const at = args.indexOf(name);
  const value = at >= 0 ? args[at + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const raw = await readFile(arg(args, "--spec"), "utf8");
  const pin: Pin = {
    repo: UPSTREAM_REPO,
    commit: arg(args, "--commit"),
    committed: arg(args, "--committed"),
    path: UPSTREAM_PATH,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  const used = await readJson<UsedSurface>(ROOT, USED_SURFACE);
  await writeFile(join(ROOT, PINNED_SPEC), formatSpec(pruneSpec(JSON.parse(raw) as Spec, used)));
  await writeFile(join(ROOT, PIN_FILE), formatPin(pin));
  console.log(`pinned ${pin.repo}@${pin.commit} (${Object.keys(used.operations).length} operations) to ${PINNED_SPEC}`);
}
