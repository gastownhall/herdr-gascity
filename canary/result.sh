#!/usr/bin/env bash
# result.sh <required stage>...: writes out/$CANARY_RESULT (default
# spike-result.json) from out/stages-begun.jsonl, out/stages.jsonl and the
# versions files, prints it, and exits non-zero unless the run passed.
#
# The run passed when every required stage ran and none failed. Otherwise
# the failure is the first required stage, in the order given, that
#   - recorded a non-zero exit       failure_reason "stage-failed", its own class;
#   - began but recorded no end      "step-timeout", class infra: Actions killed
#                                    the step at its timeout-minutes before the
#                                    stage could record (a hung apt, a stalled
#                                    download), and a stage's own deadlines are
#                                    always shorter than its step's timeout;
#   - never began                    "not-reached", class infra: nothing failed
#                                    before it, so a workflow step that is not a
#                                    stage (checkout, toolchain setup) did.
# product_failure is true when the failure's class is anything but infra.
# Stages outside the required list that failed are listed as optional_failed.
#
# Optional environment: CANARY_LANE (main or release), CANARY_INTEGRATION_VERSION
# (the mod's version or commit), CANARY_RESULT (the file name under out/).
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

result=$CANARY_OUT/${CANARY_RESULT:-spike-result.json}
[[ $result == "$CANARY_OUT"/*.json && $(basename "$result") =~ ^[a-z0-9-]+\.json$ ]] || die "CANARY_RESULT is not a plain .json name"
ended=$CANARY_OUT/stages.jsonl
begun=$CANARY_OUT/stages-begun.jsonl
[[ -f $ended ]] || : >"$ended"
[[ -f $begun ]] || : >"$begun"
version() { sed -n "s/^$1: //p" "$CANARY_OUT/versions-herdr.txt" 2>/dev/null | head -n1 | awk "{ print \$NF }"; }
gc_version() { sed -n 's/^gc: //p' "$CANARY_OUT/versions-gc.txt" 2>/dev/null | head -n1; }
run_url="${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
jq -n \
  --slurpfile ended "$ended" \
  --slurpfile begun "$begun" \
  --arg ui_version "$(version app)" \
  --arg core_version "$(version core)" \
  --arg integration_version "${CANARY_INTEGRATION_VERSION:-}" \
  --arg gc_version "$(gc_version)" \
  --arg lane "${CANARY_LANE:-}" \
  --arg platform "${RUNNER_OS:-$(uname -s)}-${RUNNER_ARCH:-$(uname -m)} $(. /etc/os-release 2>/dev/null && echo "$VERSION_ID")" \
  --arg run_url "$run_url" \
  --argjson expected "$(jq -cn --args '$ARGS.positional' "$@")" \
  '($ended | map({key: .stage, value: .}) | from_entries) as $end
   | ($begun | map(.stage)) as $began
   | [ $expected[]
       | . as $id
       | if $end[$id] != null then
           (if $end[$id].rc != 0 then {stage: $id, class: $end[$id].class, reason: "stage-failed"} else empty end)
         elif ($began | index($id)) != null then {stage: $id, class: "infra", reason: "step-timeout"}
         else {stage: $id, class: "infra", reason: "not-reached"}
         end ] as $failures
   | ($failures | first) as $failed
   | {ui: "herdr-app", ui_version: $ui_version, core_version: $core_version,
      integration: "herdr-gascity", integration_version: $integration_version,
      gc_version: $gc_version, lane: $lane,
      platform: $platform, run_url: $run_url, artifacts_url: ($run_url + "#artifacts"),
      started_at: ($begun | map(.started_at) | min),
      passed: ($failed == null),
      failed_stage: ($failed.stage // null), failure_class: ($failed.class // null),
      failure_reason: ($failed.reason // null),
      product_failure: ($failed != null and $failed.class != "infra"),
      missing_stages: ($expected - ($ended | map(.stage))),
      optional_failed: ($ended | map(select(.rc != 0 and (.stage | IN($expected[]) | not)) | .stage)),
      duration_s: ($ended | map(.duration_s) | add // 0),
      stages: $ended}' >"$result"
cat "$result"
jq -e .passed "$result" >/dev/null
