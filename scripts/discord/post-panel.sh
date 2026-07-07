#!/usr/bin/env bash
# Post the feedback panel (embed + 3 buttons) to the target channel.
#
# DO NOT run this until the bot has been invited to the target server,
# otherwise Discord returns 403. Run it once, manually, after the invite.
set -euo pipefail

cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

# Target channel: override with `CHANNEL_ID=<id> ./post-panel.sh` or pass as $1.
# Must be a TEXT channel (a Forum channel cannot hold a panel message).
CHANNEL_ID="${1:-${CHANNEL_ID:-1524048153224155380}}"

read -r -d '' PAYLOAD <<'JSON' || true
{
  "embeds": [
    {
      "title": "We Ride at Dawn — Feedback & Support",
      "description": "Found a bug, have an idea, or a question? Pick a button below and fill in the short form. Your submission is posted here with its own thread so we can reply.",
      "color": 5793266
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        { "type": 2, "style": 1, "label": "🐛 Report Bug", "custom_id": "fb_bug" },
        { "type": 2, "style": 1, "label": "💬 Feedback / Idea", "custom_id": "fb_feedback" },
        { "type": 2, "style": 1, "label": "❓ Ask a Question", "custom_id": "fb_question" }
      ]
    }
  ]
}
JSON

echo "Posting feedback panel to channel $CHANNEL_ID"
curl -sS -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: DiscordBot (https://github.com/JelleDenmark/we-ride-at-dawn, 1.0)" \
  -d "${PAYLOAD}" \
  -w $'\n--- HTTP %{http_code} ---\n'
