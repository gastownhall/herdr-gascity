# herdr-gascity

Gas City inside the Herdr desktop app: a herdr-app mod that shows a city's rigs, agents and work and acts on them through gc's API.

**Status: scaffold, gc client, discovery, sync engine, agents panel, work
board, session and work actions, commands, keys and "needs you" toasts.** The mod finds the gc API, lists the cities, and
shows the copy's city: its connection state, its rigs, agents and sessions
with live status, pending prompts and active beads, a detail pane for one
session, and the work board (ready, in progress, recently closed) with a
detail pane for one bead. It acts on sessions, agents and rigs through gc's
API (start, wake, suspend, stop the turn, close, kill, pin, send input,
answer a prompt, suspend and resume agents and rigs) and on work (create a
bead and optionally sling it, sling, close and reopen a bead), and shows
every action's outcome. Every action can also be driven by a command
(`herdr-app do gascity.<command>`), and a toast tells you when a session
needs you, opening a "needs you" window on the session. Opening a terminal
comes next.

## Layout

| Path | What |
|---|---|
| `src/` | TypeScript source of the mod. `main.ts` is the `View`; `copy.ts` wires one copy to discovery and the shared sync registry; `host.ts` is the only module that touches herdr-app's host APIs; `host.schemas.ts` decodes the host data the mod reads; `probe.ts` writes the probe file; `view/` draws from a model and does no I/O. |
| `src/discovery/` | Finding gc and the copy's city: `resolve.ts` (endpoint resolution), `supervisorConfig.ts` (strict supervisor.toml reader), `gcStatus.ts`, `settings.ts` (machine-wide settings), `city.ts` (the per-copy city state machine), `controller.ts` (runs them). |
| `src/vm/` | Pure view-models: `header.ts` (connection chip, endpoint source, cities, banners, diagnostics), `agents.ts` (the rig/agent/session join), `board.ts` (the work board and bead detail), `status.ts` (the status chip), `detail.ts`, `region.ts` (data age and errors), `diagnostics.ts`, `probe.ts` (the probe document), `errorText.ts`, `sanitize.ts`. |
| `src/gc/` | The gc API client: `client.ts` (written against herdr's constrained `fetch`), `ops.ts` (one function per used operation), `errors.ts` (the `GcError` union and gc's problem+json mapping), `decode.ts` (decode policy), `zod.ts` (the only zod import; turns on `jitless`), and `*.gen.ts` generated from the pin. |
| `src/commands.ts`, `src/keys.ts` | The command grammar (strict; see below) and the key map of a focused copy. |
| `src/notify/` | "Needs you" toasts: `needsYou.ts` (one toast per new pending prompt, per app), `focus.ts` (the shared `gascity.focus` target), `window.ts` (the overlay window copy). |
| `src/actions/` | The person's actions: `session.ts`, `agent.ts`, `rig.ts`, `work.ts` (one gc API call each), `activity.ts` (what an action is and the states it goes through), `outcome.ts` (the ledger that sends them and follows their outcomes). |
| `src/sync/` | The sync engine: one shared store per gc city per app, its poll loop, the event watcher, the fetch budget, backoff, visibility and staleness (see below). |
| `api/` | `openapi.pinned.json`: gc's OpenAPI spec pruned to the used surface; `PIN`: the gascity commit and the sha256 of the full upstream file; `used-surface.json`: the operations and model fields the mod uses. |
| `types/` | The subset of herdr-app's `herdr` and `gpui-kit`/`gpui-base` host modules the source uses. |
| `compat/host-aliases.ts` | Maps the global names in `types/` onto the declarations herdr-app generates, for the types-drift check. |
| `gascity/` | The mod folder as herdr-app loads it: the built, committed, readable `main.js`, `mod.json` (with the "needs you" window's `overlay` spec), and `keys.json`, an optional key-map fragment. |
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
  the programs `xdg-open` and `open`. A toast's `action` is a second way to
  run an app command (herdr runs it when the toast is clicked), so
  `herdr.notify` is called directly with an object literal whose `action`,
  if any, is an object literal naming a string-literal command from its own
  allowlist: `mod.open`. The one exception, listed in the lint's
  `ALLOWLIST` by its exact text (which must occur exactly once), is discovery's
  `<gcBin> supervisor status --json` (fixed arguments; `src/host.ts` refuses a
  `gcBin` that does not name `gc` before spawning). The mod imports nothing but `gpui-kit`,
  `gpui-base`, `herdr`, zod and its own modules. It does not use the host's
  `process` (whose `run` spawns programs).
- **No code compiled at run time.** There is no `eval`, no `Function`
  identifier, no `Reflect.construct`, and no dynamic import. Every read of
  `.constructor` (the way to `Function`, `AsyncFunction` and their kin
  without naming them) is refused, whether called, aliased
  (`const F = f.constructor`), passed on (`Reflect.apply(f.constructor, …)`,
  `.call`, `.bind`), destructured (`const { constructor: F } = f`) or read by
  key (`Reflect.get(f, "constructor")`); only `.constructor.name`,
  `.constructor.prototype` and `===`/`!==` comparisons are allowed.
  **Known limit:** the lint reads syntax, so a key computed at run time gets
  past it (`const k = "constructor"; f[k](…)`, `globalThis["Func" + "tion"]`,
  scanning property descriptors, `Reflect.get` with a variable key). These are
  left to review and to the runtime check: the engine-parity probe runs the
  client, the sync engine and the action paths in QuickJS with `Function`,
  `eval` and every function prototype's `constructor` replaced by traps, and
  fails if any trap is hit.
  zod is imported only through `src/gc/zod.ts`, which must call
  `z.config({ jitless: true })`.
- **The bundle is the source.** `gascity/main.js` is unminified and must equal
  `bun run build` byte for byte, so a person or agent installing the mod can
  read what runs. Its header has a digest of the git-tracked build inputs, so
  `git add` a new source file before building.

`scripts/authority.ts` checks the first three rules over `src/**/*.ts` and
`gascity/**/*.js` with the TypeScript parser, so comments never count. String
literals are also scanned for `hc`/`tmux`/`bd` anywhere in a shell command
and for the denied terminal commands. A hit is allowed only inside exact text
listed in the lint's `ALLOWLIST`, and only when that text occurs exactly once
in the file, so an entry pins one place: an identical call added elsewhere
fails. An allowlist entry that matches nothing fails. The bundle's entries are
discovery's `gc supervisor status` call and zod's plain-object check, which
reads `o.constructor` only to compare it and read its prototype.

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
answers `GET /health` within 5 s of the request being sent wins (time spent
waiting in the fetch budget's queue does not count; a probe still queued
after 40 s is dropped, and a probe the mod cancelled is tried once more
before the candidate counts as unreachable):

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

With no endpoint, the copy rediscovers from its own 250 ms timer: 5 s after
the failure, then 10, 20, 40 and every 60 s ("retry now" does it at once). A
discovery that makes no progress for 90 s (herdr resumed it in another copy
that then closed, so its requests never settle) is started again. Closing a
copy cancels its discovery: its queued requests are dropped and nothing it
had started runs gc or sends a request afterwards.

## Drift jobs

Two scheduled workflows watch the two things the mod is built against. Each
fails its run when something the mod uses changed, and says exactly what in
the job summary; they need no secrets and only read.

- **gc drift** (`.github/workflows/gc-drift.yml`, nightly, or dispatched with
  any gascity branch, tag or commit): fetches gc's `internal/api/openapi.json`
  and compares it with the pin, restricted to the used surface
  (`scripts/used-surface-diff.ts`). A used operation, parameter or field that
  is gone, moved, newly required, or that gc may now omit or send with another
  type fails, as does a request gc would now refuse (a tighter length or range
  bound, a new pattern, format or const, fewer enum values) or a query
  parameter serialized differently (`style`/`explode`); additions the decoders absorb (a new enum value, a renamed model
  with the same fields) are listed as compatible. Locally:
  `scripts/fetch-gc-spec.sh main /tmp/gc.json` then
  `bun run scripts/used-surface-diff.ts --upstream /tmp/gc.json --upstream-commit <sha>`.
- **herdr-app types drift** (`.github/workflows/types-drift.yml`): hourly it
  reads herdr-app's `latest.json` and checks a release it has not checked yet,
  and fails at once while the current release's last check failed (so the
  status stays red); daily it checks the current release regardless. It installs the release the
  way the canary does (the per-release mirror), runs `herdr-app types`
  headless, and type-checks `src/` against the generated declarations with
  `compat/host-aliases.ts` in place of the subsets in `types/`. The summary
  shows the type errors and a diff of the host declarations `src/` uses
  against the last checked release. When a new file in `types/` declares host
  modules or globals, list it in `HOST_SUBSETS` in `scripts/types-drift.ts`
  (a test refuses unclassified files) and map any global type it declares in
  `compat/host-aliases.ts`.

GitHub disables scheduled workflows in a public repository after 60 days
without activity in it; a commit, or re-enabling the workflow in the Actions
tab, starts them again.

## The sync engine

herdr's `fetch` blocks a background-pool thread for the whole request, and
herdr's own work runs on that pool. So the engine never long-polls, and
copies share their gc traffic.

herdr also gives every async host operation (`fetch`, `cx.sleep`, timers)
to the copy whose code is running when it starts. Its completion runs in that
copy's scope, and when that copy closes the operation is cancelled: its
promise never settles. The engine is built around that rule:

- **One store per city per app, driven by every copy's own timer.**
  `src/sync/registry.ts` keeps one store per (gc API URL, city) in module
  scope, which every copy of the mod shares. Extra copies of the same city
  cause no extra requests. Each subscribed copy calls `tick()` every 250 ms
  from a timer it creates in its own init. A tick starts the store's next
  step only when one is due, so every step starts in a live copy's own turn.
  The engine itself owns no timer and never sleeps.
- **Closing a copy starts nothing.** `unsubscribe()` only abandons a step that
  copy started: its queued requests are dropped from the fetch budget (never
  sent), its late answers are ignored, and the next tick of any other copy
  starts a fresh step. Releasing the last store on an endpoint leaves the
  budget's degraded mode without starting anything. A step that makes no
  progress for 140 s is abandoned the same way and recorded.
- **The city list** (`cities.ts`): one `GET /v0/cities` poll per gc API per
  app, every 10 s while no copy shows a running city and every 60 s once one
  does, and at the next tick after a `city.*` event. It is driven by the
  copies' ticks like a city store.
- **Change signal = a short event poll.** `GET …/events?limit=50` without
  `index` returns at once. herdr's fetch hides response headers, so the
  cursor comes from the body: the newest `seq` the page shows. gc reads
  `total` after the page, so `total` may name an event the next poll will
  bring. A hole between the cursor and the oldest new event, or an
  unreadable entry that may be new, is a gap; a `total` below the cursor
  means gc's log was replaced. Both refetch every domain. If the first read
  is refused (a city not running yet, a read grant), it is retried at the
  60 s sweep, not in a loop.
- **Invalidation map** (`invalidate.ts`). Each event type marks the domains
  it can change: session events → sessions and agents; pending events →
  pending; bead events that can move a bead on the board → both bounded
  board columns, plus a fetch of each closed bead (at most 10 per step) for
  the closed list; city events → rigs and agents. Refetches are debounced
  300 ms and coalesced per domain.
- **Cadence** (`scheduler.ts`), as on screen / hidden:

  | Poll | On screen | Hidden |
  |---|---|---|
  | events | 2 s | 10 s |
  | sessions + pending | 5 s | 30 s |
  | detail peek | 2 s | paused |
  | sweep (everything) | 60 s | 60 s |

  The event poll keeps running while hidden, so app-wide listeners (toasts)
  still hear about prompts. `visibility.ts` decides whether a gascity view
  may be on screen. It applies per app, because a copy cannot tell which
  pane is itself.
- **Fetch budget** (`budget.ts`). At most 2 gascity requests are in flight
  per app, across all copies, cities and endpoints. While an endpoint is
  backing off, at most 1 request to it is in flight. Queued requests start in
  this order: mutation > events > snapshot > peek > sweep. A slot older than
  herdr's 30 s fetch timeout plus 5 s belongs to a fetch herdr cancelled with
  the copy that started it: it is reclaimed, and its caller gets a
  `cancelled` error, not a gc timeout. A cancelled read does not back off and
  is not held: it is simply still due. A cancelled mutation is
  outcome-unknown. Time spent queued never counts as a timeout. Discovery's
  `/health` and `/v0/cities` probes go through the same budget; a probe's 5 s
  race starts when it leaves the queue, and a probe that lost it stays counted
  in flight until herdr's fetch settles. Each copy's tick also reclaims, so a
  queued request starts in a live copy's turn even with no city subscribed.
- **Backoff** (`backoff.ts`, `endpoint.ts`). A transport failure, a 5xx, or
  an answer from off the loopback origin (a followed redirect) on a read
  backs the endpoint off: 1 s doubling to 60 s, with jitter. Until it
  recovers, only one probe goes out per retry time; a probe that never ends
  expires after 40 s. The first success resets it and refetches everything.
  Other read errors (4xx, decode) are shown and held until the next sweep or
  "retry now". Mutations are never retried; a mutation whose outcome is
  unknown is neither retried nor counted as gc answering.
- **Errors and staleness are state.** Each domain keeps its last good data,
  the error that followed it, and whether a refetch is wanted or held.
  `domainFreshness` says how old the data is and whether it is stale and why.
  Every failure, including a listener or log hook that throws and a step
  that crashes or stalls, goes to a bounded diagnostics ring in the snapshot
  and to the registry's `onError` hook.
- **Time is injected.** The clock is a parameter, and the tests run the
  engine under a fake of herdr's ownership rule (`test/unit/sync/fakes.ts`).
  The engine-parity probe also runs a scripted sync scenario in QuickJS.

## The agents panel

Each copy subscribes, from its own 250 ms timer, to the shared city list of
its gc API and, once a running city is chosen, to that city's store. It
renders from their snapshots only and never fetches while drawing. On close
it unsubscribes and starts nothing; the other copies keep updating.

- **Rows.** Rigs in gc's order (with gc's agent and running counts), then
  rigs that only an agent names, then the city's own agents. A session joins
  the agent its `agent_name` names, else its `template`; one that matches no
  agent is listed under "Other sessions", never dropped. Pool agents show
  their limits. The session list follows `next_cursor` in pages of 500 up to
  2 000 rows, and says "showing N of M" beyond that.
- **Status chip** (`vm/status.ts`), most specific first: a pending
  interaction (needs you, with its kind) > a lifecycle state other than
  active (suspended, asleep, …, with gc's reason) > `program_status` (state,
  kind, progress, app) > the transcript's activity, marked "(transcript)" >
  unknown. An absent `program_status` is unknown, never idle. An agent row
  shows its most urgent session, or its own state without one. A value this
  version does not know is shown raw and listed in the diagnostics.
- **Active bead.** Its title comes from the board's data, else from the bead
  fetched by id (at most 10 per step, again on an event about it, after an
  event gap, when gc comes back and on "retry now", but not at every sweep,
  whose cost would grow with the city); it is never guessed.
- **Detail pane.** Clicking a session opens it: gc's facts, the output (40
  lines, refreshed every 2 s while the pane is open and on screen), the wake
  reasons (fetched when it opens and on "retry now", because gc probes the
  runtime for each session), and the pending prompt with gc's own options.
- **Errors and staleness.** Each region says how old its data is; on a
  failure it keeps the last data, greyed, with the error above it. The header
  says connected, connecting, reconnecting in N s (with the cause), city
  stopped, gc too old, read-only, or herdr-app too old. gc's partial lists
  show `partial_errors`; an entry that cannot be read is an "unreadable"
  row. The diagnostics drawer lists the last 100 failures with their time and
  source.
- **Plain text only.** Every string gc supplies (names, statuses, titles,
  errors, problem details, prompts, output) is shown with escape sequences,
  control characters, bidirectional marks, Unicode tag characters and
  out-of-band line separators removed (`vm/sanitize.ts`), never as markdown
  or links. Lines written to herdr's log are cleaned the same way.
- **Probe.** While the shared value `gascity.probe` is `true`, the copy's
  tick writes `<app home>/data/gascity-probe/probe.json`
  (`gascity-herdr-probe/3`; `probe:on` / `probe:off` set it): connection, discovery, city, visibility,
  sessions with their status, the board (each column's cards, the closes
  seen in events with their seq and `close_reason`, the seed, the filter and
  the columns' errors), the selected bead, the session detail, actions with their state and
  request id, the exec/run log (with each toast and the command its action
  runs), whether the copy holds the keyboard and is the "needs you" window,
  the notice line, the commands it ran with their result, the refresh count,
  errors and the budget high-water mark. It serializes the same view-models the panel draws. Writes
  are herdr's compare-and-swap, at most one in flight, on change or every
  5 s. One copy owns the file (the first to write it, until it closes), so
  several copies do not take turns rewriting it. A document over herdr's
  1 MiB file limit is cut down by a fixed rule (the session output, pending
  prompt and bead description go first, then every list is halved until it
  fits) and says what it left out in `truncated`; the diagnostics record it.
  When the probe is turned off the file is emptied (herdr gives mods no way
  to delete a file), compare-and-swap like any write.

## The work board

The work board sits beside the agents panel and reads the same shared store;
it adds no polling of its own.

- **Ready** and **In progress** are gc's `/work/ready` lists (open, and
  `status=in_progress`), at most 50 each, in gc's own order (priority, then
  creation). gc's work list has no total, so a full column says "50+". Each
  card shows the id, priority, title, state in words ("in progress",
  "blocked" when gc says so), type, assignee, labels.
- **Recently closed** lists the closes the store saw in `bead.closed` events,
  newest close first (the event's seq: gc has no close time), with gc's
  `close_reason`. Below an "earlier (by creation time)" divider follows the
  one-time seed (`status=closed&sort=newest&limit=20`). gc's bead events
  carry the whole bead, so the list follows them: a close lists its bead
  (fetched by id only when the event's bead cannot be read, and listed only
  if gc says it is closed), and a later `bead.updated` or `bead.deleted`
  about a listed or seeded bead drops it unless it is still closed, whether
  or not the reopened bead shows on a Ready page. After a gap in the events
  every listed bead is fetched again. A bead is listed once, at its latest
  close; one back in Ready or In progress is never listed as closed. At most
  20 in all; when closes came faster than they could be fetched the list
  says it may be incomplete.
- **Infrastructure beads** (`session`, `message`, `molecule`, `gate`;
  `INFRASTRUCTURE_BEAD_TYPES` in `src/gc/ops.ts`) are hidden. gc filters the
  columns (`exclude_type`); the store keeps infrastructure closes out of the
  closed list (no fetch, no slot) and counts them; the chip says what is
  hidden and how many.
- **Bead detail.** Clicking a card opens its facts at once; the store then
  fetches the bead by id for its description (the columns carry none), and
  again on an event about it. Two copies showing the same bead fetch it once.
- **Errors and staleness** work as in the agents panel: each column says how
  old its data is (event-driven columns are confirmed by each good event
  poll), keeps stale cards greyed with the error above them, and lists
  entries gc sent that cannot be read; every bead string is plain text.

## Actions

Every action is one gc API call; the mod never runs `hc`, `tmux` or `bd`
and never ends or types into a terminal itself.

- **Where.** The detail pane: Wake, Suspend, Stop turn, Pin, Unpin, Close…,
  Kill… (with Force kill), a send box (Send, Interrupt and send when gc says
  the session supports it, Send as message), and one answer button per option
  gc lists for a pending prompt (gc's own words, sent back exactly as gc
  listed them). Each answer button carries the prompt's request id and the
  option it was drawn with; if gc's prompt has changed by the click, nothing
  is sent and the panel asks to review it. Each agent row: New session… (an optional alias) and Suspend
  agent… / Resume agent (rig-scoped agents use gc's own route). Each rig gc
  lists: Suspend rig… / Resume rig. The work board: + New bead (title,
  description, priority, labels, and optionally an agent to sling it to);
  on the open bead, Sling… (one button per agent gc lists) and Close… (with
  a reason), or Reopen for a closed bead. Actions marked `…` ask first:
  close, kill, agent suspend, rig suspend, sling and bead close say what gc
  will do and send nothing until confirmed. Sling's question says that gc
  cannot deduplicate a sling, so a retry after an unknown outcome may route
  the bead twice, and asks again on every retry.
- **A new bead slung to an agent** is two gc calls, each its own entry in
  the activity log: the create, then, once gc has created the bead, the
  sling of that bead. A create that fails, is unknown or is not sent slings
  nothing (its entry says the sling was not sent and why); a retry of the
  create that is done slings once. A sling that fails or is unknown after a
  successful create shows as such, and its retry resends only the sling:
  the bead is never created again.
- **What is refetched.** After each action (and before a retry of an
  unknown one) the mod refetches what it changes: a new bead → Ready; a
  sling → Ready, In progress and sessions; a bead close or reopen → Ready
  and In progress (the recently-closed list follows gc's bead events); an
  open bead's detail is fetched again after an action on it.
- **Headers.** Every mutation carries `X-GC-Request`. `Idempotency-Key` (a
  fresh UUID per action) goes only on the operations gc declares it on:
  session create, submit, messages, respond, wake, suspend, stop, close and
  kill, and bead create. gc declares none on pin/unpin, agent/rig actions,
  sling, and bead close/reopen.
- **Outcomes.** Each action shows in the activity log as pending, then done,
  failed, outcome unknown or not sent, with gc's answer or reason and its request id.
  A 202 (session create, submit, messages) is followed through gc's request
  outcome endpoint (`after_seq` = the 202's `event_cursor`) at 0.5 s, 1 s,
  2 s, then every 2 s; with no outcome after 120 s it is unknown. Submit and
  message outcomes say whether gc delivered or queued the input; a created
  session is named.
- **Never retried automatically.** A mutation whose connection was lost,
  whose 2xx answer could not be read, that was redirected, that gc answered
  with a server error (any 5xx but 501, e.g. 503 `write_unconfirmed`, which
  may have landed) or with 409 `idempotency-in-flight` (the same key is still
  running) is outcome unknown, not failed: the mod refetches what it changes
  and offers Retry only once a refetch that started after the outcome became
  unknown has arrived, so the person sees the current state first. A retry
  after an unknown outcome reuses the action's Idempotency-Key. gc keeps keys
  in memory for 30 minutes and forgets them on restart, so the button
  promises deduplication only within that; where gc declares no key the
  button says the action may happen twice. Only a definite refusal (a 4xx, or
  501) is failed, and its retry uses a new key, unless an earlier attempt of
  the same action ended unknown: from then on every retry keeps that key
  (a later refusal or an unsent retry does not prove the earlier attempt
  failed), and the log says so. A destructive action asks
  again on retry. An action already under way is not sent twice.
- **herdr ownership.** An action is sent in the turn of the copy whose
  button was clicked, and its outcome is polled from that copy's own timer.
  The activity log is the city's, shared by every copy. If that copy closes
  first: a request still queued in the fetch budget is dropped and shown as
  not sent; one in flight is outcome unknown at once (its late answer is
  ignored, nothing is resent); an accepted request's outcome is a read gc
  serves by request id, so a surviving copy's timer takes over polling it.
  Every step has a deadline, so an action never hangs as pending: a request
  still queued 70 s after it was asked for is dropped and shown as not sent,
  so it can never go out after being reported.

## Commands, keys and notifications

**Commands.** `herdr-app do gascity.<command>` and keys.json bindings
`"<key>": "gascity.<command>"` deliver a command to every Gas City copy on
screen (herdr delivers mod commands to shown copies only, and refuses one
with no shown copy). A command is a verb and its arguments separated by `:`;
each argument is percent-encoded (`encodeURIComponent`), so text may hold
`:` and `%`, e.g. `submit:sc-20:close%20fe-1%3A%20done`.

- **Same path as the buttons.** Each command calls the same copy method its
  button calls, so it sends the same gc request and leaves the same entry in
  the activity log (the tests compare them pairwise).
- **Explicit ids.** Commands name what they act on by gc's id (a session also
  by its exact alias or session name, refused when more than one session has
  it), never by "the current selection". An agent, rig or city must be one gc
  lists; a bead must be on the board or known to gc.
- **Confirmation.** A command whose button asks first (close, kill, force
  kill, agent and rig suspend, sling, bead close) takes an explicit trailing
  `confirm`. Without it, the command opens the same question its button
  opens and sends nothing (a person can still answer it; `cancel` closes it);
  with it, the command also answers the question as clicking its button
  would. `confirm` is told apart by position only, so text arguments never
  turn into a confirmation.
- **Strict.** An unknown verb, a wrong number of arguments, an empty id, a
  bad percent escape or a `confirm` where none fits is refused; so is a
  command the copy cannot carry out (an unknown or ambiguous id, a list not
  loaded yet, an action already under way). A refusal changes nothing and is
  shown, cleaned, in the panel's notice line; the probe lists each command
  with `done`, `asked` or `refused` and why.

| Command | What it does (the button it stands for) |
|---|---|
| `focus[:<city>:<session>]` | bare: take the keyboard; with a city and a session: select the city and open the session's detail |
| `city:<city>` | select a city (as the header's city list does) |
| `session:<session>` | open a session's detail (as clicking its row does) |
| `bead:<bead>` | open a bead's detail (as clicking its card does) |
| `refresh` | refetch everything now (Retry now; the r key) |
| `probe:<on-or-off>` | turn the probe file on or off (shared for every copy) |
| `cancel` | close the open question or form without acting (Cancel) |
| `session-new:<agent>[:<alias>]` | start a session of an agent, with an optional alias (New session…, then Start session) |
| `wake:<session>` | wake a session (Wake) |
| `suspend:<session>` | suspend a session (Suspend) |
| `stop:<session>` | stop a session's current turn (Stop turn) |
| `pin:<session>` | pin a session awake (Pin) |
| `unpin:<session>` | clear a session's pin (Unpin) |
| `close:<session>[:confirm]` | close a session (Close…, then Close) |
| `kill:<session>[:confirm]` | kill a session's runtime (Kill…, then Kill) |
| `kill-force:<session>[:confirm]` | force-kill a session's runtime (Kill…, then Force kill) |
| `submit:<session>:<text>` | send input to a session (Send) |
| `interrupt:<session>:<text>` | interrupt the turn and send input (Interrupt and send) |
| `message:<session>:<text>` | send a queued message to a session (Send as message) |
| `answer:<session>:<request>:<option>` | answer a session's pending prompt with one of gc's options (its answer button); the session's detail must show that prompt |
| `agent-suspend:<agent>[:confirm]` | suspend an agent (Suspend agent…, then Suspend agent) |
| `agent-resume:<agent>` | resume an agent (Resume agent) |
| `rig-suspend:<rig>[:confirm]` | suspend a rig (Suspend rig…, then Suspend rig) |
| `rig-resume:<rig>` | resume a rig (Resume rig) |
| `bead-new:<title>[:<agent>]` | create a bead, and sling it to an agent if one is given (+ New bead, then Create / Create and sling) |
| `sling:<bead>:<agent>[:confirm]` | sling a bead to an agent (Sling…, then the agent) |
| `bead-close:<bead>:<reason>[:confirm]` | close a bead with a reason, which may be empty (Close…, then Close bead) |
| `bead-reopen:<bead>` | reopen a closed bead (Reopen) |

**Keys.** `mod.json` is `focusable`: `pane.go` onto a Gas City pane hands it
the keyboard and sends the bare `focus` command, and the copy focuses its
root. Then `j`/`down` and `k`/`up` open the next or previous session (as
clicking its row), `r` is Retry now, and `escape` closes the open question
or form, else the session's detail. The probe's `keyboard` says whether the
copy holds the keyboard. `gascity/keys.json` is an optional fragment for
herdr's keys.json, `{"global": {"ctrl-alt-g": "mod.open:gascity"}}`: an app
command, so it works while every Gas City copy is hidden.

**"Needs you" toasts.** When a city's pending list (gc's `/pending`, in the
shared store) gains a prompt, the mod posts one toast, "<session> needs you",
naming its kind, session and city. The store is shared, so several copies of
a city post each toast once. Every (session, request id) pair seen is
remembered, so a refetch, a resync after missed events or a reconnect after
an outage posts nothing again; what was already pending when the city was
opened is the baseline, shown by the header's "N need you" rather than
toasted; a session gets at most one toast per 30 s.

Clicking a toast must bring Gas City on screen, and a command cannot reach a
hidden copy. So before posting, the mod writes the session to the shared
value `gascity.focus` (`{city, session, seq, at}`, `seq` growing), and the
toast's action is the app command `mod.open {name: "gascity"}`, which opens
the **"needs you" window**: a copy herdr opens from `mod.json`'s `overlay`
spec. That copy marks `gascity.window` true while it is open, applies the
newest target written in the last 10 minutes on its next tick (selects the
city, then opens the session: its pending prompt with gc's options, the send
box, its actions), and lists the city's other sessions that need you, a
"Show Gas City tab" button per tab holding a Gas City pane (`tab.select`)
and Close. `mod.open` toggles, so while the window is open toasts carry no
action; the open window follows each newer target by itself. Commands reach
the window like any shown copy.

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
