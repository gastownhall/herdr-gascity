# shellcheck shell=bash
# Shared helpers for the canary scripts (sourced, not run).
#
# Layout under CANARY_ROOT (default: $RUNNER_TEMP/herdr-canary, else /tmp):
#   out/            everything uploaded as the run's artifact
#   out/stages.jsonl  one line per stage: id, class, rc, duration_s
#   app-home/       HERDR_APP_HOME
#   state/          XDG_STATE_HOME (herdr-core's machines and terminals)
#   runtime/        XDG_RUNTIME_DIR when the runner has none
#   bin/            xdg-open/open shims (links are logged, never opened)

set -euo pipefail

CANARY_ROOT=${CANARY_ROOT:-${RUNNER_TEMP:-/tmp}/herdr-canary}
CANARY_OUT=$CANARY_ROOT/out
mkdir -p "$CANARY_OUT"

# The app and its core run on their own session, home and state: nothing here
# touches a real person's herdr.
export HC_SESSION=${HC_SESSION:-canary}
export HERDR_APP_HOME=${HERDR_APP_HOME:-$CANARY_ROOT/app-home}
export XDG_STATE_HOME=${XDG_STATE_HOME:-$CANARY_ROOT/state}
export HERDR_APP_NO_SOUND=1
export DO_NOT_TRACK=1
export PATH="$HOME/.local/bin:$PATH"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "FAIL: $*"; exit 1; }

# github_file_set <file> <name> <value>: appends name=value to a GitHub
# Actions command file in the delimited form, so no value can inject a second
# variable. Names are checked; values must be one line.
github_file_set() {
  local file=$1 name=$2 value=$3 delimiter
  [[ $name =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "bad variable name: $name"
  [[ $value != *$'\n'* ]] || die "$name: value has a newline"
  delimiter="canary_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >>"$file"
}

# Exports a variable for this script and for later workflow steps.
export_env() {
  export "$1=$2"
  if [[ -n ${GITHUB_ENV:-} ]]; then github_file_set "$GITHUB_ENV" "$1" "$2"; fi
}

# Sets a step output (for the cache key).
export_output() {
  if [[ -n ${GITHUB_OUTPUT:-} ]]; then github_file_set "$GITHUB_OUTPUT" "$1" "$2"; fi
}

# A release version as herdr's manifests give it: strict semver, nothing else.
valid_version() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; }

now() { date +%s.%N; }

# run_stage <id> <failure class> <function> [args...]: runs one stage in a
# subshell, records its outcome and duration in out/stages.jsonl, and keeps its
# exit code. Stages hand values to later steps through export_env.
run_stage() {
  local id=$1 class=$2 rc=0 start end
  shift 2
  start=$(now)
  log "stage $id: begin"
  # A subshell keeps errexit working inside the stage (it is off in `f || x`).
  set +e
  (set -e; "$@")
  rc=$?
  set -e
  end=$(now)
  jq -cn --arg id "$id" --arg class "$class" --argjson rc "$rc" \
    --argjson d "$(awk -v a="$start" -v b="$end" 'BEGIN { printf "%.1f", b - a }')" \
    '{stage: $id, class: $class, rc: $rc, duration_s: $d}' >>"$CANARY_OUT/stages.jsonl"
  log "stage $id: end rc=$rc"
  return "$rc"
}

# poll <seconds> <what> <command...>: retries the command until it succeeds or
# the deadline passes. Every wait in the canary is a poll with a deadline.
poll() {
  local seconds=$1 what=$2 deadline
  deadline=$(( $(date +%s) + seconds ))
  shift 2
  until "$@"; do
    if (( $(date +%s) >= deadline )); then
      log "timed out after ${seconds}s waiting for: $what"
      return 1
    fi
    sleep 0.25
  done
}

# do_ok <seconds> <command> [args...]: `herdr-app do` until the window answers
# without an error, or the deadline passes. Prints the last reply on stdout.
do_ok() {
  local seconds=$1 deadline reply rc
  shift
  deadline=$(( $(date +%s) + seconds ))
  for (( ; ; )); do
    rc=0
    reply=$(herdr-app "do" "$@" 2>&1) || rc=$?
    if (( rc == 0 )) && jq -e 'type == "object" and (has("error") | not)' >/dev/null 2>&1 <<<"$reply"; then
      printf '%s\n' "$reply"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      log "herdr-app do $* never answered ok in ${seconds}s; last reply (rc=$rc): $reply"
      printf '%s\n' "$reply"
      return 1
    fi
    sleep 0.25
  done
}

# The hello mod's probe (canary/hello-mod writes it).
hello_probe() { cat "$HERDR_APP_HOME/data/hello-probe/probe.json" 2>/dev/null; }

# probe_has [jq options] <filter>: true when the probe exists and the filter holds.
probe_has() { hello_probe | jq -e "$@" >/dev/null 2>&1; }
