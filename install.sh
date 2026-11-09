#!/bin/sh
# Installs the Gas City mod into the Herdr desktop app:
#
#   curl -fsSL https://github.com/gastownhall/herdr-gascity/releases/latest/download/install.sh | sh
#
# A release's copy of this script downloads that release's mod tarball and
# checks it against the sha256 the script carries. Then it:
#   - runs `herdr-app check` on the new build before it replaces anything;
#   - moves an earlier install to <app home>/mod-backups/gascity-<time>/
#     (outside mods/: herdr loads every folder there) and puts the new one
#     in <app home>/mods/gascity/;
#   - when the app is open: opens a "Gas City" tab in a local space (making
#     one if there is none), shows it, and stores the gc program the mod runs
#     (gcBin) in its shared settings, retrying until the new copy answers.
# Every failed step prints why and exits non-zero.
#
# Options and environment: see usage below.
set -eu

# Stamped by the release workflow (scripts/package.ts); empty in the source copy.
release_version=''
release_sha256=''

releases=${HERDR_GASCITY_RELEASES_URL:-https://github.com/gastownhall/herdr-gascity/releases/download}
wait_s=${HERDR_GASCITY_WAIT:-15}
mod=gascity
tab_name="Gas City"

say() { printf 'gascity: %s\n' "$*"; }
fail() { printf 'gascity: %s\n' "$*" >&2; exit 1; }
usage_fail() { printf 'gascity: %s (see --help)\n' "$*" >&2; exit 2; }
usage() {
  cat <<'EOF'
Installs the Gas City mod into the Herdr desktop app.

usage: install.sh [--from <tarball>] [--gc-bin <gc>]

  --from <tarball>   install this tarball instead of downloading the
                     release's; it is checked against <tarball>.sha256 when
                     that file exists
  --gc-bin <gc>      the gc the mod runs: gc, or the absolute path to a
                     program named gc (default: the gc on this PATH)
  --help             this text

Environment:
  HERDR_APP_HOME              the app's home (default: ~/.config/herdr-app)
  HERDR_GASCITY_RELEASES_URL  where release tarballs are downloaded from
  HERDR_GASCITY_WAIT          seconds to wait for the new tab to answer (15)
EOF
}

from=""
gc_bin=""
gc_bin_given=0
while [ $# -gt 0 ]; do
  case $1 in
    --from)
      [ $# -ge 2 ] || usage_fail "--from needs a tarball"
      from=$2
      shift 2
      ;;
    --gc-bin)
      [ $# -ge 2 ] || usage_fail "--gc-bin needs a value"
      gc_bin=$2
      gc_bin_given=1
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) usage_fail "unknown option $1" ;;
  esac
done

# gcBin as the mod accepts it (src/discovery/settings.ts): "gc", or an
# absolute path to a program named gc, with no control characters.
gc_bin_issue() {
  if [ "$(printf '%s' "$1" | tr -d '\000-\037\177')" != "$1" ]; then
    echo "has a control character"
    return
  fi
  case $1 in
    gc) ;;
    /gc | /*/gc)
      if [ ! -f "$1" ] || [ ! -x "$1" ]; then echo "is not an executable file"; fi
      ;;
    *) echo "must be gc or the absolute path to a program named gc" ;;
  esac
}

if [ "$gc_bin_given" = 1 ]; then
  issue=$(gc_bin_issue "$gc_bin")
  [ -z "$issue" ] || usage_fail "--gc-bin $gc_bin: $issue"
else
  found=$(command -v gc 2>/dev/null || true)
  if [ -n "$found" ] && [ -z "$(gc_bin_issue "$found")" ]; then gc_bin=$found; fi
fi

command -v herdr-app >/dev/null 2>&1 ||
  fail "needs herdr-app on PATH; install Herdr first: curl -fsSL https://releases.herdr.dev/app/install.sh | sh"
command -v tar >/dev/null 2>&1 || fail "needs tar"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | sed 's/ .*//'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | sed 's/ .*//'
  else fail "needs sha256sum or shasum"; fi
}

if [ -n "${HERDR_APP_HOME:-}" ]; then home=$HERDR_APP_HOME
else home=${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app; fi
mods=$home/mods

tmp=$(mktemp -d)
staged=""
trap 'rm -rf "$tmp"; if [ -n "$staged" ]; then rm -rf "$staged"; fi' EXIT

# ---- the tarball
tarball=$tmp/mod.tar.gz
if [ -n "$from" ]; then
  [ -f "$from" ] || fail "--from $from: no such file"
  cp "$from" "$tarball"
  if [ -f "$from.sha256" ]; then
    want=$(sed -n '1s/[[:space:]].*//p' "$from.sha256")
    [ "$(sha256 "$tarball")" = "$want" ] || fail "$from does not match $from.sha256 (checksum mismatch)"
    say "installing $from (sha256 checked)"
  else
    say "installing $from (no $from.sha256 next to it: not checked)"
  fi
else
  if [ -z "$release_version" ] || [ -z "$release_sha256" ]; then
    fail "this copy of install.sh is not from a release; run the release's: curl -fsSL https://github.com/gastownhall/herdr-gascity/releases/latest/download/install.sh | sh (or pass --from <tarball>)"
  fi
  command -v curl >/dev/null 2>&1 || fail "needs curl"
  url=$releases/v$release_version/gascity-mod-$release_version.tar.gz
  say "downloading Gas City mod $release_version"
  curl -fsSL --retry 3 --retry-delay 2 "$url" -o "$tarball" || fail "download failed: $url"
  [ "$(sha256 "$tarball")" = "$release_sha256" ] || fail "the download is damaged (checksum mismatch): $url"
fi

mkdir "$tmp/x"
tar -xzf "$tarball" -C "$tmp/x" || fail "cannot unpack the tarball"
for f in main.js mod.json; do
  [ -f "$tmp/x/$mod/$f" ] || fail "the tarball has no $mod/$f"
done
# The mod folder as herdr's install flow copies it: the recipe, the preview
# and the key fragment stay out of mods/.
mkdir "$tmp/$mod"
for f in "$tmp/x/$mod"/* "$tmp/x/$mod"/.[!.]*; do
  [ -e "$f" ] || continue
  case ${f##*/} in
    RECIPE.md | preview.png | keys.json) ;;
    *) cp -R "$f" "$tmp/$mod/" ;;
  esac
done

# ---- check, then swap
say "checking the build: herdr-app check"
herdr-app check "$tmp/$mod" || fail "herdr-app check failed; nothing was changed"

mkdir -p "$mods"
# A dot folder: herdr skips it while it is being filled.
staged=$mods/.$mod-install.$$
rm -rf "$staged"
cp -R "$tmp/$mod" "$staged"
if [ -e "$mods/$mod" ] || [ -L "$mods/$mod" ]; then
  backups=$home/mod-backups
  mkdir -p "$backups"
  backup=$backups/$mod-$(date -u +%Y%m%dT%H%M%SZ)
  n=1
  while [ -e "$backup" ]; do backup=$backups/$mod-$(date -u +%Y%m%dT%H%M%SZ)-$n; n=$((n + 1)); done
  mv "$mods/$mod" "$backup" || fail "cannot move the earlier install to $backup"
  say "the earlier install is in $backup"
fi
mv "$staged" "$mods/$mod" || fail "cannot move the new build into $mods/$mod"
staged=""
say "installed into $mods/$mod"

# ---- the open app
# `/` and most characters pass through the mod's command grammar as written;
# ":" separates arguments and "%" starts an escape, so those two are encoded.
encoded_gc_bin=$(printf '%s' "$gc_bin" | sed -e 's/%/%25/g' -e 's/:/%3A/g')
gc_bin_command="herdr-app do $mod.set-gc-bin:$encoded_gc_bin"

if ! herdr-app status >/dev/null 2>&1; then
  say "Herdr is not open. Once it is, open the mod with:"
  printf '  herdr-app do tab.new --mod %s --name "%s"\n' "$mod" "$tab_name"
  if [ -n "$gc_bin" ]; then
    say "and store the gc it runs (with the Gas City tab shown):"
    printf '  %s\n' "$gc_bin_command"
  fi
  exit 0
fi

# herdr-app do <command> [args]: the reply on stdout; a failure prints
# herdr's message and exits non-zero.
herdr_do() {
  if ! reply=$(herdr-app "do" "$@" 2>&1); then
    printf 'gascity: herdr-app do %s failed:\n%s\n' "$*" "$reply" >&2
    exit 1
  fi
}

# field <json> <key>: a string field of a herdr-app reply.
field() { printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\": *\"\\([^\"]*\\)\".*/\\1/p"; }

# The local spaces in `herdr-app ls`, the active one first: "<id>" lines.
# A small JSON reader (no jq): spaces[].id where machine is null.
local_spaces() {
  awk '
    { text = text $0 "\n" }
    END {
      n = length(text); depth = 0; expect_key = 0; top = ""
      for (i = 1; i <= n; i++) {
        c = substr(text, i, 1)
        if (c == "\"") {
          s = ""
          for (i++; i <= n; i++) {
            c = substr(text, i, 1)
            if (c == "\\") { s = s c substr(text, i + 1, 1); i++; continue }
            if (c == "\"") break
            s = s c
          }
          if (expect_key) { key[depth] = s; if (depth == 1) top = s; expect_key = 0 }
          else if (depth == 3 && top == "spaces") {
            if (key[3] == "id") id = s
            if (key[3] == "machine") machine = s
          }
        } else if (c == "{") {
          depth++; type[depth] = "{"; expect_key = 1
          if (depth == 3 && top == "spaces") { id = ""; machine = ""; active = "" }
        } else if (c == "[") {
          depth++; type[depth] = "["; expect_key = 0
        } else if (c == "}") {
          if (depth == 3 && top == "spaces" && id != "" && machine == "") {
            if (active == "true") first = first id "\n"; else rest = rest id "\n"
          }
          depth--; expect_key = 0
        } else if (c == "]") {
          depth--; expect_key = 0
        } else if (c == ",") {
          expect_key = (type[depth] == "{")
        } else if (c ~ /[a-z]/) {
          word = c
          while (substr(text, i + 1, 1) ~ /[a-z]/) { i++; word = word substr(text, i, 1) }
          if (depth == 3 && top == "spaces" && key[3] == "active") active = word
        }
      }
      printf "%s%s", first, rest
    }'
}

new_space() {
  herdr_do space.new
  space=$(field "$reply" space)
  [ -n "$space" ] || fail "space.new gave no space id: $reply"
}

if ! reply=$(herdr-app ls 2>&1); then
  printf 'gascity: herdr-app ls failed:\n%s\n' "$reply" >&2
  exit 1
fi
space=$(printf '%s\n' "$reply" | local_spaces | sed -n 1p)
[ -n "$space" ] || new_space

if ! reply=$(herdr-app "do" tab.new --mod "$mod" --name "$tab_name" --space "$space" 2>&1); then
  case $reply in
    *"no space yet"*)
      new_space
      herdr_do tab.new --mod "$mod" --name "$tab_name" --space "$space"
      ;;
    *)
      printf 'gascity: herdr-app do tab.new failed:\n%s\n' "$reply" >&2
      exit 1
      ;;
  esac
fi
tab=$(field "$reply" tab)
[ -n "$tab" ] || fail "tab.new gave no tab id: $reply"
say "opened a \"$tab_name\" tab ($tab) in space $space"

# Commands reach only a shown copy of the mod.
herdr_do tab.select --id "$tab"

if [ -z "$gc_bin" ]; then
  say "no gc on this PATH: the mod runs \`gc\` from Herdr's PATH. To name another, run this again with --gc-bin <path>"
else
  # The new copy loads asynchronously: until it does, herdr answers that no
  # copy of the mod listens.
  deadline=$(($(date +%s) + wait_s))
  while :; do
    if reply=$(herdr-app "do" "$mod.set-gc-bin:$encoded_gc_bin" 2>&1) &&
      printf '%s' "$reply" | tr -d ' \n' | grep -q '"ok":true'; then
      break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      printf 'gascity: the Gas City tab did not answer %s within %ss; herdr said:\n%s\n' "$mod.set-gc-bin" "$wait_s" "$reply" >&2
      exit 1
    fi
    sleep 0.25
  done
  say "gcBin is $gc_bin"
fi

say "done. Keys: add \"ctrl-alt-g\": \"mod.open:gascity\" under \"global\" in $home/keys.json to open the \"needs you\" window."
