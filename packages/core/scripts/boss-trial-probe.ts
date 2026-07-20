/**
 * Boss Trial tuning probe (issue #107). Runs a spread of board strengths through
 * simulateBossTrial and prints total damage + phases survived, so the escalation
 * (BOSS_TRIAL_BASE_ATTACK / _HP / _ESCALATION) can be tuned to give a wide,
 * monotonic score spread from a weak board to a maxed leaderboard chaser.
 *
 * Run: npx tsx scripts/boss-trial-probe.ts   (from packages/core)
 */
import { BOARD_CAP } from '../src/sim';
import type { Lineup } from '../src/data/units';
import {
  simulateBossTrial,
  BOSS_TRIAL_BASE_ATTACK,
  BOSS_TRIAL_HP_BASE,
  BOSS_TRIAL_HP_GROWTH_PER_PHASE,
  BOSS_TRIAL_ESCALATION,
  BOSS_TRIAL_MAX_PHASES,
} from '../src/boss-trial';

const RELICS = [
  'gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick',
  'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick',
];

function board(order: string[], tier: number, relics = true): Lineup {
  const units = order
    .slice(0, BOARD_CAP)
    .map((defId, i) => ({ defId, tier, relicIds: relics ? [RELICS[i]] : [] }));
  return { units, teamRelicIds: relics ? ['filth-totem'] : [] };
}

const BOARDS: Record<string, Lineup> = {
  'weak (2x gutter-runt t1, no relics)': board(['gutter-runt', 'gutter-runt'], 1, false),
  'mid (5-unit t2, relics)': board(
    ['dire-rat', 'warren-warden', 'corpse-glutton', 'bone-priest', 'blight-witch'],
    2
  ),
  'maxed attacker board (8x t3, best relics)': board(
    ['dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer', 'bone-priest', 'press-kin', 'md-rattyfock', 'dire-rat'],
    3
  ),
  'maxed poison board (1x poison, capped, t3)': board(
    ['dire-rat', 'ward-weaver', 'corpse-glutton', 'draughtsman-moe', 'bone-priest', 'press-kin', 'md-rattyfock', 'dire-rat'],
    3
  ),
  'tanky sustain board (t3 ward-weaver + bone-priest + backpack)': {
    ...board(['dire-rat', 'ward-weaver', 'bone-priest', 'warren-warden', 'corpse-glutton', 'dire-rat', 'press-kin', 'md-rattyfock'], 3),
    teamRelicIds: ['forgotten-backpack'],
  },
};

console.log(
  `Boss Trial probe — base attack ${BOSS_TRIAL_BASE_ATTACK}, HP ${BOSS_TRIAL_HP_BASE}+${BOSS_TRIAL_HP_GROWTH_PER_PHASE}/phase, escalation x${BOSS_TRIAL_ESCALATION}/phase, cap ${BOSS_TRIAL_MAX_PHASES} phases\n`
);
console.log('board                                                          totalDamage   phasesSurvived');
for (const [name, lineup] of Object.entries(BOARDS)) {
  const { totalDamage, phasesSurvived } = simulateBossTrial(lineup);
  const hitCap = phasesSurvived >= BOSS_TRIAL_MAX_PHASES ? '  <-- HIT PHASE CAP (bug: not terminating)' : '';
  console.log(
    `${name.padEnd(60)}   ${String(totalDamage).padStart(9)}   ${String(phasesSurvived).padStart(10)}${hitCap}`
  );
}
