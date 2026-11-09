#!/usr/bin/env bash
# Takes the mod's preview (gascity/preview.png) from a real run: gc built from
# the pinned commit runs a scratch city, the released herdr-app runs headless
# (bootstrap-linux.sh), and the mod is installed by install.sh. Run after
# bootstrap-linux.sh's preflight, resolve, mirror, install and display stages.
#
#   preview-linux.sh gc        build gc from $GASCITY_SRC into $CANARY_ROOT/gc/gc
#   preview-linux.sh city      a scratch city (file beads, subprocess sessions, no orders,
#                              one rig, two agents) with a few beads, from this
#                              shell: never from a herdr terminal
#   preview-linux.sh install   package the mod and install it with install.sh
#                              --from, the app open (after bootstrap's app stage)
#   preview-linux.sh shot      wait until the mod shows the city, then
#                              `herdr-app shot` into out/preview.png
#   preview-linux.sh teardown  stop the city's supervisor
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
export GC_HOME=${GC_HOME:-$HOME/.gc}

build_gc() {
  [[ -n ${GASCITY_SRC:-} && -f $GASCITY_SRC/go.mod ]] || die "GASCITY_SRC must point at a gascity checkout"
  mkdir -p "$GC_DIR"
  (cd "$GASCITY_SRC" && go build -o "$GC" ./cmd/gc)
  "$GC" version >&2 || true
}

# api <method> <path> [json]: one call to the city's API.
api() {
  local args=(-fsS -X "$1" -H 'X-GC-Request: herdr-gascity-preview' "$API/v0/city/my-city$2")
  [[ $# -lt 3 ]] || args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}"
}

city_up() {
  local shims=$CANARY_ROOT/gc-shims
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
  PATH=$shims:$PATH "$GC" init --skip-provider-readiness --file "$CITY_ROOT/city.toml" "$CITY" 2>&1 | tee "$CANARY_OUT/gc-init.log" >&2
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

install_mod() {
  local dist=$CANARY_ROOT/dist tarball
  (cd "$repo" && bun run package --out "$dist") >&2
  tarball=$(ls "$dist"/gascity-mod-*.tar.gz)
  # Herdr is open (bootstrap's app stage): the installer opens the tab and sets gcBin.
  HERDR_GASCITY_WAIT=30 sh "$repo/install.sh" --from "$tarball" --gc-bin "$GC" 2>&1 | tee "$CANARY_OUT/install-mod.log" >&2
  jq -e --arg gc "$GC" '.["gascity.settings"].gcBin == $gc' "$HERDR_APP_HOME/shared.json" >/dev/null ||
    die "gascity.settings.gcBin is not $GC in shared.json"
}

mod_probe() { cat "$HERDR_APP_HOME/data/gascity-probe/probe.json" 2>/dev/null; }

shot() {
  do_ok 15 gascity.probe:on >/dev/null || die "gascity.probe:on was not accepted"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  shows_city() {
    mod_probe | jq -e '.connection.text == "connected" and .city == "my-city"
      and (.sessions | length) == 2 and (.board.ready.cards | length) == 2
      and (.board.in_progress.cards | length) == 1 and (.board.closed.recent + .board.closed.earlier | length) >= 1' >/dev/null 2>&1
  }
  poll 90 "the mod to show my-city" shows_city || { mod_probe >&2 || true; die "the mod never showed the city"; }
  # Let a full refresh land so every region has data, then hide the probe's own traces.
  sleep 6
  do_ok 15 gascity.probe:off >/dev/null || die "gascity.probe:off was not accepted"
  mod_probe >"$CANARY_OUT/gascity-probe.json" || true
  sleep 1
  herdr-app shot "$CANARY_OUT/preview.png" >&2 || die "herdr-app shot failed"
  local colors sd
  colors=$(identify -format '%k' "$CANARY_OUT/preview.png")
  sd=$(convert "$CANARY_OUT/preview.png" -colorspace Gray -format '%[fx:standard_deviation]' info:)
  printf 'preview: %s, %s colors, stddev %s\n' "$(identify -format '%wx%h' "$CANARY_OUT/preview.png")" "$colors" "$sd" | tee "$CANARY_OUT/preview-stats.txt" >&2
  if (( colors < 16 )) || ! awk -v s="$sd" 'BEGIN { exit !(s > 0.02) }'; then die "the preview is blank"; fi
  herdr-app status | tee "$CANARY_OUT/status-preview.json" | jq -e '.errors == []' >/dev/null || die "herdr-app status reports errors"
}

teardown() {
  [[ -x $GC ]] || return 0
  "$GC" supervisor stop --wait >/dev/null 2>&1 || true
}

case ${1:-} in
  gc) run_stage P1-gc infra build_gc ;;
  city) run_stage P2-city infra city_up ;;
  install) run_stage P3-install product install_mod ;;
  shot) run_stage P4-shot ui shot ;;
  teardown) teardown ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
