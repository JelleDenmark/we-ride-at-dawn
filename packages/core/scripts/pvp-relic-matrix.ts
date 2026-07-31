/**
 * PvP relic value matrix (issue #154) — OPPONENT-PANEL version.
 *
 * A single reference opponent is counter-pick BLIND. The first cut of this
 * script dueled every relic'd board against one 8x Dire-Rat board and read
 * Gore-Cleaver as dead — but cleave does nothing to a 5-HP body and everything
 * to a 1-HP one, so against a swarm it's the best relic in the game (the miss
 * that motivated this rewrite, Jesper 2026-07-31). Averaging that away hides
 * exactly the RPS texture the league wants.
 *
 * So each relic is now measured as its MARGINAL survivor-diff — what adding it
 * to a neutral 8x Dire-Rat carrier is worth — against a PANEL of opposing
 * archetypes that span the counter space:
 *
 *   bulk   = 8x Dire-Rat     high-HP / armored sponge (execute & raw stats shine)
 *   swarm  = 8x Brood-Mother  a cascade of low-HP summoned bodies (cleave/AoE shine)
 *   glass  = 8x Gnawer        3-atk / 1-HP glass cannons (cleave & first-kill shine)
 *   poison = 8x Blight-Witch  chip DoT that bypasses armor (sustain/bulk shine)
 *
 *   marginal_O(relic) = duel(carrier+relic, O).diff - duel(carrier, O).diff
 *
 * A relic that's flat across all four columns is generically useful; a big
 * SPREAD is a counter-pick (bring it against that archetype). A `*` on a number
 * marks where the relic FLIPS the duel — the bare carrier doesn't win that
 * matchup but the relic'd one does; the sharpest "this relic wins a fight you'd
 * otherwise lose" signal. The panel boards are synthetic archetype probes, not
 * tuned meta boards — they exist to exercise the axes, not to be fair fights.
 *
 * Determinism: duels have no RNG, so every number is exact. Read this next to
 * the PvE all-relic-value report to keep/cut on BOTH axes, never one alone.
 *
 * Run from the repo root:  npm run pvp:relics
 * (or from packages/core:  npx tsx scripts/pvp-relic-matrix.ts)
 */
import { simulateDuel } from '../src/duel';
import { RELIC_DEFS } from '../src/data/relics';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import { MAX_TIER } from '../src/shop';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;
const CARRIER = 'dire-rat';
const RELIC_IDS = Object.keys(RELIC_DEFS);

/** The opposing archetypes, spanning the counter space (see header). */
const PANEL = [
  { label: 'bulk', defId: 'dire-rat' },
  { label: 'swarm', defId: 'brood-mother' },
  { label: 'glass', defId: 'gnawer' },
  { label: 'poison', defId: 'blight-witch' },
] as const;

/** A full board of 8 copies of one unit, at `tier`, with realistic combatCap. */
function homogeneous(defId: string, tier: number): Lineup {
  return { units: Array.from({ length: CAP }, () => ({ defId, tier, relicIds: [] as string[] })), teamRelicIds: [], combatCap: COMBAT_CAP };
}

/** 8x Dire-Rat carrier, optionally with a unit relic on the FRONT clashing
 * slot (where cleave/execute/glass/weeping/tail are read off the live front
 * unit — see relic-value.ts) or a team relic board-wide. */
function carrier(tier: number, relic?: { id: string; scope: 'unit' | 'team' }): Lineup {
  const units = Array.from({ length: CAP }, (_, i) => ({
    defId: CARRIER,
    tier,
    relicIds: relic?.scope === 'unit' && i === 0 ? [relic.id] : ([] as string[]),
  }));
  return { units, teamRelicIds: relic?.scope === 'team' ? [relic.id] : [], combatCap: COMBAT_CAP };
}

function duel(a: Lineup, b: Lineup): { diff: number; won: boolean } {
  const { result } = simulateDuel(a, b);
  return { diff: result.healthA - result.healthB, won: result.winner === 'a' };
}

console.log('=== PvP RELIC MATRIX (issue #154) — marginal survDiff of one relic on an 8x Dire-Rat carrier, vs an opponent panel ===');
console.log(`${RELIC_IDS.length} relics x ${PANEL.length} archetypes (bulk/swarm/glass/poison), tiers 1..${MAX_TIER}. Deterministic. * = the relic flips that matchup to a win.\n`);

for (let tier = 1; tier <= MAX_TIER; tier++) {
  // Bare carrier vs each opponent — the per-column baseline, computed once.
  const bare = PANEL.map((p) => duel(carrier(tier), homogeneous(p.defId, tier)));

  interface Row {
    id: string;
    marg: number[];
    flip: boolean[];
    best: number; // max marginal across the panel
  }
  const rows: Row[] = RELIC_IDS.map((id) => {
    const def = RELIC_DEFS[id];
    const withRelic = PANEL.map((p) => duel(carrier(tier, { id, scope: def.scope }), homogeneous(p.defId, tier)));
    const marg = withRelic.map((w, i) => w.diff - bare[i].diff);
    const flip = withRelic.map((w, i) => w.won && !bare[i].won);
    return { id, marg, flip, best: Math.max(...marg) };
  });
  rows.sort((a, b) => b.best - a.best);

  console.log(`############ TIER ${tier} ############`);
  console.log(`relic                 scope  cost  ${PANEL.map((p) => p.label.padStart(7)).join(' ')}   counter`);
  for (const r of rows) {
    const def = RELIC_DEFS[r.id];
    const cells = r.marg
      .map((m, i) => `${(m >= 0 ? '+' : '') + m}${r.flip[i] ? '*' : ''}`.padStart(7))
      .join(' ');
    const spread = r.best - Math.min(...r.marg);
    const bestCol = PANEL[r.marg.indexOf(r.best)].label;
    const tag = r.best <= 1 ? 'dead' : spread >= r.best ? `vs ${bestCol}` : 'generic';
    console.log(`${def.name.padEnd(21)} ${def.scope.padEnd(5)} ${String(def.cost).padStart(4)}  ${cells}   ${tag}`);
  }
  console.log('');
}

console.log(
  `(Columns aren't cross-comparable — each is marginal vs a different opponent's health total; the SPREAD ` +
    `across a row is the counter-pick signal, the sign/rank within a column is the value. Team relics buff all 8 ` +
    `bodies so they read high by construction — compare within scope. Read alongside PvE all-relic-value.)`
);
