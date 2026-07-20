#!/usr/bin/env bash
# Post a message with inline image attachments (embeds referencing
# attachment://<filename>) to the #wrad channel as RatKing.
#
#   ./post-with-images.sh payload.json img1.png img2.png ...            # dry run
#   ./post-with-images.sh payload.json --post img1.png img2.png ...     # actually posts
#
# `payload.json` is a raw Discord message payload whose embeds reference
# images as `attachment://<basename of one of the image args>` — e.g. an
# embed with `"image": { "url": "attachment://pack-caller.png" }` pairs with
# an `img` arg `.../pack-caller.png`. Up to 10 files per Discord message.
#
# Sending is OPT-IN, same as post-patch-notes.sh. A missing --post is always
# a dry run.
set -euo pipefail

cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

CHANNEL_ID="${CHANNEL_ID:-1524165668004560896}"

PAYLOAD_FILE="${1:?usage: post-with-images.sh <payload.json> [--post] <img1> [img2 ...]}"
shift

MODE=""
if [ "${1:-}" = "--post" ]; then
  MODE="--post"
  shift
fi

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "error: no such payload file: $PAYLOAD_FILE" >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  echo "error: no image files given" >&2
  exit 1
fi

python -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$PAYLOAD_FILE" || {
  echo "error: $PAYLOAD_FILE is not valid JSON" >&2
  exit 1
}

if [ "$MODE" != "--post" ]; then
  echo "--- DRY RUN (pass --post to send) --- channel $CHANNEL_ID"
  echo "payload:"
  cat "$PAYLOAD_FILE"
  echo
  echo "attaching:"
  for f in "$@"; do echo "  $f -> attachment://$(basename "$f")"; done
  exit 0
fi

echo "Posting message with $# image(s) to channel $CHANNEL_ID"
CURL_ARGS=(-sS -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages"
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}"
  -H "User-Agent: DiscordBot (https://github.com/JelleDenmark/we-ride-at-dawn, 1.0)"
  -F "payload_json=<${PAYLOAD_FILE};type=application/json")

i=0
for f in "$@"; do
  CURL_ARGS+=(-F "files[$i]=@${f};filename=$(basename "$f");type=image/png")
  i=$((i + 1))
done

curl "${CURL_ARGS[@]}" -w $'\n--- HTTP %{http_code} ---\n'
