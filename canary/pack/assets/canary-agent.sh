#!/bin/sh
# The canary agent: deterministic, no LLM, no credentials.
#
# It prints "CANARY READY <alias>", then reads the lines typed into its
# terminal (gc's submit types the text and Enter into a tmux session):
#
#   close <bead-id> [<nonce>]  prints "CANARY WORKING", closes the bead through
#                              the city's gc API with the reason
#                              "canary <nonce>" (or "canary"), then prints
#                              "CANARY DONE <bead-id> <nonce>", or
#                              "CANARY FAILED <why>"
#   anything else              prints "CANARY IGNORED"
#
# Control characters in a line are dropped first (gc's submit sends Escape
# before Enter).
#
# An agent may use the work API like any agent; the rule that every change
# goes through gc binds the UI, not the agent.
#
# Environment (set by the city, canary/city.toml.in): CANARY_API_URL, the gc
# API on loopback (http://127.0.0.1:<port>), and CANARY_CITY, the city's name.

set -u
set -f

say() {
	printf '%s\n' "$*"
}

alias_name=${GC_ALIAS:-${GC_SESSION_NAME:-${GC_SESSION_ID:-unknown}}}
say "CANARY READY $alias_name"

# Only plain ids go into the URL and the JSON body.
is_id() {
	case $1 in
	'' | -* | *[!A-Za-z0-9._-]*) return 1 ;;
	*) return 0 ;;
	esac
}

close_bead() {
	bead=$1
	nonce=$2
	if [ -z "${CANARY_API_URL:-}" ] || [ -z "${CANARY_CITY:-}" ]; then
		say "CANARY FAILED CANARY_API_URL and CANARY_CITY must be set"
		return
	fi
	case $CANARY_API_URL in
	http://127.0.0.1:* | http://localhost:* | http://\[::1\]:*) ;;
	*)
		say "CANARY FAILED CANARY_API_URL is not a loopback http URL"
		return
		;;
	esac
	if ! is_id "$CANARY_CITY"; then
		say "CANARY FAILED CANARY_CITY is not a plain name"
		return
	fi
	reason="canary${nonce:+ $nonce}"
	say "CANARY WORKING $bead"
	if out=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
		-X POST \
		-H 'Content-Type: application/json' \
		-H 'X-GC-Request: herdr-gascity-canary-agent' \
		--data "{\"reason\":\"$reason\"}" \
		"$CANARY_API_URL/v0/city/$CANARY_CITY/bead/$bead/close" 2>&1); then
		case $out in
		2??) say "CANARY DONE $bead${nonce:+ $nonce}" ;;
		*) say "CANARY FAILED close $bead: HTTP $out" ;;
		esac
	else
		say "CANARY FAILED close $bead: $out"
	fi
}

while IFS= read -r line; do
	# gc's submit may send control keys around the text (Escape before
	# Enter): only the printable text counts.
	line=$(printf '%s' "$line" | tr -d '\000-\037\177')
	# Word-split the line (globbing is off).
	# shellcheck disable=SC2086
	set -- $line
	if [ "${1:-}" = close ] && { [ $# -eq 2 ] || [ $# -eq 3 ]; } && is_id "$2" && { [ $# -eq 2 ] || is_id "$3"; }; then
		close_bead "$2" "${3:-}"
	else
		say "CANARY IGNORED"
	fi
done
say "CANARY EOF"
