# herdr-gascity

Gas City inside the Herdr desktop app: a herdr-app mod that shows a city's rigs, agents and work and acts on them through gc's API.

**Status: scaffold, gc client, discovery.** The mod finds the gc API, lists
the cities and shows the copy's city with its connection state in the header.
Live data (the sync engine) and the agents and work panels come next.

## Layout

| Path | What |
|---|---|
| `src/` | TypeScript source of the mod. `main.ts` is the `View`; `host.ts` is the only module that touches herdr-app's host APIs; `host.schemas.ts` decodes the host data the mod reads; `view/` draws from a model and does no I/O. |
| `src/discovery/` | Finding gc and the copy's city: `resolve.ts` (endpoint resolution), `supervisorConfig.ts` (strict supervisor.toml reader), `gcStatus.ts`, `settings.ts` (machine-wide settings), `city.ts` (the per-copy city state machine), `controller.ts` (runs them). |
| `src/vm/` | Pure view-models: `header.ts` (connection chip, endpoint source, cities, banners, diagnostics), `errorText.ts`. |
| `src/gc/` | The gc API client: `client.ts` (written against herdr's constrained `fetch`), `ops.ts` (one function per used operation), `errors.ts` (the `GcError` union and gc's problem+json mapping), `decode.ts` (decode policy), `zod.ts` (the only zod import; turns on `jitless`), and `*.gen.ts` generated from the pin. |
| `api/` | `openapi.pinned.json`: gc's OpenAPI spec pruned to the used surface; `PIN`: the gascity commit and the sha256 of the full upstream file; `used-surface.json`: the operations and model fields the mod uses. |
| `types/` | The subset of herdr-app's `herdr` and `gpui-kit`/`gpui-base` host modules the source uses. |
| `compat/host-aliases.ts` | Maps the global names in `types/` onto the declarations herdr-app generates, for the types-drift check. |
| `gascity/` | The mod folder as herdr-app loads it: the built, committed, readable `main.js` and `mod.json`. |
| `build.ts` | esbuild bundle of `src/` into `gascity/main.js`. Deterministic; the header names the version and a sha256 digest of the build inputs. |
| `scripts/authority.ts` | The authority lint (see below). |
| `scripts/bundle-fresh.ts` | Fails when the committed `gascity/main.js` differs from a clean rebuild. |
| `scripts/used-surface-diff.ts`, `scripts/types-drift.ts` | The drift checks (see below). |
| `test/harness.ts` | Loads the built bundle under bun with fake `herdr`/`gpui-kit` modules and a Proxy element recorder, after herdr-app's own mod tests. |
| `test/unit/` | Unit and render tests. |
| `test/contract/` | Responses recorded from a scratch city at the pinned gc (`record.ts`), validated with ajv against the pin and decoded by the client. |
| `test/engine/` | Engine parity: the client bundled like the mod, run in QuickJS (quickjs-ng, wasm) with `Function`/`eval` trapped, compared with bun. |

## Rules the build enforces

- **gc is the only authority.** Every change to a gc session, agent, rig or
  bead is a gc API call. The mod never runs `hc`, `tmux` or `bd`, and never
  names a herdr command that ends, re-homes, pins or types into a terminal
  (`terminal.kill`, `keep`, `park`, `pin`, `right_click`, `paste`,
  `paste_image`, and hc's `send`/`keys`/`label`).
- **One door to the host.** Only `src/host.ts` imports `herdr`, and only as
  `import * as herdr`. The namespace is used only as `herdr.<export>`.
  `herdr.run` and `herdr.exec` are called directly with a string-literal first
  argument from an allowlist: `tab.new`, `tab.select` and `mod.open`, and
  the programs `xdg-open` and `open`. The one exception, listed in the lint's
  `ALLOWLIST` by its exact text, is discovery's
  `<gcBin> supervisor status --json` (fixed arguments; `src/host.ts` refuses a
  `gcBin` that does not name `gc` before spawning). The mod imports nothing but `gpui-kit`,
  `gpui-base`, `herdr`, zod and its own modules. It does not use the host's
  `process` (whose `run` spawns programs).
- **No code compiled at run time.** There is no `eval`, no `Function`
  constructor in any spelling (including `x.constructor(...)` and
  `Reflect.construct`), and no dynamic import. zod is imported only through
  `src/gc/zod.ts`, which must call `z.config({ jitless: true })`.
- **The bundle is the source.** `gascity/main.js` is unminified and must equal
  `bun run build` byte for byte, so a person or agent installing the mod can
  read what runs. Its header has a digest of the git-tracked build inputs, so
  `git add` a new source file before building.

`scripts/authority.ts` checks the first three rules over `src/**/*.ts` and
`gascity/**/*.js` with the TypeScript parser, so comments never count. String
literals are also scanned for `hc`/`tmux`/`bd` anywhere in a shell command
and for the denied terminal commands. A hit is allowed only inside exact text
listed in the lint's `ALLOWLIST`. An allowlist entry that matches nothing
fails.

## The gc client

- **Pinned spec.** `api/openapi.pinned.json` is gc's `internal/api/openapi.json`
  at the commit in `api/PIN`, pruned to the operations in
  `api/used-surface.json` and the components they reach.
- **Generated types and schemas.** `bun run gen:gc` writes `src/gc/*.gen.ts`
  for the listed model fields only. A field or model that drifts from the pin
  fails generation; a test keeps the committed files fresh.
- **Decode policy.** Extra fields are ignored; a missing required field or a
  wrong type is a `decode` error with the operation, JSON path and issues; an
  unknown enum value decodes to `{kind: "unrecognized", raw}`; gc's
  `["array","null"]` decodes `null` (and, when optional, absent) to `[]`,
  except fields listed under `keepAbsent` such as `wake_reasons`, where absent
  means "not asked for"; list elements decode one by one,
  so a bad element is reported as `unreadable` instead of failing the list.
- **herdr's fetch.** Whole body, no response headers, a fixed 30 s timeout and
  an 8 MiB cap. Rejections become `unreachable`, `timeout` or `too-large`. An
  answer from any origin other than the configured loopback one (herdr follows
  redirects) is refused. A mutation whose transport fails, whose 2xx answer
  does not decode, or that was redirected is `outcome-unknown`, never a plain
  error a person could simply retry. Nothing is retried;
  mutations carry `X-GC-Request: herdr-gascity/<version>`, and
  `Idempotency-Key` only where gc declares it. Loopback API URLs only.
- **Re-pinning.**
  `git -C <gascity> show <commit>:internal/api/openapi.json > openapi-upstream.json`,
  `bun run pin:gc --spec openapi-upstream.json --commit <sha> --committed <iso date>`,
  `bun run gen:gc`, then re-record the fixtures against a throwaway city started
  from that gc build (`bun run record:gc --throwaway-city …`; see the header of
  `test/contract/record.ts`).

## Discovery

Each copy of the mod finds gc's API on this machine. Candidates, first that
answers `GET /health` within 5 s wins:

1. the `apiUrl` setting;
2. the URL gc reports in `gc supervisor status --json` (`api_url`), when gc
   prints one;
3. `[supervisor]` `bind`/`port` in `~/.gc/supervisor.toml` (`0.0.0.0` and `::`
   dial loopback, as gc does). The reader is strict: anything in those keys it
   cannot read for sure is shown with its line, and resolution stops there;
4. `http://127.0.0.1:8372`.

Only loopback URLs (`127.0.0.1`, `localhost`, `[::1]`, with a port) are used;
any other is refused, not probed. The header names the URL, gc's version and
where the URL came from; the diagnostics list every candidate and its outcome.
A gc home other than `~/.gc` needs the `apiUrl` setting (a mod cannot read
environment variables).

Settings are machine-wide, in herdr's shared store under `gascity.settings`:
`apiUrl` and `gcBin` (`gc`, or the absolute path to it). A copy opened with
`props: {city: "<name>"}` shows only that city. A copy opened without props
shows its last choice (kept in that copy's localStorage), else the only
running city, else asks. City states: discovering, no endpoint, cities failed,
choose a city, unknown city, running, stopped; a running city also shows
read-only and "gc too old" notices from gc's answers.

## Drift jobs

Two scheduled workflows watch the two things the mod is built against. Each
fails its run when something the mod uses changed, and says exactly what in
the job summary; they need no secrets and only read.

- **gc drift** (`.github/workflows/gc-drift.yml`, nightly, or dispatched with
  any gascity branch, tag or commit): fetches gc's `internal/api/openapi.json`
  and compares it with the pin, restricted to the used surface
  (`scripts/used-surface-diff.ts`). A used operation, parameter or field that
  is gone, moved, newly required, or that gc may now omit or send with another
  type fails; additions the decoders absorb (a new enum value, a renamed model
  with the same fields) are listed as compatible. Locally:
  `scripts/fetch-gc-spec.sh main /tmp/gc.json` then
  `bun run scripts/used-surface-diff.ts --upstream /tmp/gc.json --upstream-commit <sha>`.
- **herdr-app types drift** (`.github/workflows/types-drift.yml`): hourly it
  reads herdr-app's `latest.json` and checks a release it has not checked yet;
  daily it checks the current release regardless. It installs the release the
  way the canary does (the per-release mirror), runs `herdr-app types`
  headless, and type-checks `src/` against the generated declarations with
  `compat/host-aliases.ts` in place of the subsets in `types/`. The summary
  shows the type errors and a diff of the host declarations `src/` uses
  against the last checked release. When a new file in `types/` declares host
  modules or globals, list it in `HOST_SUBSETS` in `scripts/types-drift.ts`
  (a test refuses unclassified files) and map any global type it declares in
  `compat/host-aliases.ts`.

## Develop

Needs [bun](https://bun.sh) (version in `.bun-version`).

```sh
bun install --frozen-lockfile
bun run build           # rebuild gascity/main.js; commit it with the source change
bun test                # unit + render tests (no GPU, no display, no herdr-app)
bun run typecheck       # src/ against the QuickJS host types; tools against bun's
bun run lint:authority  # or: bun run scripts/authority.ts <file-or-dir>
bun run check:bundle    # or: bun run scripts/bundle-fresh.ts --bundle <path>
bun run ci              # all of the above, as CI runs them
bun run gen:gc          # regenerate src/gc/*.gen.ts from api/
bun run notices         # regenerate gascity/THIRD_PARTY_NOTICES.md
```

## License

MIT, see `LICENSE`. Bundled third-party licenses: `gascity/THIRD_PARTY_NOTICES.md`.
