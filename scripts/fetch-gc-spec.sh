#!/usr/bin/env bash
# Fetches gc's internal/api/openapi.json at a branch, tag or commit of
# gastownhall/gascity, read-only and without credentials (git ls-remote and
# raw.githubusercontent.com), and prints the commit it came from.
#
#   fetch-gc-spec.sh <ref> <out-file>     e.g. fetch-gc-spec.sh main openapi.json
set -euo pipefail

repo=https://github.com/gastownhall/gascity
path=internal/api/openapi.json

fail() { printf 'fetch-gc-spec: %s\n' "$*" >&2; exit 1; }

(( $# == 2 )) || { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ref=$1 out=$2
[[ $ref =~ ^[A-Za-z0-9._/-]+$ && $ref != *..* && $ref != -* ]] || fail "not a branch, tag or commit: $ref"

if [[ $ref =~ ^[0-9a-f]{40}$ ]]; then
  commit=$ref
else
  # A branch first; for a tag, the commit an annotated tag points at (^{}).
  refs=$(git ls-remote "$repo" "refs/heads/$ref" "refs/tags/$ref" "refs/tags/$ref^{}")
  commit=$(awk -v h="refs/heads/$ref" -v p="refs/tags/$ref^{}" -v t="refs/tags/$ref" '
    $2 == h { c[3] = $1 } $2 == p { c[2] = $1 } $2 == t { c[1] = $1 }
    END { for (i = 3; i >= 1; i--) if (c[i] != "") { print c[i]; exit } }' <<<"$refs")
  [[ $commit =~ ^[0-9a-f]{40}$ ]] || fail "$ref is not a branch or tag of $repo"
fi

curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "https://raw.githubusercontent.com/gastownhall/gascity/$commit/$path" -o "$out.part"
jq -e '(.openapi | type == "string") and (.paths | type == "object")' "$out.part" >/dev/null || fail "$path at $commit is not an OpenAPI document"
mv -f "$out.part" "$out"
printf '%s\n' "$commit"
