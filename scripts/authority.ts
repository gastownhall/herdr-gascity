// The authority lint.
//
// gc is the only authority over gc sessions, agents, rigs and beads: the mod
// changes them only through gc's HTTP API. So it must never run hc, tmux or
// bd, nor the herdr commands that end, park, pin or type into a terminal.
// And a herdr mod runs with the person's full rights and no permission
// prompt, so it must never compile code at run time: no eval, no `Function`
// identifier, no read of `.constructor` (the way to every Function-like
// constructor without naming it) except `.constructor.name`,
// `.constructor.prototype` and `===`/`!==` comparisons, no Reflect.construct,
// no dynamic import. zod is imported only
// through src/gc/zod.ts, which must turn on `jitless` (zod otherwise compiles
// parsers with `new Function`).
//
// The structure that makes the rest checkable:
// - only src/host.ts imports `herdr`, and only as `import * as herdr`;
// - the namespace is used only as `herdr.<export>`;
// - `herdr.run` and `herdr.exec` are called directly with a string literal
//   first argument from RUN_COMMANDS / EXEC_PROGRAMS; the calls that take
//   arguments a wrapper must check (tab.new, the platform opener, discovery's
//   gc call) are in ALLOWLIST instead, each matched by exact text that must
//   occur exactly once, so each can only be the wrapper's own call;
// - `herdr.notify` is called directly with an object literal: a toast's
//   `action` is a second way to run an app command (the toast runs
//   run(action.name, action.args) when clicked), so an action must be an
//   object literal whose `name` is a string literal from NOTIFY_ACTIONS;
// - modules other than gpui-kit, gpui-base, herdr, zod and relative paths are
//   not imported (the host's `process` module and global can spawn programs).
// String literals are also checked for hc/tmux/bd anywhere in a shell command
// and for the denied terminal commands, as defence in depth. A string that is
// only compared (an operand of ===, !==, == or !=, or a `case` label) is data
// read from gc, not a command (gc's `transport` value "tmux"), so the
// hc/tmux/bd word check skips it; every other use (an argument, an argv
// element, a variable, a template) is still checked.
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
  | "notify-action"
  | "exec-program"
  | "host-import"
  | "host-access"
  | "module-import"
  | "process"
  | "eval"
  | "function-constructor"
  | "constructor-read"
  | "dynamic-import"
  | "zod-import"
  | "zod-jitless"
  | "stale-allowlist"
  | "allowlist-not-unique";

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
 * `text`, matched exactly, and `text` occurs in the file exactly once. So an
 * entry pins one place: the same text a second time (an identical call added
 * elsewhere) allows nothing and is itself a violation. An entry that allows
 * nothing is a violation too, so a changed dependency cannot leave a stale
 * hole.
 */
export interface AllowEntry {
  file: string;
  rule: RuleId;
  text: string;
  reason: string;
}

/**
 * The one exec of a program not in EXEC_PROGRAMS: discovery asks gc for its
 * API URL with `<gcBin> supervisor status --json`. gcBin is a setting (desktop
 * apps often lack the shell PATH that holds gc), so it cannot be a literal.
 * The exact text pins the arguments and the timeout; src/host.ts refuses a
 * gcBin that does not name gc before spawning (settings.ts gcBinIssue).
 */
const GC_STATUS_CALL = 'herdr.exec(gcBin, ["supervisor", "status", "--json"], { timeout: GC_STATUS_TIMEOUT_MS })';
const GC_STATUS_REASON = "endpoint discovery runs `<gcBin> supervisor status --json` (fixed argv; gcBin is a setting checked to name gc)";

/**
 * zod's isPlainObject (zod v4 core/util.js), bundled: it reads `o.constructor`
 * only to compare it with undefined, check its type and read its
 * `.prototype`; it never calls it. The text runs to that last use, so a
 * changed check no longer matches.
 */
const ZOD_PLAIN_OBJECT = [
  "const ctor = o.constructor;",
  "  if (ctor === void 0)",
  "    return true;",
  '  if (typeof ctor !== "function")',
  "    return true;",
  "  const prot = ctor.prototype;",
].join("\n");

/**
 * The one tab.new: src/host.ts openAttachTab, which refuses any argv but an
 * attach argv (terminal/argv.ts attachArgvIssue) before this call.
 */
const TAB_NEW_CALL = 'herdr.run("tab.new", { space: tab.space, name, argv })';
const TAB_NEW_REASON = "open terminal's tab.new, in openAttachTab, after attachArgvIssue refused every argv but `env -u HC_* <gc> --city <path> session attach <id>`";

/**
 * The platform opener, in src/host.ts openUrl only, after openUrlIssue
 * refused everything but an http(s) URL on this computer (a file would be
 * opened by its default handler, and macOS runs a .command file).
 */
const OPEN_CALL = 'herdr.exec("open", [url], { timeout: OPEN_TIMEOUT_MS })';
const XDG_OPEN_CALL = 'herdr.exec("xdg-open", [url], { timeout: OPEN_TIMEOUT_MS })';
const OPEN_REASON = "openUrl runs the platform opener on one argument, after openUrlIssue refused all but an http(s) URL on this computer";

/** The allowlist for this repo. */
export const ALLOWLIST: readonly AllowEntry[] = [
  { file: "src/host.ts", rule: "exec-program", text: GC_STATUS_CALL, reason: GC_STATUS_REASON },
  { file: "gascity/main.js", rule: "exec-program", text: GC_STATUS_CALL, reason: GC_STATUS_REASON },
  { file: "src/host.ts", rule: "run-command", text: TAB_NEW_CALL, reason: TAB_NEW_REASON },
  { file: "gascity/main.js", rule: "run-command", text: TAB_NEW_CALL, reason: TAB_NEW_REASON },
  { file: "src/host.ts", rule: "exec-program", text: OPEN_CALL, reason: OPEN_REASON },
  { file: "src/host.ts", rule: "exec-program", text: XDG_OPEN_CALL, reason: OPEN_REASON },
  {
    file: "gascity/main.js",
    rule: "constructor-read",
    text: ZOD_PLAIN_OBJECT,
    reason: "zod's isPlainObject reads o.constructor only to compare it and read its prototype; it never calls it",
  },
];

/** The only module that may import herdr. */
export const HOST_MODULE = "src/host.ts";
/** The only module that may import zod. */
export const ZOD_MODULE = "src/gc/zod.ts";

/**
 * The herdr app commands the mod may run with any arguments: select a tab,
 * open the mod's overlay. (tab.new runs only from its wrapper: ALLOWLIST.)
 * Adding one is a deliberate, reviewed change to this list.
 */
export const RUN_COMMANDS: readonly string[] = ["tab.select", "mod.open"];

/**
 * The app commands a toast's action may run when clicked: open the mod's
 * "needs you" window. Adding one is a deliberate, reviewed change to this list.
 */
export const NOTIFY_ACTIONS: readonly string[] = ["mod.open"];

/**
 * The programs the mod may exec with any arguments: none. Every exec is a
 * wrapper's own call in ALLOWLIST (discovery's gc call, the platform opener).
 */
export const EXEC_PROGRAMS: readonly string[] = [];

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
  "notify-action": `herdr.notify takes an object literal; its action, if any, is an object literal whose name is a string literal from: ${NOTIFY_ACTIONS.join(", ")}`,
  "exec-program": `herdr.exec takes a string literal first argument from: ${EXEC_PROGRAMS.join(", ")}`,
  "host-import": `only ${HOST_MODULE} imports herdr, and only as \`import * as herdr from "herdr"\``,
  "host-access": "use the herdr namespace only as herdr.<export>, and call herdr.run/herdr.exec directly",
  "module-import": "import only gpui-kit, gpui-base, herdr, zod and relative modules",
  process: "process is forbidden: process.run spawns programs",
  eval: "eval is forbidden: the mod never compiles code at run time",
  "function-constructor": "the Function identifier and Reflect.construct are forbidden: the mod never compiles code at run time",
  "constructor-read":
    "reading .constructor is forbidden (it reaches Function and AsyncFunction without naming them), except "
    + ".constructor.name, .constructor.prototype or an ===/!== comparison: the mod never compiles code at run time",
  "dynamic-import": "dynamic import is forbidden: all code is bundled",
  "zod-import": `import zod only through ${ZOD_MODULE}, which turns on jitless first`,
  "zod-jitless": `${ZOD_MODULE} must call z.config({ jitless: true })`,
  "stale-allowlist": "allowlist entry matches nothing: remove or update it",
  "allowlist-not-unique": "allowlist entry text occurs more than once, so it pins no single place: it allows nothing",
};

interface Hit {
  rule: RuleId;
  start: number;
  end: number;
}

/** `compared`: the literal is only compared (isComparedOnly), so it is data, not a shell command. */
function stringRules(value: string, compared: boolean): RuleId[] {
  const out: RuleId[] = [];
  for (const word of compared ? [] : value.split(SHELL_SPLIT)) {
    const rule = PROGRAMS.get(word.slice(word.lastIndexOf("/") + 1).toLowerCase());
    if (rule && !out.includes(rule)) out.push(rule);
  }
  const exact = STRINGS.get(value);
  if (exact) out.push(exact);
  if (TERMINAL_COMMAND.test(value) || TERMINAL_PREFIX.test(value)) out.push("terminal-command");
  return out;
}

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Is this literal only compared: an operand of ===/!==/==/!=, or a `case` label? */
function isComparedOnly(node: ts.Node): boolean {
  let outer: ts.Node = node;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const p = outer.parent;
  if (ts.isBinaryExpression(p)) return EQUALITY.has(p.operatorToken.kind);
  return ts.isCaseClause(p) && p.expression === outer;
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

/** `x.constructor`, `x?.constructor` or `x["constructor"]`. */
function isConstructorMember(node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "constructor";
  return ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
    && node.argumentExpression.text === "constructor";
}

/** The uses of a `.constructor` read that cannot reach the constructor itself. */
const SAFE_CONSTRUCTOR_MEMBERS = new Set(["name", "prototype"]);
const COMPARISONS = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);

/** Is this `.constructor` read used only as `.name`, `.prototype`, or in an ===/!== comparison? */
function isSafeConstructorRead(node: ts.Expression): boolean {
  let outer: ts.Node = node;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const user = outer.parent;
  if (ts.isPropertyAccessExpression(user) && user.expression === outer) return SAFE_CONSTRUCTOR_MEMBERS.has(user.name.text);
  return ts.isBinaryExpression(user) && COMPARISONS.has(user.operatorToken.kind);
}

/** The property name a destructuring element or assignment-pattern property reads, if static. */
function patternPropertyName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

/** Is this object or array literal the target of a destructuring assignment (`({ a } = b)`, `for ({ a } of b)`)? */
function isAssignmentPattern(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p)) return p.left === node && p.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.initializer === node;
  if (ts.isArrayLiteralExpression(p)) return isAssignmentPattern(p);
  if (ts.isPropertyAssignment(p) && p.initializer === node) return isAssignmentPattern(p.parent);
  if (ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) return isAssignmentPattern(p.parent);
  return false;
}

/** Does this destructuring element take out `constructor` (`const { constructor: F } = f`, `({ constructor } = f)`)? */
function destructuresConstructor(node: ts.Node): boolean {
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    return patternPropertyName(node.propertyName ?? node.name) === "constructor";
  }
  if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent)) {
    return patternPropertyName(node.name) === "constructor" && isAssignmentPattern(node.parent);
  }
  return false;
}

/** A "constructor" string handed to a call (`Reflect.get(f, "constructor")`, `getOwnPropertyDescriptor(f, "constructor")`). */
function isConstructorKeyArgument(node: ts.Node): boolean {
  if (!ts.isStringLiteralLike(node) || node.text !== "constructor") return false;
  const p = node.parent;
  return !!p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.arguments ?? []).some((a) => a === node);
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

/** The static name of an object-literal member, or null (computed from a non-literal). */
function memberName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

/**
 * Checks a herdr.notify argument: an object literal with no spread and no
 * member whose name is computed; an `action` member is an object literal
 * whose only `name` is a string literal from NOTIFY_ACTIONS (and no spread).
 */
function checkNotifyArgument(arg: ts.Expression | undefined, call: ts.Node, add: (rule: RuleId, node: ts.Node) => void): void {
  const n = arg === undefined ? undefined : unparen(arg);
  if (!n || !ts.isObjectLiteralExpression(n)) {
    add("notify-action", arg ?? call);
    return;
  }
  for (const p of n.properties) {
    if (ts.isSpreadAssignment(p) || !p.name || memberName(p.name) === null) {
      add("notify-action", p);
      continue;
    }
    if (memberName(p.name) !== "action") continue;
    const value = ts.isPropertyAssignment(p) ? unparen(p.initializer) : undefined;
    if (!value || !ts.isObjectLiteralExpression(value)) {
      add("notify-action", p);
      continue;
    }
    const names = value.properties.filter((q) => ts.isSpreadAssignment(q) || !q.name || memberName(q.name) === null || memberName(q.name) === "name");
    const [only, ...more] = names;
    const literal = only && ts.isPropertyAssignment(only) && ts.isStringLiteralLike(only.initializer) ? only.initializer.text : null;
    if (more.length > 0 || literal === null || !NOTIFY_ACTIONS.includes(literal)) add("notify-action", value);
  }
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
  const rule: RuleId | undefined = member === "run" ? "run-command" : member === "exec" ? "exec-program" : member === "notify" ? "notify-action" : undefined;
  if (!rule) return;
  const user = parent.parent;
  if (ts.isTypeOfExpression(user)) return;
  if (!ts.isCallExpression(user) || user.expression !== parent) {
    add("host-access", parent);
    return;
  }
  if (rule === "notify-action") {
    checkNotifyArgument(user.arguments[0], user, add);
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
      if (!isModuleSpecifier(node)) for (const rule of stringRules(node.text, isComparedOnly(node))) add(rule, node);
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkModule(node);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-import", node);
      else if (isReflectConstruct(node.expression)) add("function-constructor", node);
    }
    if (isConstructorMember(node) && !isSafeConstructorRead(node)) add("constructor-read", node);
    if (destructuresConstructor(node) || isConstructorKeyArgument(node)) add("constructor-read", node);
    if (isJitlessConfig(node)) jitless = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const entries = allowlist.filter((e) => e.file === file);
  const occurrences = new Map(entries.map((e) => {
    const found: number[] = [];
    for (let at = text.indexOf(e.text); at >= 0; at = text.indexOf(e.text, at + 1)) found.push(at);
    return [e, found] as const;
  }));
  const used = new Set<AllowEntry>();
  const allowed = (hit: Hit) => entries.some((e) => {
    const found = occurrences.get(e) ?? [];
    if (e.rule !== hit.rule || found.length !== 1) return false;
    const at = found[0] as number;
    if (at <= hit.start && hit.end <= at + e.text.length) {
      used.add(e);
      return true;
    }
    return false;
  });

  const at = (pos: number, rule: RuleId, message = MESSAGES[rule]): Violation => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    return { file, line: line + 1, column: character + 1, rule, message };
  };
  const out = hits.filter((h) => !allowed(h)).map((h) => at(h.start, h.rule));
  if (file === ZOD_MODULE && !jitless) out.push(at(0, "zod-jitless"));
  for (const e of entries) {
    if ((occurrences.get(e)?.length ?? 0) > 1) out.push(at(0, "allowlist-not-unique", `${MESSAGES["allowlist-not-unique"]} (${e.rule}: ${e.reason})`));
    else if (!used.has(e)) out.push(at(0, "stale-allowlist", `${MESSAGES["stale-allowlist"]} (${e.rule}: ${e.reason})`));
  }
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
