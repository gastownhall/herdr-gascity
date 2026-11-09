# herdr-gascity

Gas City inside the Herdr desktop app: a herdr-app mod that shows a city's rigs, agents and work and acts on them through gc's API.

**Status: scaffold.** The mod loads and draws a placeholder panel. It does not
connect to gc yet; the gc API client comes next.

## Layout

| Path | What |
|---|---|
| `src/` | TypeScript source of the mod. `main.ts` is the `View`; `host.ts` is the only module that touches herdr-app's host APIs; `view/` draws from a model and does no I/O. |
| `types/` | The subset of herdr-app's `herdr` and `gpui-kit`/`gpui-base` host modules the source uses. |
| `gascity/` | The mod folder as herdr-app loads it: the built, committed, readable `main.js` and `mod.json`. |
| `build.ts` | esbuild bundle of `src/` into `gascity/main.js`. Deterministic; the header names the version and a sha256 digest of the build inputs. |
| `scripts/authority.ts` | The authority lint (see below). |
| `scripts/bundle-fresh.ts` | Fails when the committed `gascity/main.js` differs from a clean rebuild. |
| `test/harness.ts` | Loads the built bundle under bun with fake `herdr`/`gpui-kit` modules and a Proxy element recorder, after herdr-app's own mod tests. |
| `test/unit/` | Unit and render tests. |

## Rules the build enforces

- **gc is the only authority.** The mod never calls `hc`, `tmux` or `bd`, nor
  herdr's `terminal.kill`/`send`/`keys`/`label`/`keep`. Every change to a gc
  session, agent, rig or bead is a gc API call.
- **No code compiled at run time.** No `eval`, no `Function` constructor, no
  dynamic import. zod is imported only through `src/gc/zod.ts`, which must
  call `z.config({ jitless: true })`.
- **The bundle is the source.** `gascity/main.js` is unminified and must equal
  `bun run build` byte for byte, so a person or agent installing the mod can
  read what runs.

`scripts/authority.ts` checks the first two over `src/**/*.ts` and
`gascity/**/*.js` with the TypeScript parser (comments never count). A hit is
allowed only inside exact text listed in its `ALLOWLIST`, and an allowlist
entry that matches nothing fails.

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
```

## License

MIT, see `LICENSE`.
