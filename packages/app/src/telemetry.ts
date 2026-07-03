import type { BattleResult, Lineup } from '@wrad/core';

// Filled in once the Supabase project exists. The anon key is designed to be
// public (inserts only, enforced by row-level security on the server).
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
const APP_VERSION = '0.4.5';

const OPT_OUT_KEY = 'wrad-telemetry-opt-out';
const DEVICE_KEY = 'wrad-device-id';

export const telemetryConfigured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

export function telemetryEnabled(): boolean {
  return telemetryConfigured && localStorage.getItem(OPT_OUT_KEY) !== '1';
}

export function setTelemetryEnabled(on: boolean): void {
  if (on) localStorage.removeItem(OPT_OUT_KEY);
  else localStorage.setItem(OPT_OUT_KEY, '1');
}

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Fire-and-forget; never blocks or breaks the game if the network is down. */
export function submitRun(args: {
  rideDate: string;
  lineup: Lineup;
  result: BattleResult;
  dev: boolean;
}): void {
  if (!telemetryEnabled()) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/runs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ride_date: args.rideDate,
        device_id: deviceId(),
        lineup: args.lineup,
        waves_cleared: args.result.wavesCleared,
        score: args.result.score,
        dev: args.dev,
        version: APP_VERSION,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never take the game down with it.
  }
}
