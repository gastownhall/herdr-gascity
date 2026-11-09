// The herdr-app types-drift check: the mod's sources compiled against the
// declarations a release generates, and the host surface they use diffed
// between releases. Fixtures: test/fixtures/types-drift/host/gpui-kit.d.ts (a
// small stand-in for the generated file) and a small mod source.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { ROOT } from "../../scripts/gc-spec.ts";
import {
  GENERATED_FILE, HOST_ALIASES, HOST_SUBSETS, KEPT_TYPES, checkAgainstHost, diffSurface, formatTypesReport, repoInput,
  type HostCheck,
} from "../../scripts/types-drift.ts";

const FIXTURES = join(ROOT, "test/fixtures/types-drift");
const HOST = await readFile(join(FIXTURES, "host", GENERATED_FILE), "utf8");
const repo = repoInput();

/** Checks the fixture source against host declarations with `text` as the generated file. */
async function checkWith(text: string): Promise<HostCheck> {
  const dir = await mkdtemp(join(tmpdir(), "types-drift-"));
  await writeFile(join(dir, GENERATED_FILE), text);
  return checkAgainstHost({ ...repo, sources: [join(FIXTURES, "src/main.ts")], declarations: [join(dir, GENERATED_FILE)] });
}

/** The fixture host with one exact piece of text replaced. */
function edited(from: string, to: string): string {
  if (!HOST.includes(from)) throw new Error(`fixture has no ${JSON.stringify(from)}`);
  return HOST.replace(from, to);
}

const current = await checkWith(HOST);

test("the fixture source type-checks against the fixture host", () => {
  expect(current.diagnostics).toEqual([]);
});

test("the surface lists every host declaration the source uses, through imports, aliases and overrides", () => {
  expect(current.surface).toEqual({
    '"gpui-base".v_flex': "() => NativeElement",
    '"gpui-kit".AsyncContext': "interface extends Context",
    '"gpui-kit".Color': "type = `#${string}`",
    '"gpui-kit".Context': "interface",
    '"gpui-kit".NativeElement': "interface",
    '"gpui-kit".NativeElement.bg': "(value: `#${string}`) => NativeElement",
    '"gpui-kit".NativeElement.child': "(child: string | NativeElement) => NativeElement",
    '"gpui-kit".NativeElement.id': "(name: string) => NativeElement",
    '"gpui-kit".NativeElement.p': "(value: DefiniteLength) => NativeElement",
    '"gpui-kit".View': "class",
    '"gpui-kit".View.init': "?(props: Props | undefined, cx: AsyncContext) => void",
    '"gpui-kit".View.render': "(cx: Context) => string | NativeElement",
    '"gpui-kit".div': "() => NativeElement",
    '"gpui-shell".Props': "type = { [x: string]: any; }",
    '"herdr"': "module",
    '"herdr".theme': "() => Record<string, string>",
  });
});

describe("a release that drops or changes a declaration the source uses", () => {
  test("a removed herdr member fails with the error and shows as removed", async () => {
    const next = await checkWith(edited("export function theme(): Record<string, string>;", ""));
    expect(next.diagnostics.join("\n")).toContain("Property 'theme' does not exist");
    expect(next.diagnostics.join("\n")).toContain("test/fixtures/types-drift/src/main.ts");
    expect(diffSurface(current.surface, next.surface).removed).toEqual([['"herdr".theme', "() => Record<string, string>"]]);
  });

  test("a renamed type the aliases map onto fails in compat/host-aliases.ts", async () => {
    const next = await checkWith(HOST.replaceAll("NativeElement", "Element"));
    expect(next.diagnostics.join("\n")).toContain(`${HOST_ALIASES}`);
    expect(next.diagnostics.join("\n")).toContain("has no exported member 'NativeElement'");
  });

  test("a changed signature fails and shows before and after", async () => {
    const next = await checkWith(edited("p(value: DefiniteLength): NativeElement;", "p(value: string): NativeElement;"));
    expect(next.diagnostics.join("\n")).toContain("Argument of type 'number' is not assignable to parameter of type 'string'");
    expect(diffSurface(current.surface, next.surface).changed).toEqual([
      ['"gpui-kit".NativeElement.p', "(value: DefiniteLength) => NativeElement", "(value: string) => NativeElement"],
    ]);
  });

  test("the report says it fails, shows the diff and the errors", async () => {
    const next = await checkWith(edited("export function theme(): Record<string, string>;", ""));
    const report = formatTypesReport({ version: "0.2.0", check: next, previous: { version: "0.1.14", check: current } });
    expect(report).toContain("**src/ does not type-check against the declarations herdr-app 0.2.0 generates: 1 error.**");
    expect(report).toContain('What changed since herdr-app 0.1.14 in the host declarations src/ uses:\n\n```diff\n- "herdr".theme: () => Record<string, string>\n```');
    expect(report).toContain("Property 'theme' does not exist");
  });
});

describe("a release whose changes the source does not feel", () => {
  test("a widened parameter type-checks and shows as changed", async () => {
    const next = await checkWith(edited("id(name: string): NativeElement;", "id(name: string | number): NativeElement;"));
    expect(next.diagnostics).toEqual([]);
    const diff = diffSurface(current.surface, next.surface);
    expect(diff.changed.map(([name]) => name)).toEqual(['"gpui-kit".NativeElement.id']);
    expect(formatTypesReport({ version: "0.2.0", check: next, previous: { version: "0.1.14", check: current } }))
      .toContain("src/ type-checks against the declarations herdr-app 0.2.0 generates.");
  });

  test("declarations the source does not use are not in the surface", async () => {
    const next = await checkWith(edited("export function home(): string;", "export function machines(): string[];"));
    expect(next.diagnostics).toEqual([]);
    expect(diffSurface(current.surface, next.surface)).toEqual({ removed: [], changed: [], added: [] });
  });

  test("the same release reports no change", () => {
    expect(formatTypesReport({ version: "0.1.14", check: current, previous: { version: "0.1.14", check: current } }))
      .toContain("The host declarations src/ uses are unchanged since herdr-app 0.1.14.");
  });
});

describe("the repo's types/ files and aliases", () => {
  test("every declaration file tsconfig.json includes is classified", () => {
    expect(repo.sources.length).toBeGreaterThan(0);
    expect(repo.sources.every((f) => f.startsWith(join(ROOT, "src")))).toBe(true);
  });

  test("an unclassified file in types/ is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "types-drift-root-"));
    await mkdir(join(root, "types"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "tsconfig.json"), await readFile(join(ROOT, "tsconfig.json"), "utf8"));
    await writeFile(join(root, "src/main.ts"), "export {};\n");
    for (const f of [...HOST_SUBSETS, ...KEPT_TYPES, "types/new-host-globals.d.ts"]) await writeFile(join(root, f), "export {};\n");
    expect(() => repoInput(root)).toThrow("classify types/new-host-globals.d.ts in scripts/types-drift.ts");
  });

  test("compat/host-aliases.ts maps every global type name the subsets declare", async () => {
    const globalTypes = async (file: string): Promise<string[]> => {
      const source = ts.createSourceFile(file, await readFile(join(ROOT, file), "utf8"), ts.ScriptTarget.ES2022);
      return source.statements
        .filter((s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s))
        .map((s) => s.name.text);
    };
    const declared = (await Promise.all(HOST_SUBSETS.map(globalTypes))).flat().sort();
    expect(declared.length).toBeGreaterThan(0);
    expect((await globalTypes(HOST_ALIASES)).sort()).toEqual(declared);
  });
});
