// Schemas for the herdr-app host data the mod reads: only the
// fields it relies on, so a herdr-app change becomes a visible `host-decode`
// error instead of `any` flowing into the view-model. Shapes from herdr-app
// v0.1.14 (defaults/herdr.d.ts; terminals() = `hc ls --json` records plus
// herdr's `program`, src/window.rs terminals_listed). The decode policy is the
// gc one (src/gc/decode.ts): extra fields ignored, unknown enum values kept as
// unrecognized, list entries decoded one by one.

import { err, ok, type Result } from "./result.ts";
import { decodeValue, enumOf, type Drift } from "./gc/decode.ts";
import type { GcError } from "./gc/errors.ts";
import * as z from "./gc/zod.ts";

/** A host-data decode failure. */
export type HostDecodeError = Extract<GcError, { kind: "host-decode" }>;

/** A terminal from terminals(): what open-terminal dedupe reads. */
export interface HostTerminal {
  address: string;
  argv: string[];
  labels: Record<string, string>;
  state: Drift<"live" | "finished">;
  /** `shell` is true when the terminal's running program is the shell (an attach that ended). */
  program: { shell: boolean };
}

/** A pane from panes(); `mod` names a mod pane, whose `terminal` is null. */
export interface HostPane {
  pane: string;
  tab: string;
  terminal?: string | null | undefined;
  mod?: string | undefined;
}

/** A space from spaces(); `machine` is null for this computer. */
export interface HostSpace {
  id: string;
  machine: string | null;
  active: boolean;
  tabs: { id: string; active: boolean }[];
}

/** focused(): the window's current space and tab. */
export interface HostFocus {
  space: string;
  tab: string;
}

const TerminalSchema: z.ZodMiniType<HostTerminal> = z.object({
  address: z.string(),
  argv: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  state: enumOf(["live", "finished"]),
  program: z.object({ shell: z.boolean() }),
});

const PaneSchema: z.ZodMiniType<HostPane> = z.object({
  pane: z.string(),
  tab: z.string(),
  terminal: z.optional(z.nullable(z.string())),
  mod: z.optional(z.string()),
});

const SpaceSchema: z.ZodMiniType<HostSpace> = z.object({
  id: z.string(),
  machine: z.nullable(z.string()),
  active: z.boolean(),
  tabs: z.array(z.object({ id: z.string(), active: z.boolean() })),
});

const FocusSchema: z.ZodMiniType<HostFocus | null> = z.nullable(z.object({ space: z.string(), tab: z.string() }));

/** A decoded host list: the readable entries, and a host-decode error per unreadable one. */
export interface HostList<T> {
  items: T[];
  errors: HostDecodeError[];
}

function hostDecode<T>(api: string, schema: z.ZodMiniType<T>, value: unknown, path = ""): Result<T, HostDecodeError> {
  const r = decodeValue(schema, value, api, path);
  return r.ok ? r : err({ kind: "host-decode", api, path: r.error.path, issues: r.error.issues });
}

function hostList<T>(api: string, schema: z.ZodMiniType<T>, value: unknown): Result<HostList<T>, HostDecodeError> {
  const list = hostDecode(api, z.array(z.unknown()), value);
  if (!list.ok) return list;
  const out: HostList<T> = { items: [], errors: [] };
  list.value.forEach((entry, i) => {
    const r = hostDecode(api, schema, entry, `[${i}]`);
    if (r.ok) out.items.push(r.value);
    else out.errors.push(r.error);
  });
  return ok(out);
}

/** Decodes terminals(). */
export function decodeTerminals(value: unknown): Result<HostList<HostTerminal>, HostDecodeError> {
  return hostList("terminals", TerminalSchema, value);
}

/** Decodes panes(). */
export function decodePanes(value: unknown): Result<HostList<HostPane>, HostDecodeError> {
  return hostList("panes", PaneSchema, value);
}

/** Decodes spaces(). */
export function decodeSpaces(value: unknown): Result<HostList<HostSpace>, HostDecodeError> {
  return hostList("spaces", SpaceSchema, value);
}

/** What open terminal reads from herdr: every space, pane and terminal. */
export interface HostScene {
  spaces: HostSpace[];
  panes: HostPane[];
  terminals: HostTerminal[];
}

/**
 * Decodes spaces(), panes() and terminals() together. Any unreadable entry
 * is an error: open terminal decides where a program runs from this data, so
 * it acts only on data it can read whole.
 */
export function decodeScene(raw: { spaces: unknown; panes: unknown; terminals: unknown }): Result<HostScene, HostDecodeError> {
  const spaces = decodeSpaces(raw.spaces);
  if (!spaces.ok) return spaces;
  const panes = decodePanes(raw.panes);
  if (!panes.ok) return panes;
  const terminals = decodeTerminals(raw.terminals);
  if (!terminals.ok) return terminals;
  const first = spaces.value.errors[0] ?? panes.value.errors[0] ?? terminals.value.errors[0];
  if (first) return err(first);
  return ok({ spaces: spaces.value.items, panes: panes.value.items, terminals: terminals.value.items });
}

/** Decodes focused(); null means nothing is focused. */
export function decodeFocused(value: unknown): Result<HostFocus | null, HostDecodeError> {
  return hostDecode("focused", FocusSchema, value);
}

/**
 * The mod names of a layout()'s blocks (`{content: {mod: "<name>"}}` at any
 * depth). herdr publishes no schema for layouts, so this reads only that
 * shape and ignores everything else; it never throws.
 */
export function layoutModNames(layout: unknown): string[] {
  const out = new Set<string>();
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const content = (v as { content?: unknown }).content;
    if (content !== null && typeof content === "object" && typeof (content as { mod?: unknown }).mod === "string") {
      out.add((content as { mod: string }).mod);
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(layout);
  return [...out];
}
