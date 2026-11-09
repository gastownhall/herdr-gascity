// The authority lint (design §8 single-authority rule, §9 trusted-mod hygiene).
//
// gc is the only authority over gc sessions, agents, rigs and beads, so the
// mod must never call hc, tmux or bd, nor herdr's terminal.kill/send/keys/
// label/keep. And because a herdr mod runs with the person's full rights, it
// must never compile code at run time: no eval, no Function constructor, no
// dynamic import. zod (slice M1) is imported only through src/gc/zod.ts,
// which turns on `jitless` before any schema module can run.
//
// The lint parses each file with the TypeScript parser, so comments never
// count and every spelling of an identifier or string literal does. It scans
// src/**/*.ts and the built gascity/**/*.js.
//
// Usage: bun run scripts/authority.ts [file-or-dir ...]   (default: the repo)

import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export type RuleId =
  | "hc"
  | "tmux"
  | "bd"
  | "terminal-command"
  | "eval"
  | "function-constructor"
  | "dynamic-import"
  | "zod-import"
  | "zod-jitless"
  | "stale-allowlist";

/** One lint finding; line and column are 1-based. */
export interface Violation {
  file: string;
  line: number;
  column: number;
  rule: RuleId;
  message: string;
}

/**
 * An allowed hit: a hit of `rule` in `file` is allowed only if it lies inside
 * an occurrence of `text`, matched exactly. An entry that allows nothing is
 * itself a violation, so a changed dependency cannot leave a stale hole.
 */
export interface AllowEntry {
  file: string;
  rule: RuleId;
  text: string;
  reason: string;
}

/** The allowlist for this repo. */
export const ALLOWLIST: readonly AllowEntry[] = [];

/** The only module that may import zod. */
export const ZOD_MODULE = "src/gc/zod.ts";

const PROGRAMS: Readonly<Record<string, RuleId>> = { hc: "hc", tmux: "tmux", bd: "bd" };
const IDENTIFIERS: Readonly<Record<string, RuleId>> = { hc: "hc", eval: "eval", Function: "function-constructor" };
const TERMINAL_COMMAND = /^terminal\.(kill|send|keys|label|keep)(?![\w.-])/;
const TERMINAL_PREFIX = /^terminal\.$/;

const MESSAGES: Readonly<Record<RuleId, string>> = {
  hc: "the mod must not call hc: every gc mutation is a gc API call (design §8)",
  tmux: "the mod must not run tmux: gc owns its sessions' runtimes (design §8)",
  bd: "the mod must not run bd: every bead mutation is a gc API call (design §8)",
  "terminal-command": "terminal.kill/send/keys/label/keep are forbidden: gc owns its sessions' terminals (design §8)",
  eval: "eval is forbidden: the mod never compiles code at run time (design §9)",
  "function-constructor": "the Function constructor is forbidden: the mod never compiles code at run time (design §9)",
  "dynamic-import": "dynamic import is forbidden: all code is bundled (design §9)",
  "zod-import": `import zod only through ${ZOD_MODULE}, which turns on jitless first (design §4)`,
  "zod-jitless": `${ZOD_MODULE} must call z.config({ jitless: true }) (design §4)`,
  "stale-allowlist": "allowlist entry matches nothing: remove or update it",
};

interface Hit {
  rule: RuleId;
  start: number;
  end: number;
}

function programRule(value: string): RuleId | undefined {
  const first = value.trimStart().split(/\s/, 1)[0] ?? "";
  return PROGRAMS[first.slice(first.lastIndexOf("/") + 1)];
}

function stringRules(value: string): RuleId[] {
  const out: RuleId[] = [];
  const program = programRule(value);
  if (program) out.push(program);
  if (value === "eval") out.push("eval");
  if (value === "Function") out.push("function-constructor");
  if (TERMINAL_COMMAND.test(value) || TERMINAL_PREFIX.test(value)) out.push("terminal-command");
  return out;
}

function isZodSpecifier(node: ts.Expression | undefined): boolean {
  return !!node && ts.isStringLiteral(node) && (node.text === "zod" || node.text.startsWith("zod/"));
}

function isJitlessConfig(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "config") return false;
  const arg = node.arguments[0];
  return !!arg && ts.isObjectLiteralExpression(arg) && arg.properties.some((p) =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "jitless"
    && p.initializer.kind === ts.SyntaxKind.TrueKeyword);
}

function scriptKind(file: string): ts.ScriptKind {
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** Lints one file's text. `file` is the repo-relative path the rules and allowlist key on. */
export function lintSource(file: string, text: string, allowlist: readonly AllowEntry[] = ALLOWLIST): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const hits: Hit[] = [];
  let jitless = false;
  const add = (rule: RuleId, node: ts.Node) => hits.push({ rule, start: node.getStart(sf), end: node.getEnd() });

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const rule = IDENTIFIERS[node.text];
      if (rule) add(rule, node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) {
      for (const rule of stringRules(node.text)) add(rule, node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add("dynamic-import", node);
    } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isZodSpecifier(node.moduleSpecifier)) {
      if (file !== ZOD_MODULE) add("zod-import", node);
    }
    if (isJitlessConfig(node)) jitless = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const entries = allowlist.filter((e) => e.file === file);
  const used = new Set<AllowEntry>();
  const allowed = (hit: Hit) => entries.some((e) => {
    if (e.rule !== hit.rule) return false;
    for (let at = text.indexOf(e.text); at >= 0; at = text.indexOf(e.text, at + 1)) {
      if (at <= hit.start && hit.end <= at + e.text.length) {
        used.add(e);
        return true;
      }
    }
    return false;
  });

  const at = (pos: number, rule: RuleId, message = MESSAGES[rule]): Violation => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    return { file, line: line + 1, column: character + 1, rule, message };
  };
  const out = hits.filter((h) => !allowed(h)).map((h) => at(h.start, h.rule));
  if (file === ZOD_MODULE && !jitless) out.push(at(0, "zod-jitless"));
  for (const e of entries) if (!used.has(e)) out.push(at(0, "stale-allowlist", `${MESSAGES["stale-allowlist"]} (${e.rule}: ${e.reason})`));
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

async function glob(root: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) out.push(path);
  return out;
}

/** The repo-relative files the lint covers: src/**\/*.ts and the built gascity/**\/*.js. */
export async function defaultTargets(root: string): Promise<string[]> {
  const files = [...await glob(root, "src/**/*.ts"), ...await glob(root, "gascity/**/*.js")];
  return files.sort();
}

/** Lints the given repo-relative files under `root`. */
export async function lintFiles(root: string, files: readonly string[], allowlist: readonly AllowEntry[] = ALLOWLIST): Promise<Violation[]> {
  const out: Violation[] = [];
  for (const file of files) out.push(...lintSource(file, await readFile(join(root, file), "utf8"), allowlist));
  return out;
}

/** Lints the whole repo; allowlist entries for files that do not exist are stale. */
export async function lintTree(root: string, allowlist: readonly AllowEntry[] = ALLOWLIST): Promise<Violation[]> {
  const files = await defaultTargets(root);
  const out = await lintFiles(root, files, allowlist);
  for (const e of allowlist) {
    if (!files.includes(e.file)) {
      out.push({ file: e.file, line: 1, column: 1, rule: "stale-allowlist", message: `${MESSAGES["stale-allowlist"]} (file not linted)` });
    }
  }
  return out;
}

async function expand(cwd: string, arg: string): Promise<string[]> {
  const abs = resolve(cwd, arg);
  if (!(await stat(abs)).isDirectory()) return [relative(cwd, abs)];
  return (await glob(abs, "**/*.{ts,js,mjs,cjs}")).map((p) => relative(cwd, join(abs, p))).sort();
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const args = process.argv.slice(2);
  let violations: Violation[];
  let count: number;
  if (args.length === 0) {
    violations = await lintTree(root);
    count = (await defaultTargets(root)).length;
  } else {
    const cwd = process.cwd();
    const files = (await Promise.all(args.map((a) => expand(cwd, a)))).flat();
    violations = await lintFiles(cwd, files);
    count = files.length;
  }
  for (const v of violations) console.error(`${v.file}:${v.line}:${v.column}: ${v.rule}: ${v.message}`);
  if (violations.length > 0) process.exit(1);
  console.log(`authority lint: ${count} files clean`);
}
