/**
 * Posts the nightly PvP league standings to the #wrad Discord channel as
 * RatKing (issue #162) — the same bot-token REST pattern
 * scripts/discord/post-patch-notes.sh already uses (one-way message post,
 * no Interactions Endpoint involved, unlike supabase/functions/discord-feedback).
 */
import type { ResultRow } from './pvp-league';

const DISCORD_API = 'https://discord.com/api/v10';
// Mandatory: without it Cloudflare answers Discord REST with error 1010
// rather than anything useful (same gotcha post-patch-notes.sh documents).
const USER_AGENT = 'DiscordBot (https://github.com/JelleDenmark/we-ride-at-dawn, 1.0)';
// The #wrad TEXT channel in "Gamers Unite" — same default as post-patch-notes.sh.
const DEFAULT_CHANNEL_ID = '1524165668004560896';

export function pvpResultsEmbed(rideDate: string, rows: ResultRow[]) {
  const lines = rows.map((r, i) => {
    const sd = (r.survivor_diff >= 0 ? '+' : '') + r.survivor_diff;
    return `${i + 1}. **${r.name}** — ${r.points}pts (${r.wins}-${r.losses}-${r.draws}, ${sd})`;
  });
  return {
    embeds: [
      {
        title: `PvP League — night of ${rideDate}`,
        description: lines.join('\n') || '_No duels tonight — fewer than two riders queued._',
        color: 5793266,
        footer: { text: 'we ride at dawn · nightly PvP league' },
      },
    ],
  };
}

/** No-op (logs and returns) if DISCORD_BOT_TOKEN isn't set — same shape as
 * the SUPABASE_SERVICE_ROLE_KEY fallback above: missing secret degrades to
 * a skip, never a hard failure of the round job. */
export async function postPvpResults(rideDate: string, rows: ResultRow[]): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('No DISCORD_BOT_TOKEN set — skipping Discord post.');
    return;
  }
  const channelId = process.env.DISCORD_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(pvpResultsEmbed(rideDate, rows)),
  });
  if (!res.ok) {
    console.error(`Discord post failed: ${res.status} ${await res.text()}`);
  }
}
