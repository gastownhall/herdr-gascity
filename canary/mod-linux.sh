#!/usr/bin/env bash
# The mod in the released Herdr app against a scratch gc city: gc built from
# the pinned commit runs the city, the app runs headless (bootstrap-linux.sh),
# and the packaged mod is checked and installed by install.sh. The real-app
# smoke (smoke.yml) and the preview (preview.yml) both run it. Run after
# bootstrap-linux.sh's preflight, resolve, mirror and install stages; the
# install, connected and shot stages also after its display and app stages.
#
#   mod-linux.sh gc           build gc from $GASCITY_SRC into $CANARY_ROOT/gc/gc
#   mod-linux.sh city         a scratch city (file beads, subprocess sessions, no orders,
#                             one rig, two agents) with a few beads, from this
#                             shell: never from a herdr terminal
#   mod-linux.sh package [--broken]
#                             `bun run package` into $CANARY_ROOT/dist (MOD_TARBALL);
#                             --broken puts a syntax error into the packaged
#                             main.js (the smoke's negative case)
#   mod-linux.sh check        `herdr-app check` on the packaged mod, as install.sh
#                             unpacks it, with no display
#   mod-linux.sh install      install.sh --from the package, the app open; the
#                             installer must open the mod's tab and set gcBin
#   mod-linux.sh connected    gascity.probe:on; the probe must show the mod
#                             connected to the city, its sessions listed
#   mod-linux.sh shot [file]  wait until the mod shows the whole board, then
#                             `herdr-app shot` into out/<file> (preview.png);
#                             `herdr-app status` must report no errors
#   mod-linux.sh teardown     stop the supervisor the city stage recorded, only that
#
# The city stage puts a city into GC_HOME (default ~/.gc) and gc's default
# port, where a person's own gc lives: it runs only when GITHUB_ACTIONS=true
# or HERDR_CANARY_THROWAWAY_HOME=$HOME (HOME is a throwaway directory), and
# only into a GC_HOME that does not exist yet.
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

repo=$(cd "$here/.." && pwd)
GC_DIR=$CANARY_ROOT/gc
GC=$GC_DIR/gc
CITY_ROOT=$CANARY_ROOT/city-root
CITY=$CITY_ROOT/my-city
API=http://127.0.0.1:8372
# The supervisor's home: the default ~/.gc, so the mod finds it as a person's.
# That is where a person's own gc lives, so the city stage runs only in a
# throwaway home (see guard_throwaway_home) and teardown stops only the
# supervisor this script recorded in SUPERVISOR_MARKER.
export GC_HOME=${GC_HOME:-$HOME/.gc}
SUPERVISOR_MARKER=$CANARY_ROOT/supervisor.json

build_gc() {
  [[ -n ${GASCITY_SRC:-} && -f $GASCITY_SRC/go.mod ]] || die "GASCITY_SRC must point at a gascity checkout"
  mkdir -p "$GC_DIR"
  (cd "$GASCITY_SRC" && go build -o "$GC" ./cmd/gc)
  "$GC" version >&2 || true
}

# api <method> <path> [json]: one call to the city's API.
api() {
  local args=(-fsS -X "$1" -H 'X-GC-Request: herdr-gascity-canary' "$API/v0/city/my-city$2")
  [[ $# -lt 3 ]] || args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}"
}

# Refuses to put a scratch city where a person's gc may live: only on a CI
# runner (GITHUB_ACTIONS=true) or with HERDR_CANARY_THROWAWAY_HOME set to
# $HOME (the caller's word that HOME is a throwaway directory), only into a
# GC_HOME that does not exist yet, and only with nothing on gc's port.
guard_throwaway_home() {
  if [[ ${GITHUB_ACTIONS:-} != true && ${HERDR_CANARY_THROWAWAY_HOME:-} != "$HOME" ]]; then
    die "refusing to start a scratch city in $GC_HOME outside CI: set HERDR_CANARY_THROWAWAY_HOME=\$HOME only when HOME is a throwaway directory"
  fi
  [[ ! -e $GC_HOME ]] || die "refusing: $GC_HOME already exists (a real gc home?); the scratch city needs a fresh one"
  if curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1; then
    die "refusing: a gc supervisor already answers on $API"
  fi
}

# Records the supervisor gc init started (its pid, under this GC_HOME) for teardown.
record_supervisor() {
  local pid
  pid=$("$GC" supervisor status --json 2>/dev/null | jq -er 'select(.running == true) | .pid | select(. > 0)') ||
    die "cannot find the pid of the supervisor gc init started"
  jq -n --arg home "$GC_HOME" --argjson pid "$pid" --arg api "$API" '{gc_home: $home, pid: $pid, api: $api}' >"$SUPERVISOR_MARKER.new"
  mv -f "$SUPERVISOR_MARKER.new" "$SUPERVISOR_MARKER"
  log "the scratch city's supervisor: pid $pid in $GC_HOME"
}

city_up() {
  local shims=$CANARY_ROOT/gc-shims rc=0
  guard_throwaway_home
  [[ -x $GC ]] || die "no gc at $GC (run the gc stage)"
  mkdir -p "$CITY_ROOT/rigs/frontend" "$GC_HOME" "$shims"
  # No service manager: gc init's `supervisor install` must not reach one.
  for s in systemctl launchctl; do printf '#!/bin/sh\nexit 0\n' >"$shims/$s"; chmod +x "$shims/$s"; done
  local ORDERS
  ORDERS=$(find "$GASCITY_SRC/internal/bootstrap/packs/core/orders" -name '*.toml' -exec basename {} .toml \; | sort | jq -Rn '[inputs] | map(@json) | join(", ")' -r)
  [[ -n $ORDERS ]] || die "no built-in orders found under $GASCITY_SRC"
  cat >"$CITY_ROOT/city.toml" <<EOF
[workspace]
name = "my-city"

[beads]
provider = "file"

[session]
provider = "subprocess"

# The built-in maintenance orders would fill the board with their tracking beads.
[orders]
skip = [$ORDERS]

[[rigs]]
name = "frontend"
path = "$CITY_ROOT/rigs/frontend"
prefix = "fe"

[[agent]]
name = "builder"
dir = "frontend"
start_command = "sleep 3600"

[[agent]]
name = "reviewer"
start_command = "sleep 3600"

[[named_session]]
template = "builder"
dir = "frontend"
mode = "always"

[[named_session]]
template = "reviewer"
mode = "always"
EOF
  PATH=$shims:$PATH "$GC" init --skip-provider-readiness --file "$CITY_ROOT/city.toml" "$CITY" 2>&1 | tee "$CANARY_OUT/gc-init.log" >&2 || rc=$?
  # Whatever runs under this fresh GC_HOME now is this script's, even after a failed init.
  record_supervisor
  (( rc == 0 )) || die "gc init failed (exit $rc)"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  sessions_up() {
    [[ $(curl -fsS "$API/v0/city/my-city/sessions" 2>/dev/null | jq '[.items[] | select(.running)] | length') == 2 ]]
  }
  poll 120 "the city's two sessions" sessions_up || { curl -sS "$API/v0/city/my-city/sessions" >&2 || true; die "the city's sessions did not start"; }
  local id title
  for title in "Add retry with backoff to the API client" "Document the installer" "Show the data age in the header" "Pin the gc API spec"; do
    id=$(api POST /beads "$(jq -cn --arg t "$title" '{title: $t, priority: 2}')" | jq -er .id)
    printf '%s %s\n' "$id" "$title" >>"$CANARY_OUT/beads.txt"
  done
  id=$(sed -n 2p "$CANARY_OUT/beads.txt" | cut -d' ' -f1)
  api PATCH "/bead/$id" '{"status":"in_progress","assignee":"frontend/builder"}' >/dev/null
  id=$(sed -n 4p "$CANARY_OUT/beads.txt" | cut -d' ' -f1)
  api POST "/bead/$id/close" '{"reason":"pinned"}' >/dev/null
  curl -fsS "$API/v0/cities" | tee "$CANARY_OUT/cities.json" >&2
}


# The tarball the package stage made (MOD_TARBALL, from $GITHUB_ENV in CI).
tarball() {
  [[ -n ${MOD_TARBALL:-} && -f $MOD_TARBALL ]] || die "no packaged mod (run the package stage)"
  printf '%s\n' "$MOD_TARBALL"
}

# break_bundle <tarball>: the same tarball with a syntax error at the end of
# gascity/main.js, and its .sha256 to match.
break_bundle() {
  local tarball=$1 work=$CANARY_ROOT/broken
  rm -rf "$work"
  mkdir -p "$work"
  tar -xzf "$tarball" -C "$work"
  [[ -f $work/gascity/main.js ]] || die "the tarball has no gascity/main.js"
  printf '\n})( a syntax error the smoke must catch\n' >>"$work/gascity/main.js"
  (cd "$work" && tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$tarball" -- *)
  (cd "$(dirname "$tarball")" && sha256sum "$(basename "$tarball")" >"$(basename "$tarball").sha256")
  log "broke $(basename "$tarball"): a syntax error appended to gascity/main.js"
}

package_mod() {
  local dist=$CANARY_ROOT/dist tarballs
  [[ $# -eq 0 || $1 == --broken ]] || die "package: unknown option $1"
  rm -rf "$dist"
  (cd "$repo" && bun run package --out "$dist") >&2
  tarballs=("$dist"/gascity-mod-*.tar.gz)
  [[ ${#tarballs[@]} -eq 1 && -f ${tarballs[0]} ]] || die "package made no single tarball in $dist"
  [[ ${1:-} != --broken ]] || break_bundle "${tarballs[0]}"
  sha256sum "${tarballs[0]}" | tee "$CANARY_OUT/mod-tarball.sha256" >&2
  export_env MOD_TARBALL "${tarballs[0]}"
}

check_mod() {
  local dir=$CANARY_ROOT/check
  rm -rf "$dir"
  mkdir -p "$dir"
  tar -xzf "$(tarball)" -C "$dir"
  # As install.sh installs it: without the recipe, the preview and the key fragment.
  rm -f "$dir/gascity/RECIPE.md" "$dir/gascity/preview.png" "$dir/gascity/keys.json"
  # No display: the checker loads the mod once, without a window.
  env -u DISPLAY -u WAYLAND_DISPLAY herdr-app check "$dir/gascity" 2>&1 | tee "$CANARY_OUT/check.txt" >&2
}

install_mod() {
  local tabs tab status
  # Herdr is open (bootstrap's app stage): the installer opens the tab and sets gcBin.
  HERDR_GASCITY_WAIT=30 sh "$repo/install.sh" --from "$(tarball)" --gc-bin "$GC" 2>&1 | tee "$CANARY_OUT/install-mod.log" >&2
  jq -e --arg gc "$GC" '.["gascity.settings"].gcBin == $gc' "$HERDR_APP_HOME/shared.json" >/dev/null ||
    die "gascity.settings.gcBin is not $GC in shared.json"
  # The installer's tab: one terminal-free "Gas City" tab in a local space, shown.
  herdr-app ls >"$CANARY_OUT/ls-install.json"
  tabs=$(jq -c '[.spaces[] | select(.machine == null) | .tabs[]
    | select(.name == "Gas City" and ((.terminals // []) | length) == 0) | .id]' "$CANARY_OUT/ls-install.json")
  jq -e 'length == 1' >/dev/null <<<"$tabs" || die "want one Gas City tab after install.sh, have $tabs"
  tab=$(jq -r '.[0]' <<<"$tabs")
  status=$(herdr-app status)
  printf '%s\n' "$status" >"$CANARY_OUT/status-install.json"
  jq -e --arg tab "$tab" '.tab == $tab' >/dev/null <<<"$status" || die "the Gas City tab $tab is not the shown tab: $(jq -c .tab <<<"$status")"
  export_env GASCITY_TAB "$tab"
}

mod_probe() { cat "$HERDR_APP_HOME/data/gascity-probe/probe.json" 2>/dev/null; }

# probe_shows <jq filter>: true when the mod's probe exists and the filter holds.
probe_shows() { mod_probe | jq -e "$1" >/dev/null 2>&1; }

connected() {
  do_ok 15 gascity.probe:on >/dev/null || die "gascity.probe:on was not accepted"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  up() { probe_shows '.connection.text == "connected" and .city == "my-city" and (.sessions | length) == 2'; }
  poll 90 "the mod connected to my-city, its sessions listed" up || { mod_probe >&2 || true; die "the mod never connected to the city"; }
  mod_probe >"$CANARY_OUT/gascity-probe-connected.json"
}

shot() {
  local file=${1:-preview.png} colors sd status
  [[ $file =~ ^[a-z0-9-]+\.png$ ]] || die "shot: not a plain .png name: $file"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  whole_board() {
    probe_shows '.connection.text == "connected" and .city == "my-city"
      and (.sessions | length) == 2 and (.board.ready.cards | length) == 2
      and (.board.in_progress.cards | length) == 1 and (.board.closed.recent + .board.closed.earlier | length) >= 1'
  }
  poll 90 "the mod to show my-city's board" whole_board || { mod_probe >&2 || true; die "the mod never showed the board"; }
  # Let a full refresh land so every region has data, then hide the probe's own traces.
  sleep 6
  do_ok 15 gascity.probe:off >/dev/null || die "gascity.probe:off was not accepted"
  mod_probe >"$CANARY_OUT/gascity-probe.json" || true
  sleep 1
  herdr-app shot "$CANARY_OUT/$file" >&2 || die "herdr-app shot failed"
  colors=$(identify -format '%k' "$CANARY_OUT/$file")
  sd=$(convert "$CANARY_OUT/$file" -colorspace Gray -format '%[fx:standard_deviation]' info:)
  printf '%s: %s, %s colors, stddev %s\n' "$file" "$(identify -format '%wx%h' "$CANARY_OUT/$file")" "$colors" "$sd" | tee "$CANARY_OUT/shot-stats.txt" >&2
  if (( colors < 16 )) || ! awk -v s="$sd" 'BEGIN { exit !(s > 0.02) }'; then die "the shot is blank"; fi
  status=$(herdr-app status)
  printf '%s\n' "$status" >"$CANARY_OUT/status-shot.json"
  jq -e '.errors == []' >/dev/null <<<"$status" || die "herdr-app status reports errors: $(jq -c .errors <<<"$status")"
}

# Stops the supervisor the city stage recorded, and nothing else: no record,
# another GC_HOME, or another supervisor running there now, and it is left alone.
teardown() {
  local home pid now
  if [[ ! -f $SUPERVISOR_MARKER ]]; then
    log "teardown: no supervisor recorded in $SUPERVISOR_MARKER; nothing to stop"
    return 0
  fi
  home=$(jq -r '.gc_home // ""' "$SUPERVISOR_MARKER")
  pid=$(jq -r '.pid // 0' "$SUPERVISOR_MARKER")
  if [[ $home != "$GC_HOME" ]]; then
    log "teardown: the recorded supervisor is in $home, not $GC_HOME; left alone"
    return 0
  fi
  [[ -x $GC ]] || { log "teardown: no gc at $GC; nothing stopped"; return 0; }
  now=$("$GC" supervisor status --json 2>/dev/null | jq -r 'if .running == true then .pid else 0 end' 2>/dev/null) || now=0
  if [[ $pid == 0 || $now != "$pid" ]]; then
    log "teardown: the supervisor running now (pid ${now:-0}) is not the recorded one (pid $pid); left alone"
    return 0
  fi
  "$GC" supervisor stop --wait >/dev/null 2>&1 || true
  rm -f "$SUPERVISOR_MARKER"
  log "teardown: stopped the scratch city's supervisor (pid $pid)"
}

case ${1:-} in
  gc) run_stage gc infra build_gc ;;
  city) run_stage city infra city_up ;;
  package) run_stage package product package_mod "${@:2}" ;;
  check) run_stage check product check_mod ;;
  install) run_stage install-mod product install_mod ;;
  connected) run_stage connected product connected ;;
  shot) run_stage shot ui shot "${@:2}" ;;
  teardown) teardown ;;
  *) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
