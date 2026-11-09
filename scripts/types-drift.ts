// Type-checks the mod's sources against the host declarations a herdr-app
// release generates, instead of the hand-written subsets in types/.
//
// `herdr-app types <dir>` writes gpui-kit.d.ts: the gpui-kit/gpui-base/
// gpui-shell modules, the script globals and the `herdr` module (the same text
// as the app's herdr.d.ts). This check compiles src/ against that file, with
// compat/host-aliases.ts mapping the subsets' global names onto it, and lists
// every host declaration src/ uses (the host surface) with its type. Given the
// previous release's declarations too, it diffs the two surfaces, so a failure
// says what changed in the parts of the host the mod uses.
//
// Usage:
//   bun run scripts/types-drift.ts --generated <dir> --version <v>
//     [--previous <dir> --previous-version <v>] [--report <file.md>]
// Exits 1 when src/ does not type-check against the generated declarations.

import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { ROOT } from "./gc-spec.ts";

/** The file `herdr-app types <dir>` writes. */
export const GENERATED_FILE = "gpui-kit.d.ts";

/** Hand-written subsets of herdr-app's declarations: replaced by the generated file in this check. */
export const HOST_SUBSETS = ["types/gpui-kit.d.ts", "types/herdr.d.ts", "types/shell-globals.d.ts"];

/** Files in types/ that are not host declarations: kept in this check. */
export const KEPT_TYPES = ["types/zod-url.d.ts"];

/** Maps the subsets' global type names onto the generated declarations. */
export const HOST_ALIASES = "compat/host-aliases.ts";

/** Every host declaration the sources use, by qualified name, with its type. */
export type Surface = Record<string, string>;

export interface HostCheck {
  /** tsc diagnostics in the sources (and the aliases), formatted; empty when they type-check. */
  diagnostics: string[];
  surface: Surface;
}

export interface CheckInput {
  /** The mod's source files (absolute). */
  sources: string[];
  /** Other declaration files the sources need (absolute). */
  kept: string[];
  /** compat/host-aliases.ts (absolute). */
  aliases: string;
  /** The generated host declarations (absolute). */
  declarations: string[];
  /** The repo's tsconfig.json compiler options. */
  options: ts.CompilerOptions;
  /** Paths in diagnostics are relative to this. */
  root: string;
}

/** The mod's tsconfig.json compiler options and files, split into sources and kept declarations. */
export function repoInput(root: string = ROOT): Omit<CheckInput, "declarations"> {
  const file = join(root, "tsconfig.json");
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const rel = (f: string) => relative(root, f);
  const sources = parsed.fileNames.filter((f) => !f.endsWith(".d.ts"));
  const declarations = parsed.fileNames.filter((f) => f.endsWith(".d.ts")).map(rel);
  const unclassified = declarations.filter((f) => !HOST_SUBSETS.includes(f) && !KEPT_TYPES.includes(f));
  if (unclassified.length > 0) {
    throw new Error(`classify ${unclassified.join(", ")} in scripts/types-drift.ts: HOST_SUBSETS (a subset of herdr-app's declarations) or KEPT_TYPES`);
  }
  return {
    sources,
    kept: KEPT_TYPES.map((f) => join(root, f)),
    aliases: join(root, HOST_ALIASES),
    options: parsed.options,
    root,
  };
}

const PRINT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature;

/** Compiles the sources against the generated declarations and collects the host surface they use. */
export function checkAgainstHost(input: CheckInput): HostCheck {
  const options: ts.CompilerOptions = { ...input.options, noEmit: true, skipLibCheck: true };
  const program = ts.createProgram([...input.sources, ...input.kept, input.aliases, ...input.declarations], options);
  const checker = program.getTypeChecker();
  const host = new Set(input.declarations.map((f) => program.getSourceFile(f)?.fileName).filter((f): f is string => f !== undefined));
  const isHost = (sym: ts.Symbol) => (sym.declarations ?? []).some((d) => host.has(d.getSourceFile().fileName));

  const surface: Surface = {};
  const record = (sym: ts.Symbol | undefined): void => {
    if (!sym) return;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    // Not a host declaration (a compat alias is visited as a source, so the
    // host names it maps onto are recorded there).
    if (!isHost(sym)) return;
    const name = checker.getFullyQualifiedName(sym);
    if (surface[name] !== undefined) return;
    surface[name] = describeSymbol(checker, sym);
  };

  const sources = new Set([...input.sources, input.aliases].map((f) => program.getSourceFile(f)?.fileName));
  for (const file of program.getSourceFiles()) {
    if (!sources.has(file.fileName)) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) record(checker.getSymbolAtLocation(node));
      if (ts.isClassDeclaration(node)) {
        // An overriding member uses the host member it overrides.
        for (const base of checker.getBaseTypes(checker.getTypeAtLocation(node) as ts.InterfaceType)) {
          for (const member of node.members) {
            const name = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
            if (name) record(checker.getPropertyOfType(base, name));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => input.root,
    getNewLine: () => "\n",
  };
  return {
    diagnostics: diagnostics.map((d) => ts.formatDiagnostic(d, formatHost).trimEnd()),
    surface: Object.fromEntries(Object.entries(surface).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function describeSymbol(checker: ts.TypeChecker, sym: ts.Symbol): string {
  const f = sym.flags;
  if (f & ts.SymbolFlags.Module) return "module";
  if (f & ts.SymbolFlags.Class) return "class";
  if (f & ts.SymbolFlags.Interface) {
    const bases = checker.getBaseTypes(checker.getDeclaredTypeOfSymbol(sym) as ts.InterfaceType);
    return bases.length > 0 ? `interface extends ${bases.map((b) => checker.typeToString(b, undefined, PRINT)).join(", ")}` : "interface";
  }
  if (f & ts.SymbolFlags.TypeAlias) return `type = ${checker.typeToString(checker.getDeclaredTypeOfSymbol(sym), undefined, PRINT | ts.TypeFormatFlags.InTypeAlias)}`;
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  const optional = f & ts.SymbolFlags.Optional ? "?" : "";
  const type = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getTypeOfSymbol(sym);
  return `${optional}${checker.typeToString(type, undefined, PRINT)}`;
}

export interface SurfaceDiff {
  removed: [name: string, type: string][];
  changed: [name: string, before: string, after: string][];
  added: [name: string, type: string][];
}

/** What changed between two host surfaces of the same sources. */
export function diffSurface(before: Surface, after: Surface): SurfaceDiff {
  const out: SurfaceDiff = { removed: [], changed: [], added: [] };
  for (const [name, type] of Object.entries(before)) {
    const now = after[name];
    if (now === undefined) out.removed.push([name, type]);
    else if (now !== type) out.changed.push([name, type, now]);
  }
  for (const [name, type] of Object.entries(after)) if (before[name] === undefined) out.added.push([name, type]);
  return out;
}

export interface TypesReport {
  version: string;
  check: HostCheck;
  previous?: { version: string; check: HostCheck } | undefined;
}

/** The diff as a unified-diff block of `name: type` lines. */
export function formatSurfaceDiff(diff: SurfaceDiff): string {
  const lines: string[] = [];
  for (const [name, type] of diff.removed) lines.push(`- ${name}: ${type}`);
  for (const [name, before, after] of diff.changed) lines.push(`- ${name}: ${before}`, `+ ${name}: ${after}`);
  for (const [name, type] of diff.added) lines.push(`+ ${name}: ${type}`);
  return lines.join("\n");
}

const fence = (lang: string, body: string) => ["```" + lang, body, "```"].join("\n");

/** A Markdown report for the job summary. */
export function formatTypesReport(r: TypesReport): string {
  const out = ["## herdr-app types drift", ""];
  const errors = r.check.diagnostics.length;
  out.push(
    errors === 0
      ? `src/ type-checks against the declarations herdr-app ${r.version} generates.`
      : `**src/ does not type-check against the declarations herdr-app ${r.version} generates: ${errors} error${errors === 1 ? "" : "s"}.**`,
    "",
  );
  if (r.previous) {
    const diff = diffSurface(r.previous.check.surface, r.check.surface);
    const n = diff.removed.length + diff.changed.length + diff.added.length;
    if (n === 0) {
      out.push(`The host declarations src/ uses are unchanged since herdr-app ${r.previous.version}.`, "");
    } else {
      out.push(`What changed since herdr-app ${r.previous.version} in the host declarations src/ uses:`, "", fence("diff", formatSurfaceDiff(diff)), "");
    }
  } else {
    out.push("No earlier release's declarations to compare with; the host surface src/ uses is below.", "");
  }
  if (errors > 0) out.push("Type errors:", "", fence("text", r.check.diagnostics.join("\n")), "");
  out.push(
    `<details><summary>Host surface src/ uses (${Object.keys(r.check.surface).length} declarations, herdr-app ${r.version})</summary>`,
    "",
    fence("ts", Object.entries(r.check.surface).map(([k, v]) => `${k}: ${v}`).join("\n")),
    "",
    "</details>",
    "",
  );
  if (errors > 0) {
    out.push(
      "The released app's host API no longer matches what the mod is written against. Adapt src/ and the subsets in types/ " +
        "(and compat/host-aliases.ts) to the generated declarations; the full files are in this run's artifact.",
      "",
    );
  }
  return out.join("\n");
}

function arg(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = arg(args, name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const input = repoInput();
  const declarationsIn = (dir: string) => [join(dir, GENERATED_FILE)];
  for (const dir of [required(args, "--generated"), arg(args, "--previous")]) {
    if (dir) await readFile(join(dir, GENERATED_FILE)); // fails loudly when the file is missing
  }
  const check = checkAgainstHost({ ...input, declarations: declarationsIn(required(args, "--generated")) });
  const previousDir = arg(args, "--previous");
  const previous = previousDir
    ? { version: required(args, "--previous-version"), check: checkAgainstHost({ ...input, declarations: declarationsIn(previousDir) }) }
    : undefined;
  const report = formatTypesReport({ version: required(args, "--version"), check, previous });
  const reportPath = arg(args, "--report");
  if (reportPath) await writeFile(reportPath, report);
  const surfacePath = arg(args, "--surface");
  if (surfacePath) await writeFile(surfacePath, JSON.stringify(check.surface, null, 2) + "\n");
  console.log(report);
  if (process.env["GITHUB_ACTIONS"] === "true" && check.diagnostics.length > 0) {
    console.log(`::error title=herdr-app types drift::src/ does not type-check against herdr-app ${required(args, "--version")} (${check.diagnostics.length} errors)`);
  }
  if (check.diagnostics.length > 0) process.exit(1);
}
