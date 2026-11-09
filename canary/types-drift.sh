#!/usr/bin/env bash
# The herdr-app types-drift job's steps (.github/workflows/types-drift.yml).
# The release download, install and `herdr-app types` are the canary's own
# stages (bootstrap-linux.sh, spike-linux.sh types); these are the rest.
#
#   types-drift.sh decide     whether this run checks: always when dispatched
#                             and on the daily schedule; on the hourly schedule
#                             only for an app release not checked yet
#                             (CHECKED=true: its declarations are cached)
#   types-drift.sh check      type-check src/ against the generated
#                             declarations, diff the host surface src/ uses
#                             against the last checked release's, write the
#                             report to the job summary
#   types-drift.sh remember   put this release's declarations where the next
#                             run finds them (the cache path)
#
# Environment: HERDR_APP_VERSION (the installed release), HOST_TYPES_CACHE
# (the cache path), and for decide EVENT_NAME, SCHEDULE, DAILY_SCHEDULE,
# CHECKED.
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

GENERATED=$CANARY_OUT/types
HOST_TYPES_CACHE=${HOST_TYPES_CACHE:-$CANARY_ROOT/host-types}

decide() {
  local version=${HERDR_APP_VERSION:-} check=true reason
  valid_version "$version" || die "HERDR_APP_VERSION is not a release version: ${version:-unset}"
  case ${EVENT_NAME:-} in
    workflow_dispatch) reason="dispatched: checking herdr-app $version" ;;
    schedule)
      if [[ ${SCHEDULE:-} == "${DAILY_SCHEDULE:-}" ]]; then
        reason="daily check of herdr-app $version"
      elif [[ ${CHECKED:-} == true ]]; then
        check=false
        reason="herdr-app $version was already checked; nothing new"
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
  *) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
