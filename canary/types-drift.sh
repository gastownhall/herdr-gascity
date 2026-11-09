#!/usr/bin/env bash
# The herdr-app types-drift job's steps (.github/workflows/types-drift.yml).
# The release download, install and `herdr-app types` are the canary's own
# stages (bootstrap-linux.sh, spike-linux.sh types); these are the rest.
#
#   types-drift.sh decide     whether this run checks: always when dispatched
#                             and on the daily schedule; on the hourly schedule
#                             only an app release with no recorded result. A
#                             release whose last result is a failure fails
#                             the hourly run at once, until a check passes
#   types-drift.sh check      type-check src/ against the generated
#                             declarations, diff the host surface src/ uses
#                             against the last checked release's, write the
#                             report to the job summary
#   types-drift.sh remember   put this release's declarations where the next
#                             run finds them (the cache path)
#   types-drift.sh record <pass|fail>
#                             record this run's result for the release (the
#                             result cache path, a new entry per run: cache
#                             entries cannot be overwritten)
#
# Environment: HERDR_APP_VERSION (the installed release), HOST_TYPES_CACHE
# and HOST_RESULT_CACHE (the cache paths), and for decide EVENT_NAME,
# SCHEDULE, DAILY_SCHEDULE. HOST_RESULT_CACHE holds VERSION and RESULT
# (pass or fail) of the latest recorded check, restored before decide.
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

GENERATED=$CANARY_OUT/types
HOST_TYPES_CACHE=${HOST_TYPES_CACHE:-$CANARY_ROOT/host-types}
HOST_RESULT_CACHE=${HOST_RESULT_CACHE:-$CANARY_ROOT/host-result}

# The recorded result of the last check of this release: pass, fail, or empty.
last_result() {
  local version=$1 recorded result
  [[ -f $HOST_RESULT_CACHE/RESULT ]] || return 0
  recorded=$(<"$HOST_RESULT_CACHE/VERSION")
  result=$(<"$HOST_RESULT_CACHE/RESULT")
  [[ $recorded == "$version" ]] || die "the restored result is for herdr-app $recorded, not $version"
  [[ $result == pass || $result == fail ]] || die "the restored result is neither pass nor fail: $result"
  printf '%s\n' "$result"
}

decide() {
  local version=${HERDR_APP_VERSION:-} check=true reason last rc=0
  valid_version "$version" || die "HERDR_APP_VERSION is not a release version: ${version:-unset}"
  last=$(last_result "$version")
  case ${EVENT_NAME:-} in
    workflow_dispatch) reason="dispatched: checking herdr-app $version" ;;
    schedule)
      if [[ ${SCHEDULE:-} == "${DAILY_SCHEDULE:-}" ]]; then
        reason="daily check of herdr-app $version"
      elif [[ $last == pass ]]; then
        check=false
        reason="herdr-app $version passed its last check; nothing new"
      elif [[ $last == fail ]]; then
        # Stay red until a check passes: the artifact and summary of the run
        # that failed say why.
        check=false
        reason="herdr-app $version failed its last check; failing until a daily or dispatched check passes"
        rc=1
      else
        reason="new herdr-app release $version"
      fi
      ;;
    *) die "unexpected event: ${EVENT_NAME:-unset}" ;;
  esac
  log "$reason"
  export_output check "$check"
  export_output reason "$reason"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then printf '%s\n' "$reason" >>"$GITHUB_STEP_SUMMARY"; fi
  return "$rc"
}

record() {
  local version=${HERDR_APP_VERSION:-} result=${1:-}
  valid_version "$version" || die "HERDR_APP_VERSION is not a release version: ${version:-unset}"
  [[ $result == pass || $result == fail ]] || die "record takes pass or fail, not: ${result:-nothing}"
  rm -rf "$HOST_RESULT_CACHE"
  mkdir -p "$HOST_RESULT_CACHE"
  printf '%s\n' "$version" >"$HOST_RESULT_CACHE/VERSION"
  printf '%s\n' "$result" >"$HOST_RESULT_CACHE/RESULT"
}

check() {
  local version=${HERDR_APP_VERSION:-} previous rc=0
  local args=(--generated "$GENERATED" --version "$version" --report "$CANARY_OUT/types-drift.md" --surface "$CANARY_OUT/host-surface.json")
  valid_version "$version" || die "HERDR_APP_VERSION is not a release version: ${version:-unset}"
  [[ -s $GENERATED/gpui-kit.d.ts ]] || die "no generated declarations in $GENERATED"
  if [[ -s $HOST_TYPES_CACHE/gpui-kit.d.ts && -s $HOST_TYPES_CACHE/VERSION ]]; then
    previous=$(<"$HOST_TYPES_CACHE/VERSION")
    valid_version "$previous" || die "the cached declarations have a bad VERSION: $previous"
    args+=(--previous "$HOST_TYPES_CACHE" --previous-version "$previous")
    # The whole file's diff, for the artifact.
    diff -u --label "gpui-kit.d.ts (herdr-app $previous)" --label "gpui-kit.d.ts (herdr-app $version)" \
      "$HOST_TYPES_CACHE/gpui-kit.d.ts" "$GENERATED/gpui-kit.d.ts" >"$CANARY_OUT/gpui-kit.d.ts.diff" || true
  fi
  (cd "$repo" && bun run scripts/types-drift.ts "${args[@]}") || rc=$?
  if [[ -n ${GITHUB_STEP_SUMMARY:-} && -s $CANARY_OUT/types-drift.md ]]; then cat "$CANARY_OUT/types-drift.md" >>"$GITHUB_STEP_SUMMARY"; fi
  return "$rc"
}

remember() {
  local version=${HERDR_APP_VERSION:-}
  valid_version "$version" || die "HERDR_APP_VERSION is not a release version: ${version:-unset}"
  [[ -s $GENERATED/gpui-kit.d.ts ]] || die "no generated declarations in $GENERATED"
  rm -rf "$HOST_TYPES_CACHE"
  mkdir -p "$HOST_TYPES_CACHE"
  cp -f "$GENERATED/gpui-kit.d.ts" "$HOST_TYPES_CACHE/gpui-kit.d.ts"
  printf '%s\n' "$version" >"$HOST_TYPES_CACHE/VERSION"
}

case ${1:-} in
  decide) decide ;;
  check) run_stage T1-check product check ;;
  remember) remember ;;
  record) record "${2:-}" ;;
  *) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
