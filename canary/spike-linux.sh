#!/usr/bin/env bash
# The M8a spike's checks, run after bootstrap-linux.sh has the app up.
#
#   spike-linux.sh check      `herdr-app check` on the hello mod, copied into mods/
#   spike-linux.sh types      `herdr-app types` writes the host .d.ts files headless
#   spike-linux.sh mod        tab.new --mod hello; the copy writes its probe and
#                             gets commands; a second tab, then tab.select back
#   spike-linux.sh keyboard   pane.split + pane.go hands the mod the keyboard
#                             ("focus"); an XTEST key press reaches it
#   spike-linux.sh shot       `herdr-app shot` is not blank and shows the mod
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

MOD_DIR=$HERDR_APP_HOME/mods/hello
# The mod's own panel color (canary/hello-mod/main.js).
MOD_RGB="#1f6feb"

check_mod() {
  mkdir -p "$HERDR_APP_HOME/mods"
  rm -rf "$MOD_DIR"
  cp -rf "$here/hello-mod" "$MOD_DIR"
  # No display: the checker loads the mod once, without a window.
  env -u DISPLAY -u WAYLAND_DISPLAY herdr-app check "$MOD_DIR" 2>&1 | tee "$CANARY_OUT/check.txt" >&2
}

types() {
  local dir=$CANARY_OUT/types
  rm -rf "$dir"
  cp -rf "$here/hello-mod" "$dir"
  env -u DISPLAY -u WAYLAND_DISPLAY herdr-app types "$dir" 2>&1 | tee "$CANARY_OUT/types.txt" >&2
  ls -la "$dir" >&2
  compgen -G "$dir/*.d.ts" >/dev/null || die "herdr-app types wrote no .d.ts into $dir"
}

# ping <name>: a `hello.<name>` command must reach the shown copy.
ping() {
  local name=$1
  do_ok 15 "hello.$name" >/dev/null || die "hello.$name was not accepted"
  # shellcheck disable=SC2016 # a jq variable
  got() { probe_has --arg c "$name" 'any(.commands[]; . == $c)'; }
  poll 15 "probe to record hello.$name" got || die "hello.$name never reached the mod copy"
}

open_mod() {
  local reply status
  reply=$(do_ok 30 tab.new --mod hello --name Hello --space "$HERDR_SPACE") || die "tab.new --mod hello failed: $reply"
  printf '%s\n' "$reply" >"$CANARY_OUT/tab-new-mod.json"
  export_env HELLO_TAB "$(jq -er .tab <<<"$reply")"
  export_env HELLO_PANE "$(jq -er .pane <<<"$reply")"
  alive() { probe_has '.schema == "herdr-spike-hello-probe/1" and .renders >= 1'; }
  poll 30 "the hello mod's probe" alive || die "the hello mod never wrote its probe"
  ping first
  # A second tab hides the mod; a hidden copy gets no commands, so select it back.
  reply=$(do_ok 30 tab.new --name shell --space "$HERDR_SPACE") || die "tab.new (shell) failed: $reply"
  printf '%s\n' "$reply" >"$CANARY_OUT/tab-new-shell.json"
  do_ok 15 tab.select --id "$HELLO_TAB" >/dev/null || die "tab.select back to the mod tab failed"
  ping reselected
  status=$(herdr-app status)
  printf '%s\n' "$status" >"$CANARY_OUT/status-mod.json"
  jq -e --arg tab "$HELLO_TAB" '.tab == $tab' >/dev/null <<<"$status" || die "the mod tab is not the shown tab: $(jq -c .tab <<<"$status")"
  jq -e '.errors == []' >/dev/null <<<"$status" || die "status reports errors: $(jq -c .errors <<<"$status")"
  herdr-app ls >"$CANARY_OUT/ls-mod.json"
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
  local reply WINDOW X Y WIDTH HEIGHT SCREEN
  reply=$(do_ok 15 pane.split --direction right --pane "$HELLO_PANE") || die "pane.split failed: $reply"
  printf '%s\n' "$reply" >"$CANARY_OUT/pane-split.json"
  # The X keyboard focus goes to the window directly (XSetInputFocus), with no
  # pointer input: Weston 13's headless backend has no seat, and XTEST pointer
  # motion aborts its Xwayland (SIGABRT). Keys need the Xvfb display.
  eval "$(window_geometry)" || die "no Herdr window on $DISPLAY"
  printf 'window %s at %s,%s size %sx%s\n' "$WINDOW" "$X" "$Y" "$WIDTH" "$HEIGHT" | tee "$CANARY_OUT/window.txt" >&2
  xdotool windowfocus --sync "$WINDOW"
  printf 'X input focus after windowfocus: %s\n' "$(xdotool getwindowfocus)" | tee -a "$CANARY_OUT/window.txt" >&2
  do_ok 15 pane.go --direction left >/dev/null || die "pane.go left failed"
  focused() { probe_has '.focused == true and any(.commands[]; . == "focus")'; }
  poll 15 "the mod to get focus from pane.go" focused || die "pane.go never handed the mod the keyboard"
  printf 'X input focus before the key: %s\n' "$(xdotool getwindowfocus)" | tee -a "$CANARY_OUT/window.txt" >&2
  xdotool key --clearmodifiers r
  keyed() { probe_has '.keys | length > 0'; }
  poll 15 "an XTEST key to reach the mod" keyed || die "the XTEST key never reached the mod"
  hello_probe | jq -c '{focused, keys, commands}' >&2
}

# image_stats <png>: "<unique colors> <stddev 0..1> <share of the mod's color 0..1>"
image_stats() {
  local colors sd share
  colors=$(identify -format '%k' "$1")
  sd=$(convert "$1" -colorspace Gray -format '%[fx:standard_deviation]' info:)
  share=$(convert "$1" -alpha off -fuzz 12% -fill black +opaque "$MOD_RGB" -fill white -opaque "$MOD_RGB" -colorspace Gray -format '%[fx:mean]' info:)
  printf '%s %s %s\n' "$colors" "$sd" "$share"
}

not_blank() {
  local colors=$1 sd=$2
  (( colors >= 16 )) && awk -v s="$sd" 'BEGIN { exit !(s > 0.02) }'
}

shot() {
  local path=$CANARY_OUT/herdr-shot.png stats colors sd share
  herdr-app shot "$path" >&2 || die "herdr-app shot failed"
  stats=$(image_stats "$path")
  read -r colors sd share <<<"$stats"
  printf 'herdr-app shot: %s colors, stddev %s, mod color share %s (%s)\n' "$colors" "$sd" "$share" "$(identify -format '%wx%h' "$path")" | tee "$CANARY_OUT/shot-stats.txt" >&2
  not_blank "$colors" "$sd" || die "herdr-app shot is blank"
  awk -v s="$share" 'BEGIN { exit !(s > 0.05) }' || die "herdr-app shot does not show the hello mod's panel"
  # The same window as the X server shows it: proves frames were presented.
  local xid
  xid=$(xdotool search --name '^Herdr$' | head -n1)
  import -display "$DISPLAY" -window "$xid" "$CANARY_OUT/x-window.png"
  stats=$(image_stats "$CANARY_OUT/x-window.png")
  read -r colors sd share <<<"$stats"
  printf 'X window grab: %s colors, stddev %s, mod color share %s (%s)\n' "$colors" "$sd" "$share" "$(identify -format '%wx%h' "$CANARY_OUT/x-window.png")" | tee -a "$CANARY_OUT/shot-stats.txt" >&2
  not_blank "$colors" "$sd" || die "the X server's copy of the window is blank"
}

case ${1:-} in
  check) run_stage S2-check product check_mod ;;
  types) run_stage S2b-types product types ;;
  mod) run_stage S5-mod product open_mod ;;
  keyboard) run_stage S10-keyboard ui keyboard ;;
  shot) run_stage S6-shot ui shot ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
