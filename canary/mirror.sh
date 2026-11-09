#!/usr/bin/env bash
# A per-release local mirror of releases.herdr.dev, so herdr's published
# installer runs unchanged while the release server sees one download per
# release instead of one per CI run.
#
#   mirror.sh resolve <dir>           fetch app/core latest.json and both
#                                     install.sh scripts (small, uncounted) into
#                                     <dir>; print "app=<v> core=<v>" lines for
#                                     the cache key
#   mirror.sh fill <resolved> <cache> <target>
#                                     put the app and core tarballs for <target>
#                                     (e.g. linux-x86_64) into <cache>, checked
#                                     against the manifests' sha256; tarballs
#                                     already there and intact are kept
#   mirror.sh serve <resolved> <cache> <root> <port> <target>
#                                     lay out <root> like the release server
#                                     (manifests, install.sh, <target> tarballs),
#                                     with manifest URLs pointing at
#                                     http://127.0.0.1:<port>, and serve it
set -euo pipefail

upstream=${HERDR_UPSTREAM_RELEASES:-https://releases.herdr.dev}

fail() { printf 'mirror: %s\n' "$*" >&2; exit 1; }
fetch() { curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "$1" -o "$2"; }

# url_of <manifest> <target>, sha_of <manifest> <target>
url_of() { jq -er --arg t "$2" '.targets[$t].url' "$1"; }
sha_of() { jq -er --arg t "$2" '.targets[$t].sha256' "$1"; }

# A manifest URL as a path under the release root (only the upstream host can
# be mirrored; no "..", no characters outside a plain path).
rel_path() {
  local rel
  case $1 in
    "$upstream"/*) rel=${1#"$upstream"/} ;;
    *) fail "manifest URL $1 is not under $upstream" ;;
  esac
  [[ $rel =~ ^[A-Za-z0-9._/-]+$ && $rel != *..* ]] || fail "manifest URL $1 has an unexpected path"
  printf '%s\n' "$rel"
}

resolve() {
  local dir=$1
  mkdir -p "$dir/app" "$dir/core"
  fetch "$upstream/app/latest.json" "$dir/app/latest.json"
  fetch "$upstream/core/latest.json" "$dir/core/latest.json"
  fetch "$upstream/app/install.sh" "$dir/app/install.sh"
  fetch "$upstream/core/install.sh" "$dir/core/install.sh"
  local kind version
  for kind in app core; do
    version=$(jq -er .version "$dir/$kind/latest.json")
    [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "$kind manifest has an unexpected version: $version"
    printf '%s=%s\n' "$kind" "$version"
  done
}

fill() {
  local resolved=$1 cache=$2 target=$3 kind url sha rel
  for kind in app core; do
    url=$(url_of "$resolved/$kind/latest.json" "$target") || fail "no $kind build for $target"
    sha=$(sha_of "$resolved/$kind/latest.json" "$target")
    rel=$(rel_path "$url")
    if [[ -f $cache/$rel ]] && [[ $(sha256sum "$cache/$rel" | cut -d' ' -f1) == "$sha" ]]; then
      printf 'mirror: %s cached\n' "$rel" >&2
      continue
    fi
    mkdir -p "$(dirname "$cache/$rel")"
    printf 'mirror: downloading %s\n' "$url" >&2
    fetch "$url" "$cache/$rel.part"
    [[ $(sha256sum "$cache/$rel.part" | cut -d' ' -f1) == "$sha" ]] || fail "$rel: checksum mismatch"
    mv -f "$cache/$rel.part" "$cache/$rel"
  done
}

serve() {
  local resolved=$1 cache=$2 root=$3 port=$4 target=$5 kind base rel
  base="http://127.0.0.1:$port"
  rm -rf "$root"
  mkdir -p "$root"
  for kind in app core; do
    # Only the tarball this manifest lists for this target, nothing else cached.
    rel=$(rel_path "$(url_of "$resolved/$kind/latest.json" "$target")")
    mkdir -p "$(dirname "$root/$rel")"
    cp -f "$cache/$rel" "$root/$rel"
    mkdir -p "$root/$kind"
    cp -f "$resolved/$kind/install.sh" "$root/$kind/install.sh"
    jq --arg up "$upstream" --arg base "$base" \
      '.targets |= with_entries(.value.url |= (if startswith($up + "/") then $base + ltrimstr($up) else . end))' \
      "$resolved/$kind/latest.json" >"$root/$kind/latest.json"
  done
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >"${MIRROR_LOG:-/dev/null}" 2>&1 &
  printf '%s\n' "$!"
  for _ in $(seq 80); do
    curl -fsS "$base/app/latest.json" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  fail "the mirror did not start on $base"
}

case ${1:-} in
  resolve) resolve "$2" ;;
  fill) fill "$2" "$3" "$4" ;;
  serve) serve "$2" "$3" "$4" "$5" "$6" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
