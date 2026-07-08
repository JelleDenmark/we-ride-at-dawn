#!/usr/bin/env bash
# Post a release/patch-notes message to the #wrad channel as RatKing.
#
#   ./post-patch-notes.sh notes.json            # dry run: prints the payload, sends nothing
#   ./post-patch-notes.sh notes.json --post     # actually posts
#
# `notes.json` is a raw Discord message payload, e.g.
#   { "embeds": [ { "title": "...", "description": "...", "color": 5793266 } ] }
#
# Sending is OPT-IN. A missing --post is always a dry run, so a mistaken
# invocation can never reach a public channel. Posting is not reversible in any
# meaningful sense — people read Discord in real time.
set -euo pipefail

cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

# The #wrad TEXT channel in "Gamers Unite". Override only for the test guild.
CHANNEL_ID="${CHANNEL_ID:-1524165668004560896}"

PAYLOAD_FILE="${1:?usage: post-patch-notes.sh <payload.json> [--post]}"
MODE="${2:-}"

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "error: no such payload file: $PAYLOAD_FILE" >&2
  exit 1
fi

# Fail loudly on malformed JSON *before* we touch the network.
python -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$PAYLOAD_FILE" || {
  echo "error: $PAYLOAD_FILE is not valid JSON" >&2
  exit 1
}

if [ "$MODE" != "--post" ]; then
  echo "--- DRY RUN (pass --post to send) --- channel $CHANNEL_ID"
  cat "$PAYLOAD_FILE"
  echo
  exit 0
fi

echo "Posting patch notes to channel $CHANNEL_ID"
# The User-Agent is mandatory: without it Cloudflare answers Discord REST with
# error 1010 rather than anything useful.
curl -sS -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: DiscordBot (https://github.com/JelleDenmark/we-ride-at-dawn, 1.0)" \
  --data-binary "@${PAYLOAD_FILE}" \
  -w $'\n--- HTTP %{http_code} ---\n'
