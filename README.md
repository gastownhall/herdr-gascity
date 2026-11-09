# herdr-gascity

Gas City inside the Herdr desktop app: a herdr-app mod that shows a city's rigs, agents and work and acts on them through gc's API.

**Status: scaffold + gc client.** The mod loads and draws a placeholder panel.
The typed gc API client (`src/gc/`) is built and contract-tested but not wired
into the panel yet; discovery and the sync engine come next.

## Layout

| Path | What |
|---|---|
| `src/` | TypeScript source of the mod. `main.ts` is the `View`; `host.ts` is the only module that touches herdr-app's host APIs; `host.schemas.ts` decodes the host data the mod reads; `view/` draws from a model and does no I/O. |
| `src/gc/` | The gc API client: `client.ts` (written against herdr's constrained `fetch`), `ops.ts` (one function per used operation), `errors.ts` (the `GcError` union and gc's problem+json mapping), `decode.ts` (decode policy), `zod.ts` (the only zod import; turns on `jitless`), and `*.gen.ts` generated from the pin. |
| `api/` | `openapi.pinned.json`: gc's OpenAPI spec pruned to the used surface; `PIN`: the gascity commit and the sha256 of the full upstream file; `used-surface.json`: the operations and model fields the mod uses. |
| `types/` | The subset of herdr-app's `herdr` and `gpui-kit`/`gpui-base` host modules the source uses. |
| `gascity/` | The mod folder as herdr-app loads it: the built, committed, readable `main.js` and `mod.json`. |
| `build.ts` | esbuild bundle of `src/` into `gascity/main.js`. Deterministic; the header names the version and a sha256 digest of the build inputs. |
| `scripts/authority.ts` | The authority lint (see below). |
| `scripts/bundle-fresh.ts` | Fails when the committed `gascity/main.js` differs from a clean rebuild. |
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
  the programs `xdg-open` and `open`. The mod imports nothing but `gpui-kit`,
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
  `["array","null"]` decodes `null` to `[]`; list elements decode one by one,
  so a bad element is reported as `unreadable` instead of failing the list.
- **herdr's fetch.** Whole body, no response headers, a fixed 30 s timeout and
  an 8 MiB cap. Rejections become `unreachable`, `timeout` or `too-large`; a
  mutation whose transport fails is `outcome-unknown`. Nothing is retried;
  mutations carry `X-GC-Request: herdr-gascity/<version>`, and
  `Idempotency-Key` only where gc declares it. Loopback API URLs only.
- **Re-pinning.**
  `git -C <gascity> show <commit>:internal/api/openapi.json > /tmp/openapi.json`,
  `bun run pin:gc --spec /tmp/openapi.json --commit <sha> --committed <iso date>`,
  `bun run gen:gc`, then re-record the fixtures against a throwaway city started
  from that gc build (`bun run record:gc --throwaway-city …`; see the header of
  `test/contract/record.ts`).

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
