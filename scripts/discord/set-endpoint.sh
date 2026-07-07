#!/usr/bin/env bash
# Register the Supabase Edge Function as Discord's Interactions Endpoint URL.
#
# IMPORTANT: Discord immediately sends a PING to the URL when this is set.
# The PATCH FAILS unless the function is already deployed and verifying
# signatures correctly. A successful response echoes the application object
# with "interactions_endpoint_url" set.
set -euo pipefail

cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

ENDPOINT_URL="https://wvrllhiktnkvbpclmrpq.supabase.co/functions/v1/discord-feedback"

echo "Setting interactions endpoint to: $ENDPOINT_URL"
curl -sS -X PATCH "https://discord.com/api/v10/applications/@me" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"interactions_endpoint_url\":\"${ENDPOINT_URL}\"}" \
  -w $'\n--- HTTP %{http_code} ---\n'
