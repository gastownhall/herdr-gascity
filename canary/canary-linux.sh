#!/usr/bin/env bash
# The nightly canary's product stages: the mod in the released Herdr app,
# driven end to end against the canary city through `herdr-app do
# gascity.<command>` (the same action functions as the buttons) with the mod's
# tab selected before every command, plus one real XTEST key. Run after
# bootstrap-linux.sh (preflight .. app) and mod-linux.sh (gc, canary-city,
# package, check, install). Between discover and bead-closed this script never
# changes gc itself: it sends commands, reads the mod's probe, and reads gc's
# API, `herdr-app` and /proc.
#
#   stage         design step                      class
#   discover      S5/S6 probe on, mod discovers      integration
#   session       S7 start a session from the mod    integration
#   output        S8 its live output in the detail   integration
#   attach        S9 open its terminal in a tab      integration
#   scope-audit   S9b no HC_SCOPE outside that tab   integration
#   keyboard      S10 a real key reaches the mod     ui
#   bead-input    S11 create a bead, submit input    integration
#   bead-closed   S12 the agent's close is shown     integration
#   authority     S13 every gc change was the mod's  integration
#
# S0-S4 are bootstrap-linux.sh's and mod-linux.sh's stages; S14 (artifacts,
# canary-result.json) is the workflow's. Values pass between stages through
# $GITHUB_ENV (export_env): CANARY_SINCE, CANARY_SESSION, CANARY_BEAD.
#
# Needs: GASCITY_TAB (mod-linux.sh install), CANARY_CITY_DIR (canary-city).
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

repo=$(cd "$here/.." && pwd)
GC=$CANARY_ROOT/gc/gc
API=http://127.0.0.1:8372
CITY=canary
AGENT=canary.canary-agent
PROBE=$HERDR_APP_HOME/data/gascity-probe/probe.json
# A word unique to this run: the session's alias, the bead's title, the close reason.
NONCE=$(printf 'n%s-%s' "${GITHUB_RUN_ID:-local}" "${GITHUB_RUN_ATTEMPT:-$$}" | tr -c 'A-Za-z0-9-' '-' | cut -c1-40)

mod_probe() { cat "$PROBE" 2>/dev/null; }
# shows [jq options] <filter>: the mod's probe exists and the filter holds.
shows() { mod_probe | jq -e "$@" >/dev/null 2>&1; }
gc_get() { curl -fsS --max-time 10 "$API/v0/city/$CITY$1"; }
uri() { jq -rn --arg v "$1" '$v | @uri'; }
keep() { mod_probe >"$CANARY_OUT/gascity-probe-$1.json" || true; }

# The mod's tab, selected and on screen: a hidden copy gets no commands.
select_mod() {
  [[ -n ${GASCITY_TAB:-} ]] || die "no GASCITY_TAB (run mod-linux.sh install)"
  do_ok 15 tab.select --id "$GASCITY_TAB" >/dev/null || die "tab.select back to the Gas City tab failed"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  on_screen() { shows '.visibility.on_screen == true'; }
  poll 15 "the mod on screen" on_screen || die "the mod is not on screen after tab.select"
}

# send <command>: `herdr-app do gascity.<command>` to the shown mod; the probe must record it done.
send() {
  local command=$1 t0
  select_mod
  t0=$(date +%s%3N)
  do_ok 15 "gascity.$command" >/dev/null || die "gascity.$command was not accepted"
  # The probe's command log shows a command cut to 80 characters.
  # shellcheck disable=SC2016,SC2317 # jq variables; a poll predicate called by name
  recorded() {
    shows --arg c "$command" --argjson t0 "$t0" \
      'any(.commands[]; .at >= $t0 and .result == "done"
        and (.command == $c or (($c | length) > 80 and .command == ($c[0:79] + "\u2026"))))'
  }
  poll 15 "the mod to run $command" recorded || { mod_probe | jq -c '.commands' >&2 || true; die "the mod did not run $command"; }
}

# newest <kind>: the newest action of that kind in the probe (actions are newest first).
newest() { mod_probe | jq -c --arg k "$1" 'first(.actions[] | select(.action == $k)) // empty'; }

discover() {
  export_env CANARY_SINCE "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  select_mod
  do_ok 15 gascity.probe:on >/dev/null || die "gascity.probe:on was not accepted"
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  found() { shows --arg c "$CITY" '.connection.text == "connected" and .city == $c and .city_phase == "city-running" and .visibility.on_screen == true'; }
  poll 90 "the mod connected to the canary city" found || { mod_probe >&2 || true; die "the mod never connected to the canary city"; }
  keep discovered
  log "discovered through $(mod_probe | jq -c .discovery)"
  local status
  status=$(herdr-app status)
  printf '%s\n' "$status" >"$CANARY_OUT/status-discover.json"
  jq -e '.errors == []' >/dev/null <<<"$status" || die "herdr-app status reports errors: $(jq -c .errors <<<"$status")"
}

session() {
  local alias=$NONCE id
  send "session-new:$CITY:$AGENT:$alias"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  listed() {
    id=$(gc_get "/sessions?limit=200" 2>/dev/null | jq -er --arg a "$alias" \
      'first(.items[] | select(.alias == $a or ((.alias // "") | endswith("." + $a))) | .id)') || return 1
  }
  poll 90 "gc to list the new session" listed || die "gc never listed a session with alias $alias"
  export_env CANARY_SESSION "$id"
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  running() {
    gc_get "/session/$id" 2>/dev/null | jq -e '.running == true' >/dev/null &&
      shows --arg id "$id" 'any(.sessions[]; .id == $id and .status_kind != "lifecycle")'
  }
  poll 90 "session $id running, in gc and in the mod" running || { gc_get "/session/$id" >&2 || true; die "session $id did not run"; }
  # shellcheck disable=SC2317 # a poll predicate, called by name
  done_new() { [[ $(newest session.new | jq -r '.state // ""') == "done" ]]; }
  poll 20 "the session.new action done in the mod" done_new || die "session.new is not done: $(newest session.new)"
  keep session
}

output() {
  local id=${CANARY_SESSION:?no CANARY_SESSION}
  send "focus:$CITY:$id"
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  ready() { shows --arg id "$id" --arg a "$NONCE" '.detail.session == $id and ((.detail.output // "") | contains("CANARY READY")) and ((.detail.output // "") | contains($a))'; }
  poll 30 "CANARY READY in the session's detail" ready || { mod_probe | jq -c .detail >&2 || true; die "the detail never showed the agent's output"; }
  keep output
}

attach() {
  local id=${CANARY_SESSION:?no CANARY_SESSION} state
  send "attach:$CITY:$id"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  settled() { state=$(newest session.attach | jq -r '.state // ""'); [[ $state == "done" || $state == failed || $state == unknown ]]; }
  poll 70 "the attach's outcome" settled || die "the attach never settled: $(newest session.attach)"
  [[ $state == "done" ]] || die "the attach did not open: $(newest session.attach)"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  attached() { gc_get "/session/$id" 2>/dev/null | jq -e '.attached == true' >/dev/null; }
  poll 30 "gc to report a terminal attached" attached || die "gc does not report session $id attached"
  HC_SESSION=${HC_SESSION:-canary} hc ls --json >"$CANARY_OUT/hc-ls-attach.json" 2>&1 || true
  herdr-app ls >"$CANARY_OUT/ls-attach.json" || true
  # tab.new made the attach tab active; send/select_mod brings the mod back on screen.
  select_mod
  keep attach
}

scope_audit() {
  local id=${CANARY_SESSION:?no CANARY_SESSION}
  [[ -n ${CANARY_CITY_DIR:-} ]] || die "no CANARY_CITY_DIR (run mod-linux.sh canary-city)"
  bun "$here/scope-audit.ts" --city "$CANARY_CITY_DIR" session attach "$id" 2>&1 | tee "$CANARY_OUT/scope-audit.txt" >&2
}

window_geometry() {
  local id
  id=$(xdotool search --name '^Herdr$' | head -n1)
  [[ -n $id ]] || return 1
  xdotool getwindowgeometry --shell "$id"
}

keyboard() {
  # Set by xdotool's --shell output.
  # shellcheck disable=SC2034
  local reply pane before geometry WINDOW X Y WIDTH HEIGHT SCREEN
  select_mod
  pane=$(herdr-app status | jq -er '.focused_pane') || die "no focused pane in the Gas City tab"
  reply=$(do_ok 15 pane.split --direction right --pane "$pane") || die "pane.split failed: $reply"
  printf '%s\n' "$reply" >"$CANARY_OUT/pane-split.json"
  # The X keyboard focus goes to the window with no pointer input (Xvfb, XTEST).
  geometry=$(window_geometry) || die "no Herdr window on ${DISPLAY:-}"
  eval "$geometry"
  xdotool windowfocus --sync "$WINDOW"
  do_ok 15 pane.go --direction left >/dev/null || die "pane.go left failed"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  keyed_in() { shows '.keyboard == true'; }
  poll 15 "pane.go to hand the mod the keyboard" keyed_in || die "pane.go never handed the mod the keyboard"
  before=$(mod_probe | jq -er .refresh_count) || die "the probe has no refresh_count"
  xdotool key --clearmodifiers r
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  refreshed() { shows --argjson n "$before" '.refresh_count > $n'; }
  poll 15 "the r key to refresh the mod" refreshed || die "the XTEST key r never reached the mod (refresh_count stayed $before)"
  keep keyboard
}

bead_input() {
  local id=${CANARY_SESSION:?no CANARY_SESSION} title="canary $NONCE" bead state
  send "bead-new:$CITY:$(uri "$title")"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  on_board() {
    bead=$(mod_probe | jq -er --arg t "$title" 'first(.board.ready.cards[] | select(.title == $t) | .id)' 2>/dev/null) || return 1
  }
  poll 30 "the new bead on the mod's board" on_board || die "the bead \"$title\" never showed on the board"
  export_env CANARY_BEAD "$bead"
  send "focus:$CITY:$id"
  send "submit:$CITY:$id:$(uri "close $bead $NONCE")"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  settled() { state=$(newest session.submit | jq -r '.state // ""'); [[ -n $state && $state != pending ]]; }
  poll 30 "the submit's outcome" settled || die "the submit never settled: $(newest session.submit)"
  [[ $state == "done" ]] || die "the submit did not succeed: $(newest session.submit)"
  keep bead-input
}

bead_closed() {
  local id=${CANARY_SESSION:?no CANARY_SESSION} bead=${CANARY_BEAD:?no CANARY_BEAD}
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  in_ring() { shows --arg b "$bead" --arg r "canary $NONCE" 'any(.board.closed.recent[]; .id == $b and .close_reason == $r)'; }
  poll 60 "the bead in the mod's closed ring" in_ring || { mod_probe | jq -c .board.closed >&2 || true; die "bead $bead never showed closed with reason \"canary $NONCE\""; }
  # shellcheck disable=SC2016,SC2317 # a jq variable; a poll predicate called by name
  done_line() { shows --arg id "$id" --arg l "CANARY DONE $bead $NONCE" '.detail.session == $id and ((.detail.output // "") | contains($l))'; }
  poll 30 "CANARY DONE in the session's detail" done_line || { mod_probe | jq -c .detail >&2 || true; die "the detail never showed CANARY DONE"; }
  keep bead-closed
}

authority() {
  bun "$here/gc-authority.ts" --api "$API" --probe "$PROBE" --city "$CITY" --gc-bin "$GC" \
    --city-path "${CANARY_CITY_DIR:?no CANARY_CITY_DIR}" --session "${CANARY_SESSION:?no CANARY_SESSION}" \
    --bead "${CANARY_BEAD:?no CANARY_BEAD}" --since "${CANARY_SINCE:?no CANARY_SINCE}" \
    --out "$CANARY_OUT/authority.json" 2>&1 | tee "$CANARY_OUT/authority.txt" >&2
}

# Always: gc's events and the probe as they are at the end.
collect() {
  curl -fsS --max-time 20 "$API/v0/events?since=2h" >"$CANARY_OUT/gc-events.json" 2>/dev/null || log "collect: no gc events"
  mod_probe >"$CANARY_OUT/gascity-probe-final.json" || log "collect: no probe"
  (cd "$repo" && git rev-parse HEAD) >"$CANARY_OUT/integration-commit.txt" 2>/dev/null || true
}

case ${1:-} in
  discover) run_stage discover integration discover ;;
  session) run_stage session integration session ;;
  output) run_stage output integration output ;;
  attach) run_stage attach integration attach ;;
  scope-audit) run_stage scope-audit integration scope_audit ;;
  keyboard) run_stage keyboard ui keyboard ;;
  bead-input) run_stage bead-input integration bead_input ;;
  bead-closed) run_stage bead-closed integration bead_closed ;;
  authority) run_stage authority integration authority ;;
  collect) collect ;;
  *) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
