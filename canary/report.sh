#!/usr/bin/env bash
# report.sh: the canary workflow's report job (.github/workflows/canary.yml).
# Writes the job summary from each planned run's canary-result.json, the
# soak's product-stage flake rate, and on a product failure files or updates
# one issue.
#
# The results come from jobs that run downloaded code, so nothing in them is
# trusted:
#   - exactly one result per planned run is read: results/canary-<run>-<attempt>/
#     (or results/ itself when one run was planned: download-artifact puts a
#     single artifact there); anything else under results/ is ignored;
#   - every field is checked against what result.sh writes (enums, version
#     patterns) before it reaches the summary or an issue; a result that is
#     not JSON, or has a field outside that, is reported by field name only
#     and fails the step, and no issue is filed from it;
#   - an issue is filed only on the default branch, and only an open issue
#     with this workflow's label that the Actions bot opened is updated.
#
# Environment: RESULTS (the download directory), PLANNED (JSON array of run
# numbers), ATTEMPT, CANARY_STAGES, SOAK, EVENT, REASON, RUN_URL, REPO, REF,
# DEFAULT_BRANCH, GITHUB_STEP_SUMMARY; gh reads GH_TOKEN.
set -euo pipefail

LABEL=canary-failure
TITLE="Nightly canary: product-stage failure"
BOT="github-actions[bot]"

summary=${GITHUB_STEP_SUMMARY:?}
stages=$(jq -cn --arg s "${CANARY_STAGES:?}" '$s | split(" ") | map(select(. != ""))')

# The names of the fields outside what result.sh writes, in a fixed order.
# shellcheck disable=SC2016 # jq program
CHECK='
  def semver_or_empty: type == "string" and test("^([0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.]+)?)?$");
  def nullable(f): . == null or f;
  [ ["passed", (.passed | type == "boolean")],
    ["product_failure", (.product_failure | type == "boolean")],
    ["failed_stage", (.failed_stage | nullable(type == "string" and IN($stages[])))],
    ["failure_class", (.failure_class | nullable(IN("infra", "product", "gc", "integration", "ui")))],
    ["failure_reason", (.failure_reason | nullable(IN("stage-failed", "step-timeout", "not-reached")))],
    ["ui_version", (.ui_version | semver_or_empty)],
    ["core_version", (.core_version | semver_or_empty)],
    ["gc_version", (.gc_version | type == "string" and test("^([A-Za-z0-9.+_-]{1,40}( \\([0-9a-f]{7,40}\\))?)?$"))],
    ["integration_version", (.integration_version | type == "string" and test("^([A-Za-z0-9._/-]{1,100}@[0-9a-f]{40})?$"))],
    ["duration_s", (.duration_s | type == "number" and . >= 0)]
  ] | map(select(.[1] | not) | .[0])'

# One record per planned run: {run, state: ok|missing|unreadable, why?, r?}.
records='[]'
planned=$(jq -r '.[]' <<<"${PLANNED:?}")
count=$(jq length <<<"$PLANNED")
for n in $planned; do
  [[ $n =~ ^[0-9]+$ ]] || { echo "PLANNED holds a non-number: $n" >&2; exit 2; }
  file=$RESULTS/canary-$n-${ATTEMPT:?}/canary-result.json
  [[ -f $file || $count -ne 1 ]] || file=$RESULTS/canary-result.json
  if [[ ! -f $file ]]; then
    rec=$(jq -cn --argjson n "$n" '{run: $n, state: "missing"}')
  elif ! body=$(jq -c 'if type == "object" then . else error("not an object") end' "$file" 2>/dev/null); then
    rec=$(jq -cn --argjson n "$n" '{run: $n, state: "unreadable", why: "result is not JSON"}')
  else
    bad=$(jq -r --argjson stages "$stages" "$CHECK | join(\", \")" <<<"$body")
    if [[ -n $bad ]]; then
      rec=$(jq -cn --argjson n "$n" --arg bad "$bad" '{run: $n, state: "unreadable", why: ("invalid: " + $bad)}')
    else
      rec=$(jq -cn --argjson n "$n" --argjson r "$body" '{run: $n, state: "ok", r: $r}')
    fi
  fi
  records=$(jq -c --argjson rec "$rec" '. + [$rec]' <<<"$records")
done

missing=$(jq '[.[] | select(.state == "missing")] | length' <<<"$records")
unreadable=$(jq '[.[] | select(.state == "unreadable")] | length' <<<"$records")
product=$(jq '[.[] | select(.state == "ok" and .r.product_failure)] | length' <<<"$records")
{
  echo "## Herdr app canary (${EVENT:-}${REASON:+: $REASON})"
  echo
  echo "| run | passed | failed stage | class | reason | herdr-app | core | gc | duration |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  jq -r '.[] | if .state == "ok" then .r as $r
      | "| \(.run) | \($r.passed) | \($r.failed_stage // "") | \($r.failure_class // "") | \($r.failure_reason // "") | \($r.ui_version) | \($r.core_version) | \($r.gc_version) | \($r.duration_s | floor)s |"
    elif .state == "missing" then "| \(.run) | no result |  |  |  |  |  |  |  |"
    else "| \(.run) | unreadable | \(.why) |  |  |  |  |  |  |" end' <<<"$records"
  echo
  if (( missing > 0 )); then echo "**$missing run(s) wrote no result** (the job failed before the result step)."; fi
  if (( unreadable > 0 )); then echo "**$unreadable result(s) could not be read**: not filed as an issue; see the run's artifacts."; fi
  if [[ ${SOAK:-false} == true ]]; then
    echo "Soak: $product product-stage failure(s) in $count run(s): flake rate $(( product * 100 / count ))% (target under 2%)."
  fi
} >>"$summary"

rc=0
(( unreadable == 0 )) || rc=1
(( product > 0 )) || exit "$rc"

if [[ ${REF:-} != "refs/heads/${DEFAULT_BRANCH:?}" ]]; then
  echo "Not the default branch (${REF:-unset}): no issue filed." >>"$summary"
  exit 1
fi

body=$(jq -r --arg url "${RUN_URL:?}" '
  [.[] | select(.state == "ok" and .r.product_failure) | .r][0] as $f
  | "The Herdr app canary failed at stage `\($f.failed_stage)` (class \($f.failure_class)).\n\n"
    + "- run: \($url)\n- herdr-app \($f.ui_version), core \($f.core_version), gc \($f.gc_version), \($f.integration_version)\n"
    + "- artifacts: \($url)#artifacts"' <<<"$records")

gh label create "$LABEL" --repo "${REPO:?}" --color B60205 --description "Filed by the nightly canary on a product-stage failure" --force >/dev/null
existing=$(gh api "repos/$REPO/issues?state=open&labels=$LABEL&creator=github-actions%5Bbot%5D&per_page=100" |
  jq -r --arg t "$TITLE" --arg bot "$BOT" 'map(select(.title == $t and .user.login == $bot and (has("pull_request") | not))) | first | .number // empty')
if [[ -n $existing ]]; then
  gh issue comment "$existing" --repo "$REPO" --body "$body" >/dev/null
  echo "Updated issue #$existing." >>"$summary"
else
  gh issue create --repo "$REPO" --title "$TITLE" --label "$LABEL" --body "$body" >/dev/null
  echo "Filed an issue." >>"$summary"
fi
exit "$rc"
