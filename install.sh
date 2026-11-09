#!/bin/sh
# Installs the Gas City mod into the Herdr desktop app:
#
#   curl -fsSL https://github.com/gastownhall/herdr-gascity/releases/latest/download/install.sh | sh
#
# A release's copy of this script downloads that release's mod tarball and
# checks it against the sha256 the script carries. Then it:
#   - refuses a tarball holding anything but plain files and folders inside
#     its own tree (no links, devices, absolute paths or "..");
#   - runs `herdr-app check` on the new build before it replaces anything;
#   - moves an earlier install to <app home>/mod-backups/gascity-<time>/
#     (outside mods/: herdr loads every folder there) and puts the new one
#     in <app home>/mods/gascity/ (the earlier one goes back if that fails);
#   - when the app is open: shows the Gas City tab (if the mod in it answers),
#     or opens one in a local space (making one if there is none; retrying until herdr has noticed
#     the new folder), and stores the gc program the mod runs (gcBin) in its
#     shared settings, retrying until the copy answers.
# Every failed step prints why and exits non-zero.
#
# Everything runs from `main "$@"` on the last line, so a download cut short
# runs nothing. Options and environment: see usage below.
set -eu

# Stamped by the release workflow (scripts/package.ts); empty in the source copy.
release_version=''
release_sha256=''

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

# The sha256 program, chosen once, before anything is downloaded.
sha256_tool() {
  if command -v sha256sum >/dev/null 2>&1; then sha_cmd="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then sha_cmd="shasum -a 256"
  else fail "needs sha256sum or shasum (neither is on PATH)"; fi
}
sha256() { $sha_cmd "$1" | sed 's/ .*//'; }

# check_members <tarball>: every member a plain file or folder under the
# tarball's own tree; anything else is refused before tar writes a byte.
check_members() {
  tar -tzf "$1" >"$tmp/names" || fail "cannot read the tarball"
  while IFS= read -r name; do
    case $name in
      /* | .. | ../* | */.. | */../*) fail "refused: tarball member \"$name\" points outside its folder" ;;
    esac
  done <"$tmp/names"
  tar -tvzf "$1" >"$tmp/list" || fail "cannot read the tarball"
  while IFS= read -r line; do
    case $line in
      -* | d*) ;;
      *) fail "refused: tarball member is not a plain file or folder: $line" ;;
    esac
  done <"$tmp/list"
}

# Gets the tarball into $tmp/mod.tar.gz, checked, and unpacks the mod folder
# (without the recipe, the preview and the key fragment, as herdr's own
# install flow copies it) into $tmp/$mod.
fetch_and_unpack() {
  tarball=$tmp/mod.tar.gz
  if [ -n "$from" ]; then
    [ -f "$from" ] || fail "--from $from: no such file"
    cp "$from" "$tarball"
    if [ -f "$from.sha256" ]; then
      want=$(sed -n '1{s/[[:space:]].*//;p;}' "$from.sha256")
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

  check_members "$tarball"
  mkdir "$tmp/x"
  tar -xzf "$tarball" -C "$tmp/x" --no-same-owner || fail "cannot unpack the tarball"
  for f in main.js mod.json; do
    [ -f "$tmp/x/$mod/$f" ] || fail "the tarball has no $mod/$f"
  done
  mkdir "$tmp/$mod"
  for f in "$tmp/x/$mod"/* "$tmp/x/$mod"/.[!.]*; do
    [ -e "$f" ] || continue
    case ${f##*/} in
      RECIPE.md | preview.png | keys.json) ;;
      *) cp -R "$f" "$tmp/$mod/" ;;
    esac
  done
}

# Checks the unpacked build, then swaps it in; an earlier install goes to
# mod-backups/ and comes back if the new one cannot be moved into place.
check_and_swap() {
  say "checking the build: herdr-app check"
  herdr-app check "$tmp/$mod" || fail "herdr-app check failed; nothing was changed"

  mkdir -p "$mods"
  # A dot folder: herdr skips it while it is being filled.
  staged=$mods/.$mod-install.$$
  rm -rf "$staged"
  cp -R "$tmp/$mod" "$staged"
  backup=""
  if [ -e "$mods/$mod" ] || [ -L "$mods/$mod" ]; then
    backups=$home/mod-backups
    mkdir -p "$backups"
    backup=$backups/$mod-$(date -u +%Y%m%dT%H%M%SZ)
    n=1
    while [ -e "$backup" ]; do backup=$backups/$mod-$(date -u +%Y%m%dT%H%M%SZ)-$n; n=$((n + 1)); done
    mv "$mods/$mod" "$backup" || fail "cannot move the earlier install to $backup"
  fi
  if ! mv "$staged" "$mods/$mod"; then
    if [ -n "$backup" ] && mv "$backup" "$mods/$mod"; then
      fail "cannot move the new build into $mods/$mod; the earlier install is back in place"
    fi
    fail "cannot move the new build into $mods/$mod"
  fi
  staged=""
  [ -z "$backup" ] || say "the earlier install is in $backup"
  say "installed into $mods/$mod"
}

# herdr-app do <command> [args]: the reply in $reply; a failure prints
# herdr's message and exits non-zero.
herdr_do() {
  if ! reply=$(herdr-app "do" "$@" 2>&1); then
    printf 'gascity: herdr-app do %s failed:\n%s\n' "$*" "$reply" >&2
    exit 1
  fi
}

# field <json> <key>: a string field of a herdr-app reply.
field() { printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\": *\"\\([^\"]*\\)\".*/\\1/p"; }

# Reads `herdr-app ls` (a small JSON reader; no jq). Prints, for the spaces
# on this computer (machine null), the active one first:
#   S <space id>                  a local space
#   T <space id> <tab id>         a tab named "Gas City" holding no terminal
#                                 (the mod's own tab), in that space
read_ls() {
  awk -v want="$tab_name" '
    function close_space() {
      if (sid != "" && machine == "") {
        out = "S\t" sid "\n" tabs
        if (active == "true") first = first out; else rest = rest out
      }
    }
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
          else if (top == "spaces" && depth == 3) {
            if (key[3] == "id") sid = s
            if (key[3] == "machine") machine = s
          } else if (top == "spaces" && depth == 5 && key[3] == "tabs") {
            if (key[5] == "id") tid = s
            if (key[5] == "name") tname = s
          }
        } else if (c == "{") {
          depth++; type[depth] = "{"; expect_key = 1
          if (top == "spaces" && depth == 3) { sid = ""; machine = ""; active = ""; tabs = "" }
          if (top == "spaces" && depth == 5 && key[3] == "tabs") { tid = ""; tname = ""; terms = 0 }
          if (top == "spaces" && depth == 7 && key[5] == "terminals") terms++
        } else if (c == "[") {
          depth++; type[depth] = "["; expect_key = 0
        } else if (c == "}") {
          if (top == "spaces" && depth == 3) close_space()
          if (top == "spaces" && depth == 5 && key[3] == "tabs" && tid != "" && tname == want && terms == 0) tabs = tabs "T\t" sid "\t" tid "\n"
          depth--; expect_key = 0
        } else if (c == "]") {
          depth--; expect_key = 0
        } else if (c == ",") {
          expect_key = (type[depth] == "{")
        } else if (c ~ /[a-z]/) {
          word = c
          while (substr(text, i + 1, 1) ~ /[a-z]/) { i++; word = word substr(text, i, 1) }
          if (top == "spaces" && depth == 3 && key[3] == "active") active = word
        }
      }
      printf "%s%s", first, rest
    }'
}

new_space() {
  herdr_do space.new
  space=$(field "$reply" space)
  [ -n "$space" ] || fail "space.new gave no space id: $reply"
  made_space=1
}

# Reads `herdr-app ls`: $found_tab (with $found_space), a terminal-free tab
# named "Gas City" in a local space, maybe the mod's; $local_space, the
# local space a new tab goes to (empty: none).
find_tab() {
  if ! reply=$(herdr-app ls 2>&1); then
    printf 'gascity: herdr-app ls failed:\n%s\n' "$reply" >&2
    exit 1
  fi
  listing=$(printf '%s\n' "$reply" | read_ls)
  found_tab=$(printf '%s\n' "$listing" | awk -F '\t' '$1 == "T" { print $3; exit }')
  found_space=$(printf '%s\n' "$listing" | awk -F '\t' '$1 == "T" { print $2; exit }')
  local_space=$(printf '%s\n' "$listing" | awk -F '\t' '$1 == "S" { print $2; exit }')
}

# Sets $tab: a new Gas City tab in $local_space (made first if empty).
new_tab() {
  space=$local_space
  made_space=0
  [ -n "$space" ] || new_space

  # herdr notices the new folder in mods/ a moment later: until then tab.new
  # answers that there is no such mod. A space that closed since ls answers
  # "no space yet": make one, once.
  deadline=$(($(date +%s) + wait_s))
  until reply=$(herdr-app "do" tab.new --mod "$mod" --name "$tab_name" --space "$space" 2>&1); do
    case $reply in
      *"no space yet"*)
        if [ "$made_space" = 0 ]; then
          new_space
          continue
        fi
        ;;
      *"no mod "*"$mod"*" in mods/"*)
        if [ "$(date +%s)" -lt "$deadline" ]; then
          sleep 0.25
          continue
        fi
        ;;
    esac
    printf 'gascity: herdr-app do tab.new failed:\n%s\n' "$reply" >&2
    exit 1
  done
  tab=$(field "$reply" tab)
  [ -n "$tab" ] || fail "tab.new gave no tab id: $reply"
  say "opened a \"$tab_name\" tab ($tab) in space $space"
}

# answers <command>: sends `herdr-app do gascity.<command>` until a shown
# copy of the mod takes it, or $wait_s seconds pass (then false, the last
# answer in $reply). The copy loads asynchronously (and reloads after an
# upgrade): until it does, herdr answers that no copy of the mod listens.
answers() {
  deadline=$(($(date +%s) + wait_s))
  while :; do
    if reply=$(herdr-app "do" "$mod.$1" 2>&1) &&
      printf '%s' "$reply" | tr -d ' \n' | grep -q '"ok":true'; then
      return 0
    fi
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 0.25
  done
}

# What the installer sends to the shown copy: set-gc-bin, or, with no gcBin
# to set, refresh (only to learn whether the tab holds the mod).
first_command() {
  if [ -n "$gc_bin" ]; then echo "set-gc-bin:$encoded_gc_bin"; else echo refresh; fi
}

main() {
  releases=${HERDR_GASCITY_RELEASES_URL:-https://github.com/gastownhall/herdr-gascity/releases/download}
  wait_s=${HERDR_GASCITY_WAIT:-15}

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
  sha256_tool

  if [ -n "${HERDR_APP_HOME:-}" ]; then home=$HERDR_APP_HOME
  else home=${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app; fi
  mods=$home/mods

  tmp=$(mktemp -d)
  staged=""
  trap 'rm -rf "$tmp"; if [ -n "$staged" ]; then rm -rf "$staged"; fi' EXIT

  fetch_and_unpack
  check_and_swap

  # `/` and most characters pass through the mod's command grammar as
  # written; ":" separates arguments and "%" starts an escape, so those two
  # are encoded.
  encoded_gc_bin=$(printf '%s' "$gc_bin" | sed -e 's/%/%25/g' -e 's/:/%3A/g')

  if ! herdr-app status >/dev/null 2>&1; then
    say "Herdr is not open. Once it is, open the mod with:"
    printf '  herdr-app do tab.new --mod %s --name "%s"\n' "$mod" "$tab_name"
    if [ -n "$gc_bin" ]; then
      say "and store the gc it runs (with the Gas City tab shown):"
      # Quoted as one shell word, whatever the path holds.
      printf "  herdr-app do '%s'\n" "$(printf '%s' "$mod.set-gc-bin:$encoded_gc_bin" | sed "s/'/'\\\\''/g")"
    fi
    exit 0
  fi

  # Commands reach only a shown copy of the mod, so each tab is selected
  # first. A tab of that name holding no terminal is reused only if a copy of
  # the mod in it answers; herdr's listing does not say which mod a tab holds.
  find_tab
  answered=0
  if [ -n "$found_tab" ]; then
    tab=$found_tab
    herdr_do tab.select --id "$tab"
    if answers "$(first_command)"; then
      answered=1
      say "showed the \"$tab_name\" tab ($tab) already open in space $found_space"
    else
      say "the tab named \"$tab_name\" ($tab) did not answer as the mod; opening a new one"
    fi
  fi
  if [ "$answered" = 0 ]; then
    new_tab
    herdr_do tab.select --id "$tab"
    if [ -n "$gc_bin" ] && ! answers "$(first_command)"; then
      printf 'gascity: the Gas City tab did not answer %s within %ss; herdr said:\n%s\n' "$mod.set-gc-bin" "$wait_s" "$reply" >&2
      exit 1
    fi
  fi

  if [ -z "$gc_bin" ]; then
    say "no gc on this PATH: the mod runs \`gc\` from Herdr's PATH. To name another, run this again with --gc-bin <path>"
  else
    say "gcBin is $gc_bin"
  fi

  say "done. Keys: add \"ctrl-alt-g\": \"mod.open:gascity\" under \"global\" in $home/keys.json to open the \"needs you\" window."
}

main "$@"
