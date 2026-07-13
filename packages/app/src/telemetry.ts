import type { BattleResult, Lineup } from '@wrad/core';
import { CHANNEL } from './env';

// The publishable key is designed to be public: row-level security on the
// server allows inserts only — it cannot read, edit, or delete anything.
export const SUPABASE_URL = 'https://wvrllhiktnkvbpclmrpq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi';
const APP_VERSION = `0.6.8${CHANNEL === 'dev' ? '-dev' : ''}`;

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

/** Stable anonymous id for this device — shared by telemetry and the
 * leaderboard (which upserts best-per-device). */
export function deviceId(): string {
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
  // Runs from dev builds are never representative balance data.
  const dev = args.dev || CHANNEL === 'dev';
  try {
    fetch(`${SUPABASE_URL}/rest/v1/runs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ride_date: args.rideDate,
        device_id: deviceId(),
        lineup: args.lineup,
        waves_cleared: args.result.wavesCleared,
        score: args.result.score,
        dev,
        version: APP_VERSION,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never take the game down with it.
  }
}
