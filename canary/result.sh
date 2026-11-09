#!/usr/bin/env bash
# result.sh <required stage>...: writes out/spike-result.json from
# out/stages.jsonl and the versions files. The run passed when every required
# stage ran and none failed; other stages that failed are listed as optional.
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

stages=$CANARY_OUT/stages.jsonl
[[ -f $stages ]] || : >"$stages"
version() { sed -n "s/^$1: //p" "$CANARY_OUT/versions-herdr.txt" 2>/dev/null | head -n1 | awk "{ print \$NF }"; }
jq -s \
  --arg ui_version "$(version app)" \
  --arg core_version "$(version core)" \
  --arg platform "${RUNNER_OS:-$(uname -s)}-${RUNNER_ARCH:-$(uname -m)} $(. /etc/os-release 2>/dev/null && echo "$VERSION_ID")" \
  --arg run_url "${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}" \
  --argjson expected "$(jq -cn --args '$ARGS.positional' "$@")" \
  '. as $s
   | ($s | map(select(.rc != 0 and (.stage | IN($expected[])))) | first) as $failed
   | ($expected - ($s | map(.stage))) as $missing
   | {ui: "herdr-app", ui_version: $ui_version, core_version: $core_version,
      platform: $platform, run_url: $run_url,
      passed: ($failed == null and ($missing | length) == 0),
      failed_stage: ($failed.stage // null), failure_class: ($failed.class // null),
      missing_stages: $missing,
      optional_failed: ($s | map(select(.rc != 0 and (.stage | IN($expected[]) | not)) | .stage)),
      duration_s: ($s | map(.duration_s) | add // 0),
      stages: $s}' "$stages" >"$CANARY_OUT/spike-result.json"
cat "$CANARY_OUT/spike-result.json"
jq -e .passed "$CANARY_OUT/spike-result.json" >/dev/null
