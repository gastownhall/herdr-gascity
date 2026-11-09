// The authority lint.
//
// gc is the only authority over gc sessions, agents, rigs and beads: the mod
// changes them only through gc's HTTP API. So it must never run hc, tmux or
// bd, nor the herdr commands that end, park, pin or type into a terminal.
// And a herdr mod runs with the person's full rights and no permission
// prompt, so it must never compile code at run time: no eval, no Function
// constructor (in any spelling), no dynamic import. zod is imported only
// through src/gc/zod.ts, which must turn on `jitless` (zod otherwise compiles
// parsers with `new Function`).
//
// The structure that makes the rest checkable:
// - only src/host.ts imports `herdr`, and only as `import * as herdr`;
// - the namespace is used only as `herdr.<export>`;
// - `herdr.run` and `herdr.exec` are called directly with a string literal
//   first argument from RUN_COMMANDS / EXEC_PROGRAMS;
// - modules other than gpui-kit, gpui-base, herdr, zod and relative paths are
//   not imported (the host's `process` module and global can spawn programs).
// String literals are also checked for hc/tmux/bd anywhere in a shell command
// and for the denied terminal commands, as defence in depth.
//
// Files are parsed with the TypeScript parser, so comments never count. The
// lint scans src/**/*.ts and the built gascity/**/*.js.
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
  | "run-command"
  | "exec-program"
  | "host-import"
  | "host-access"
  | "module-import"
  | "process"
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

/** The only module that may import herdr. */
export const HOST_MODULE = "src/host.ts";
/** The only module that may import zod. */
export const ZOD_MODULE = "src/gc/zod.ts";

/**
 * The herdr app commands the mod may run: open a tab (a mod tab, or a terminal
 * tab running `gc session attach`), select a tab, open the mod's overlay.
 * Adding one is a deliberate, reviewed change to this list.
 */
export const RUN_COMMANDS: readonly string[] = ["tab.new", "tab.select", "mod.open"];

/** The programs the mod may exec: the platform opener for the gc dashboard URL. */
export const EXEC_PROGRAMS: readonly string[] = ["xdg-open", "open"];

/**
 * Terminal commands the mod must never name: every command in herdr-app's
 * command table (src/commands.rs, v0.1.14) that ends, re-homes, pins or types
 * into a terminal, plus the hc verbs send/keys/label.
 */
export const TERMINAL_DENY: readonly string[] = [
  "terminal.kill", "terminal.keep", "terminal.park", "terminal.pin", "terminal.right_click",
  "terminal.paste", "terminal.paste_image", "terminal.send", "terminal.keys", "terminal.label",
];

const MODULES = new Set(["herdr", "gpui-kit", "gpui-base"]);
const PROGRAMS = new Map<string, RuleId>([["hc", "hc"], ["tmux", "tmux"], ["bd", "bd"]]);
const IDENTIFIERS = new Map<string, RuleId>([
  ["hc", "hc"], ["eval", "eval"], ["Function", "function-constructor"], ["process", "process"],
]);
const STRINGS = new Map<string, RuleId>([
  ["eval", "eval"], ["Function", "function-constructor"], ["process", "process"],
]);
const TERMINAL_COMMAND = new RegExp(
  `(^|[^\\w.])(${TERMINAL_DENY.map((c) => c.replace(".", "\\.")).join("|")})(?![\\w.])`,
);
const TERMINAL_PREFIX = /(^|[^\w.])terminal\.$/;
/** Shell word separators: whitespace, operators, substitutions, quotes, assignments. */
const SHELL_SPLIT = /[\s;&|()`$<>"'=,{}]+/;

const MESSAGES: Readonly<Record<RuleId, string>> = {
  hc: "the mod must not run hc: every gc change is a gc API call",
  tmux: "the mod must not run tmux: gc owns its sessions' runtimes",
  bd: "the mod must not run bd: every bead change is a gc API call",
  "terminal-command": `terminal commands that end, re-home, pin or type into a terminal are forbidden (${TERMINAL_DENY.join(", ")})`,
  "run-command": `herdr.run takes a string literal first argument from: ${RUN_COMMANDS.join(", ")}`,
  "exec-program": `herdr.exec takes a string literal first argument from: ${EXEC_PROGRAMS.join(", ")}`,
  "host-import": `only ${HOST_MODULE} imports herdr, and only as \`import * as herdr from "herdr"\``,
  "host-access": "use the herdr namespace only as herdr.<export>, and call herdr.run/herdr.exec directly",
  "module-import": "import only gpui-kit, gpui-base, herdr, zod and relative modules",
  process: "process is forbidden: process.run spawns programs",
  eval: "eval is forbidden: the mod never compiles code at run time",
  "function-constructor": "the Function constructor is forbidden in every spelling: the mod never compiles code at run time",
  "dynamic-import": "dynamic import is forbidden: all code is bundled",
  "zod-import": `import zod only through ${ZOD_MODULE}, which turns on jitless first`,
  "zod-jitless": `${ZOD_MODULE} must call z.config({ jitless: true })`,
  "stale-allowlist": "allowlist entry matches nothing: remove or update it",
};

interface Hit {
  rule: RuleId;
  start: number;
  end: number;
}

function stringRules(value: string): RuleId[] {
  const out: RuleId[] = [];
  for (const word of value.split(SHELL_SPLIT)) {
    const rule = PROGRAMS.get(word.slice(word.lastIndexOf("/") + 1).toLowerCase());
    if (rule && !out.includes(rule)) out.push(rule);
  }
  const exact = STRINGS.get(value);
  if (exact) out.push(exact);
  if (TERMINAL_COMMAND.test(value) || TERMINAL_PREFIX.test(value)) out.push("terminal-command");
  return out;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const p = node.parent;
  return !!p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node;
}

function isZodSpecifier(text: string): boolean {
  return text === "zod" || text.startsWith("zod/");
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

function unparen(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
}

/** `x.constructor` or `x["constructor"]`. */
function isConstructorMember(node: ts.Expression): boolean {
  const n = unparen(node);
  if (ts.isPropertyAccessExpression(n)) return n.name.text === "constructor";
  return ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
    && n.argumentExpression.text === "constructor";
}

function isReflectConstruct(node: ts.Expression): boolean {
  const n = unparen(node);
  return ts.isPropertyAccessExpression(n) && n.name.text === "construct"
    && ts.isIdentifier(n.expression) && n.expression.text === "Reflect";
}

function scriptKind(file: string): ts.ScriptKind {
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** The local names bound by `import * as <name> from "herdr"` in this file. */
function hostNamespaces(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "herdr") continue;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  }
  return names;
}

/** Is this the herdr import shape the lint allows: `import * as x from "herdr"`, nothing else? */
function isNamespaceOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  return !!clause && !clause.isTypeOnly && !clause.name && !!clause.namedBindings && ts.isNamespaceImport(clause.namedBindings);
}

/** Checks one use of the herdr namespace binding. */
function checkHostUse(node: ts.Identifier, add: (rule: RuleId, node: ts.Node) => void): void {
  const parent = node.parent;
  if (ts.isNamespaceImport(parent)) return;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) {
    add("host-access", node);
    return;
  }
  const member = parent.name.text;
  const rule: RuleId | undefined = member === "run" ? "run-command" : member === "exec" ? "exec-program" : undefined;
  if (!rule) return;
  const user = parent.parent;
  if (ts.isTypeOfExpression(user)) return;
  if (!ts.isCallExpression(user) || user.expression !== parent) {
    add("host-access", parent);
    return;
  }
  const first = user.arguments[0];
  const allowed = rule === "run-command" ? RUN_COMMANDS : EXEC_PROGRAMS;
  if (!first || !ts.isStringLiteralLike(first) || !allowed.includes(first.text)) add(rule, first ?? user);
}

/** Lints one file's text. `file` is the repo-relative path the rules and allowlist key on. */
export function lintSource(file: string, text: string, allowlist: readonly AllowEntry[] = ALLOWLIST): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const hits: Hit[] = [];
  let jitless = false;
  const add = (rule: RuleId, node: ts.Node) => hits.push({ rule, start: node.getStart(sf), end: node.getEnd() });
  const namespaces = hostNamespaces(sf);
  const inSrc = file.startsWith("src/");

  const checkModule = (node: ts.ImportDeclaration | ts.ExportDeclaration) => {
    const spec = node.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) return;
    const name = spec.text;
    if (name === "herdr") {
      const shapeOk = ts.isImportDeclaration(node) && isNamespaceOnlyImport(node);
      if (!shapeOk || (inSrc && file !== HOST_MODULE)) add("host-import", node);
    } else if (isZodSpecifier(name)) {
      if (file !== ZOD_MODULE) add("zod-import", node);
    } else if (!name.startsWith(".") && !MODULES.has(name)) {
      add("module-import", node);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const rule = IDENTIFIERS.get(node.text);
      if (rule) add(rule, node);
      if (namespaces.has(node.text)) checkHostUse(node, add);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) {
      if (!isModuleSpecifier(node)) for (const rule of stringRules(node.text)) add(rule, node);
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkModule(node);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-import", node);
      else if (isConstructorMember(node.expression) || isReflectConstruct(node.expression)) add("function-constructor", node);
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
