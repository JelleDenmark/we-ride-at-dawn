/**
 * THROWAWAY probe (2026-08-08): Ward-Weaver armor-stacking cap question,
 * against the STANDARD opponent panel (bulk=dire-rat, swarm=brood-mother,
 * glass=gnawer, poison=blight-witch — same PANEL as pvp-relic-matrix.ts /
 * pvp-unit-matrix.ts lens B), not just the one real RatMoe-vs-Well-Dressed-Rat
 * matchup. Carrier = N x Ward-Weaver + (8-N) x Dire-Rat (change-invariant
 * carrier convention from pvp-relic-matrix.ts), sweeping N=0..8 at T1/T2/T3,
 * to see where marginal survDiff from an extra Ward-Weaver caster saturates
 * (a real cap-not-sum budget would show as flat marginal beyond that N).
 */
import { simulateDuel } from '../src/duel';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import { MAX_TIER } from '../src/shop';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

const PANEL = [
  { label: 'bulk', defId: 'dire-rat' },
  { label: 'swarm', defId: 'brood-mother' },
  { label: 'glass', defId: 'gnawer' },
  { label: 'poison', defId: 'blight-witch' },
] as const;

function homogeneous(defId: string, tier: number): Lineup {
  return { units: Array.from({ length: CAP }, () => ({ defId, tier, relicIds: [] as string[] })), teamRelicIds: [], combatCap: COMBAT_CAP };
}

function carrierWithN(n: number, tier: number): Lineup {
  const units = [
    ...Array.from({ length: n }, () => ({ defId: 'ward-weaver', tier, relicIds: [] as string[] })),
    ...Array.from({ length: CAP - n }, () => ({ defId: 'dire-rat', tier, relicIds: [] as string[] })),
  ];
  return { units, teamRelicIds: [], combatCap: COMBAT_CAP };
}

function duel(a: Lineup, b: Lineup): { diff: number; won: boolean } {
  const { result } = simulateDuel(a, b);
  return { diff: result.healthA - result.healthB, won: result.winner === 'a' };
}

for (let tier = 1; tier <= MAX_TIER; tier++) {
  console.log(`\n=== Tier ${tier}: carrier = N x Ward-Weaver + (8-N) x Dire-Rat, vs opponent panel ===`);
  console.log(`N   ${PANEL.map((p) => p.label.padStart(10)).join('')}`);
  for (let n = 0; n <= 8; n++) {
    const board = carrierWithN(n, tier);
    const cells = PANEL.map((p) => {
      const { diff, won } = duel(board, homogeneous(p.defId, tier));
      return `${String(diff).padStart(9)}${won ? '*' : ' '}`;
    });
    console.log(`${String(n).padStart(1)}   ${cells.join('')}`);
  }
}
console.log('\n(* = side A / carrier wins that matchup outright)');
