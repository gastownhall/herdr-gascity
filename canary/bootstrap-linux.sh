#!/usr/bin/env bash
# Brings up the released Herdr app headless on a fresh Linux VM with no GPU:
# Weston's headless backend with Xwayland for the display, Mesa's lavapipe for
# Vulkan, herdr's published installer for the app and its core (served from a
# per-release local mirror). After herdr-app's own `scripts/sandbox`.
#
#   bootstrap-linux.sh preflight   S0  system packages, software Vulkan, runtime dir
#   bootstrap-linux.sh resolve     S0  current stable versions (cache key)
#   bootstrap-linux.sh mirror      S0  fill the mirror (cache misses only) and serve it
#   bootstrap-linux.sh install     S1  herdr's published install.sh against the mirror
#   bootstrap-linux.sh display     S4a weston --backend=headless --xwayland (or Xvfb)
#   bootstrap-linux.sh app         S4b welcome skipped, app up, `status`, `space.new`
#   bootstrap-linux.sh teardown    stop the app, its core, the display and the mirror
#
# Each stage appends its outcome to $CANARY_ROOT/out/stages.jsonl. Values later
# stages need (DISPLAY, the space id, ...) go to $GITHUB_ENV.
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

MIRROR_PORT=${MIRROR_PORT:-18765}
MIRROR_URL="http://127.0.0.1:$MIRROR_PORT"
RESOLVED=$CANARY_ROOT/resolved
MIRROR_CACHE=${MIRROR_CACHE:-$CANARY_ROOT/mirror-cache}
APT_PACKAGES=(weston xwayland xvfb mesa-vulkan-drivers libvulkan1 vulkan-tools libxkbcommon-x11-0
  imagemagick xdotool x11-utils jq fonts-dejavu-core)

target() {
  case "$(uname -m)" in
    x86_64 | amd64) echo linux-x86_64 ;;
    aarch64 | arm64) echo linux-aarch64 ;;
    *) die "no herdr build for $(uname -m)" ;;
  esac
}

preflight() {
  local attempt
  for attempt in 1 2 3; do
    if sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${APT_PACKAGES[@]}"; then
      break
    fi
    (( attempt < 3 )) || die "apt-get install failed 3 times"
    log "apt-get failed (attempt $attempt); retrying"
    sleep $(( attempt * 10 ))
  done
  vulkaninfo --summary >"$CANARY_OUT/vulkaninfo.txt" 2>&1 || true
  grep -qi llvmpipe "$CANARY_OUT/vulkaninfo.txt" || { cat "$CANARY_OUT/vulkaninfo.txt" >&2; die "no lavapipe (llvmpipe) Vulkan device"; }
  ls -l /dev/dri >"$CANARY_OUT/dev-dri.txt" 2>&1 || echo "no /dev/dri" >"$CANARY_OUT/dev-dri.txt"
  local runtime=${XDG_RUNTIME_DIR:-}
  if [[ -z $runtime || ! -d $runtime || ! -w $runtime ]]; then
    runtime=$CANARY_ROOT/runtime
    mkdir -p "$runtime"
    chmod 700 "$runtime"
  fi
  export_env XDG_RUNTIME_DIR "$runtime"
  {
    echo "kernel: $(uname -srm)"
    echo "os: $(. /etc/os-release && echo "$PRETTY_NAME")"
    echo "weston: $(weston --version 2>&1)"
    echo "xwayland: $(dpkg-query -W -f='${Version}' xwayland)"
    echo "xvfb: $(dpkg-query -W -f='${Version}' xvfb)"
    echo "mesa-vulkan-drivers: $(dpkg-query -W -f='${Version}' mesa-vulkan-drivers)"
    echo "vulkan device: $(grep -m1 -i 'deviceName' "$CANARY_OUT/vulkaninfo.txt" | sed 's/.*= *//')"
  } >"$CANARY_OUT/versions-system.txt"
  cat "$CANARY_OUT/versions-system.txt" >&2
}

resolve() {
  local versions kind version
  versions=$("$here/mirror.sh" resolve "$RESOLVED")
  printf '%s\n' "$versions" >&2
  while IFS='=' read -r kind version; do
    valid_version "$version" || die "$kind: unexpected version $version"
    export_output "$kind" "$version"
  done <<<"$versions"
  export_output target "$(target)"
}

mirror() {
  "$here/mirror.sh" fill "$RESOLVED" "$MIRROR_CACHE" "$(target)"
  local pid
  pid=$(MIRROR_LOG="$CANARY_OUT/mirror.log" "$here/mirror.sh" serve "$RESOLVED" "$MIRROR_CACHE" "$CANARY_ROOT/mirror-root" "$MIRROR_PORT" "$(target)")
  export_env MIRROR_PID "$pid"
  curl -fsS "$MIRROR_URL/app/latest.json" >"$CANARY_OUT/mirror-app-latest.json"
}

install_app() {
  # The published installer, as a person runs it; only the release root is ours.
  # This runs herdr's live install.sh (and the core's, which it pipes to sh):
  # the job that runs it must never be given a secret.
  local script=$RESOLVED/app/install.sh version
  sha256sum "$script" | tee "$CANARY_OUT/install.sh.sha256" >&2
  sha256sum "$RESOLVED/core/install.sh" | tee "$CANARY_OUT/core-install.sh.sha256" >&2
  # Provenance: the manifests exactly as releases.herdr.dev served them.
  cp -f "$RESOLVED/app/latest.json" "$CANARY_OUT/upstream-app-latest.json"
  cp -f "$RESOLVED/core/latest.json" "$CANARY_OUT/upstream-core-latest.json"
  HERDR_RELEASES_URL=$MIRROR_URL sh "$script" </dev/null 2>&1 | tee "$CANARY_OUT/install.log" >&2
  # install.sh does not fail when the core step fails (it says so and goes on).
  command -v herdr-app >/dev/null || die "herdr-app is not on PATH after install.sh"
  command -v herdr-core >/dev/null || die "herdr-core is not on PATH after install.sh"
  command -v hc >/dev/null || die "hc is not on PATH after install.sh"
  {
    echo "app: $(herdr-app --version)"
    echo "core: $(herdr-core --version)"
    echo "app manifest: $(jq -r .version "$RESOLVED/app/latest.json")"
    echo "core manifest: $(jq -r .version "$RESOLVED/core/latest.json")"
    echo "install.sh sha256: $(cut -d' ' -f1 "$CANARY_OUT/install.sh.sha256")"
    echo "core install.sh sha256: $(cut -d' ' -f1 "$CANARY_OUT/core-install.sh.sha256")"
  } | tee "$CANARY_OUT/versions-herdr.txt" >&2
  version=$(jq -er .version "$RESOLVED/app/latest.json")
  valid_version "$version" || die "app manifest has an unexpected version: $version"
  grep -qx "app: herdr-app $version" "$CANARY_OUT/versions-herdr.txt" ||
    die "installed app version does not match the current stable manifest"
  export_env HERDR_APP_VERSION "$version"
}

# CANARY_DISPLAY picks the X server the app runs on:
#   weston  weston --backend=headless --xwayland (herdr-app's scripts/sandbox)
#   xvfb    Xvfb, a plain virtual X server
display_up() {
  local d=""
  case ${CANARY_DISPLAY:-weston} in
    weston)
      weston --backend=headless --xwayland --socket=herdr-canary --width=1400 --height=900 \
        --log="$CANARY_OUT/weston.log" >/dev/null 2>&1 &
      export_env DISPLAY_PID "$!"
      # shellcheck disable=SC2317 # a poll predicate, called by name
      find_display() {
        d=$(grep -o 'xserver listening on display :[0-9]*' "$CANARY_OUT/weston.log" 2>/dev/null | grep -o ':[0-9]*$' || true)
        [[ -n $d ]]
      }
      poll 20 "Xwayland display from weston" find_display || { cat "$CANARY_OUT/weston.log" >&2; die "the display did not start"; }
      ;;
    xvfb)
      d=:${XVFB_DISPLAY_NUMBER:-99}
      Xvfb "$d" -screen 0 1400x900x24 -nolisten tcp >"$CANARY_OUT/xvfb.log" 2>&1 &
      export_env DISPLAY_PID "$!"
      ;;
    *) die "unknown CANARY_DISPLAY ${CANARY_DISPLAY}" ;;
  esac
  export_env DISPLAY "$d"
  # Xwayland starts on the first client; xdpyinfo is that client.
  # shellcheck disable=SC2317 # a poll predicate, called by name
  x_answers() { xdpyinfo -display "$d" >/dev/null 2>&1; }
  poll 20 "X server on $d" x_answers || die "X server on $d does not answer"
  xdpyinfo -display "$d" >"$CANARY_OUT/xdpyinfo.txt" 2>&1
  grep -q XTEST "$CANARY_OUT/xdpyinfo.txt" || die "the X server has no XTEST extension"
}

app_up() {
  local bin=$CANARY_ROOT/bin opener pid status space
  mkdir -p "$HERDR_APP_HOME" "$XDG_STATE_HOME" "$bin" "$CANARY_ROOT/space"
  # The first start's welcome would cover the window: mark it skipped, as a
  # person's click on Skip does (shared `frame.welcomed`).
  if [[ ! -f $HERDR_APP_HOME/shared.json ]]; then
    printf '{"frame.welcomed":"skipped"}\n' >"$HERDR_APP_HOME/shared.json.new"
    mv -f "$HERDR_APP_HOME/shared.json.new" "$HERDR_APP_HOME/shared.json"
  fi
  # This version already ran here: no "Updated to <v>" toast over the shots.
  if [[ ! -f $HERDR_APP_HOME/update-notes.json ]]; then
    valid_version "${HERDR_APP_VERSION:-}" || die "HERDR_APP_VERSION is not set by the install stage"
    jq -cn --arg v "$HERDR_APP_VERSION" '{last_run: $v, presented: []}' >"$HERDR_APP_HOME/update-notes.json.new"
    mv -f "$HERDR_APP_HOME/update-notes.json.new" "$HERDR_APP_HOME/update-notes.json"
  fi
  # Opening a link would reach a browser: log it instead.
  for opener in xdg-open open; do
    printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>%q\n' "$CANARY_OUT/opened.txt" >"$bin/$opener"
    chmod +x "$bin/$opener"
  done
  # HERDR_RELEASES_URL keeps the app's own update check on the mirror (same
  # version: nothing to update). WAYLAND_DISPLAY empty: the X11 path, Xwayland.
  PATH=$bin:$PATH WAYLAND_DISPLAY='' HERDR_RELEASES_URL=$MIRROR_URL HERDR_APP_LOG=${HERDR_APP_LOG:-info} \
    setsid herdr-app >"$CANARY_OUT/app.log" 2>&1 </dev/null &
  pid=$!
  export_env HERDR_APP_PID "$pid"
  # shellcheck disable=SC2317 # a poll predicate, called by name
  app_answers() {
    kill -0 "$pid" 2>/dev/null || { cat "$CANARY_OUT/app.log" >&2; die "herdr-app exited"; }
    herdr-app status >"$CANARY_OUT/status-first.json" 2>/dev/null
  }
  poll 60 "herdr-app status" app_answers || { cat "$CANARY_OUT/app.log" >&2; die "the window did not answer"; }
  cat "$CANARY_OUT/status-first.json" >&2
  # The app writes the host type declarations into its home on every start.
  local dts
  mkdir -p "$CANARY_OUT/app-home-types"
  for dts in herdr.d.ts gpui-kit.d.ts; do
    [[ -s $HERDR_APP_HOME/$dts ]] || die "the app did not write $dts into its home"
    cp -f "$HERDR_APP_HOME/$dts" "$CANARY_OUT/app-home-types/$dts"
  done
  # A fresh home has no space yet; tab.new would answer "no space yet".
  space=$(do_ok 30 space.new --name canary --folder "$CANARY_ROOT/space") || die "space.new failed"
  printf '%s\n' "$space" >"$CANARY_OUT/space-new.json"
  export_env HERDR_SPACE "$(jq -er .space <<<"$space")"
  status=$(herdr-app status)
  printf '%s\n' "$status" >"$CANARY_OUT/status-after-space.json"
  jq -e '.errors == []' >/dev/null <<<"$status" || die "status reports errors: $(jq -c .errors <<<"$status")"
}

stop_pid() {
  local pid=${1:-}
  [[ -n $pid ]] || return 0
  kill "$pid" 2>/dev/null || return 0
  # shellcheck disable=SC2317 # a poll predicate, called by name
  gone() { ! kill -0 "$pid" 2>/dev/null; }
  poll 10 "pid $pid to exit" gone || kill -9 "$pid" 2>/dev/null || true
}

teardown() {
  herdr-app shot "$CANARY_OUT/herdr-shot-final.png" >/dev/null 2>&1 || true
  herdr-app status >"$CANARY_OUT/status-final.json" 2>&1 || true
  cp -f "$HERDR_APP_HOME/data/hello-probe/probe.json" "$CANARY_OUT/hello-probe.json" 2>/dev/null || true
  herdr-app ls >"$CANARY_OUT/ls-final.json" 2>&1 || true
  hc ls --json >"$CANARY_OUT/hc-ls.json" 2>&1 || true
  stop_pid "${HERDR_APP_PID:-}"
  hc server stop >/dev/null 2>&1 || true
  stop_pid "${DISPLAY_PID:-}"
  stop_pid "${MIRROR_PID:-}"
}

case ${1:-} in
  preflight) run_stage S0-preflight infra preflight ;;
  resolve) run_stage S0-resolve infra resolve ;;
  mirror) run_stage S0-mirror infra mirror ;;
  install) run_stage S1-install product install_app ;;
  display) run_stage S4a-display infra display_up ;;
  app) run_stage S4b-app product app_up ;;
  teardown) teardown ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
