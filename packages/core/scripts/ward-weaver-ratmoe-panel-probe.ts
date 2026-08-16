/**
 * THROWAWAY probe (2026-08-08): the RatMoe-vs-Well-Dressed-Rat matchup used
 * elsewhere is a total landslide (RatMoe wiped, healthA=0, at every N) —
 * per Hard Rule 3's own caution (see pvp-acolyte-vs-moe-probe.ts v1's
 * mistake), a landslide can mask whether a lever matters because the result
 * is dominated by something else entirely. This re-runs the SAME real
 * RatMoe board (md-rattyfock front held constant across N so no identity
 * confound on the tank itself) against the STANDARD non-landslide opponent
 * panel (bulk/swarm/glass/poison, pvp-relic-matrix.ts convention) to check
 * for cap-sensitivity outside the one landslide matchup already measured.
 */
import { simulateDuel } from '../src/duel';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

function homogeneous(defId: string, tier: number): Lineup {
  return { units: Array.from({ length: CAP }, () => ({ defId, tier, relicIds: [] as string[] })), teamRelicIds: [], combatCap: COMBAT_CAP };
}
function ratMoeWithN(n: number, tier: number): Lineup {
  const wards = Array.from({ length: n }, () => 'ward-weaver');
  const filler = Array.from({ length: 3 - n }, () => 'dire-rat');
  return {
    units: ['md-rattyfock', 'steel-whisker', ...wards, ...filler, 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'].map((defId) => ({
      defId,
      tier,
      relicIds: [] as string[],
    })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

const PANEL = [
  { label: 'bulk', defId: 'dire-rat' },
  { label: 'swarm', defId: 'brood-mother' },
  { label: 'glass', defId: 'gnawer' },
  { label: 'poison', defId: 'blight-witch' },
] as const;

console.log('=== Real RatMoe board (N ward-weaver swept 0-3) vs standard opponent panel, T3 ===\n');
for (const p of PANEL) {
  console.log(`-- vs ${p.label} (8x ${p.defId}) --`);
  const opp = homogeneous(p.defId, 3);
  for (const N of [0, 1, 2, 3]) {
    const ratMoe = ratMoeWithN(N, 3);
    const { events, result } = simulateDuel(ratMoe, opp);
    const battleStart = events.find((e) => e.type === 'battleStart');
    const mdId = battleStart && battleStart.type === 'battleStart' ? battleStart.horde[0].instanceId : undefined;
    let mdDamage = 0;
    let mdSurvived = true;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === mdId) {
        mdDamage += e.amount;
        if (e.remainingHealth <= 0) mdSurvived = false;
      }
    }
    console.log(
      `  N=${N} winner=${result.winner.padEnd(5)} healthA(ratmoe)=${String(result.healthA).padStart(4)} healthB(opp)=${String(result.healthB).padStart(4)} ` +
        `diff=${String(result.healthA - result.healthB).padStart(5)}  md-rattyfock dmg-taken=${String(mdDamage).padStart(4)} (${mdSurvived ? 'survived' : 'died'})`
    );
  }
  console.log('');
}
