import type { Side, UnitDef, Ability, Lineup } from './data/units';
import { UNIT_DEFS, tierAttackMultiplier, tierHealthMultiplier } from './data/units';
import { ENEMY_POOL } from './data/enemies';
import { RELIC_DEFS, type RelicDef } from './data/relics';
import type { Gauntlet } from './gauntlet';

const DEF_LOOKUP: Record<string, UnitDef> = {
  ...UNIT_DEFS,
  ...Object.fromEntries(ENEMY_POOL.map((e) => [e.id, e])),
};

/** Hard maximum number of rats you may *recruit* onto the board. The shop's
 * per-day buildable cap (boardCapForDay) grows toward this over an expedition. */
export const BOARD_CAP = 8;
/**
 * Combat leaves this much headroom above the recruitable board, so summons
 * (Rat-Piper's pups, Brood-Mother's litter, Bone-Priest's revive) always have
 * somewhere to land. Previously summons silently no-op'd once the warren was
 * full, which quietly bricked every summoner build the moment you filled your
 * board — the single most-reported confusion. See `combatCapForDay`.
 */
export const COMBAT_CAP_BONUS = 2;
export const SCORE_PER_WAVE = 100;
/** Stalemate guard (e.g. two healers out-sustaining each other): the wave is abandoned. */
export const MAX_TICKS_PER_WAVE = 1000;

// Enemy stat-scaling by WAVE DEPTH (wave index `i`, 0-based), not by day.
// This is the primary difficulty lever: deeper waves field tankier foes, so
// pushing depth requires attack (making attack-buffing relics matter) while
// staying day-agnostic (no early-peak sweet spot for the max-depth-over-week
// leaderboard metric). Health scales faster than attack so overkill damage
// keeps being "spent" on enemy HP rather than wasted past a low cap.
// Health also carries a small quadratic term: a stronger (higher-tier)
// horde's raw attack grows multiplicatively with tier-ups, so a purely
// linear HP curve eventually falls behind and attack stops mattering again
// at high depth/tier — the same "overkill wasted" bug this whole change
// exists to fix, just recurring at a higher power level.
export const ENEMY_HEALTH_SCALE_PER_WAVE = 0.20;
export const ENEMY_HEALTH_SCALE_QUADRATIC = 0.004;
export const ENEMY_ATTACK_SCALE_PER_WAVE = 0.05;

export function enemyHealthScale(waveIndex: number): number {
  return 1 + waveIndex * ENEMY_HEALTH_SCALE_PER_WAVE + waveIndex * waveIndex * ENEMY_HEALTH_SCALE_QUADRATIC;
}

export function enemyAttackScale(waveIndex: number): number {
  return 1 + waveIndex * ENEMY_ATTACK_SCALE_PER_WAVE;
}

export interface UnitView {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  tier: number;
  side: Side;
}

export type BattleEvent =
  | { type: 'battleStart'; horde: UnitView[] }
  | { type: 'waveStart'; wave: number; enemies: UnitView[] }
  | { type: 'clash'; hordeId: number; enemyId: number }
  | { type: 'damage'; targetId: number; amount: number; remainingHealth: number }
  | { type: 'poisonApplied'; targetId: number; stacks: number; totalStacks: number }
  | { type: 'poisonTick'; targetId: number; amount: number; remainingHealth: number }
  | { type: 'heal'; targetId: number; amount: number; newHealth: number }
  | { type: 'death'; unitId: number }
  | { type: 'summon'; side: Side; index: number; unit: UnitView }
  | { type: 'revive'; side: Side; index: number; unit: UnitView }
  | { type: 'buff'; targetId: number; attack: number; health: number; newAttack: number; newHealth: number }
  | { type: 'relicProc'; targetId: number; relicId: string; name: string }
  | { type: 'shieldGranted'; targetId: number; sourceId: number }
  | { type: 'shieldAbsorbed'; targetId: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'battleEnd'; wavesCleared: number; score: number };

export interface BattleResult {
  wavesCleared: number;
  score: number;
  survivors: UnitView[];
  damageDealt: number;
  /** Enemies felled this battle (fallen.gauntlet.length) — the season's
   * cumulative kill-count leaderboard tiebreak is a running sum of this. */
  enemiesDefeated: number;
}

interface BattleUnit {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  maxHealth: number;
  tier: number;
  side: Side;
  ability?: Ability;
  relics: RelicDef[];
  poison: number;
  firstAttackDone: boolean;
  tailCharmUsed: boolean;
  /** Flat armor against 'attack' damage; see UnitDef.damageReduction. */
  damageReduction: number;
  /** `startOfBattle` fires once per unit instance, ever — never again on later waves. */
  startOfBattleFired: boolean;
  /** A corpse may be raised once per battle. Guards the two-reviver loop. */
  raised: boolean;
  /**
   * Ward-Weaver's shield. Bounded to a single boolean, never a counter: a
   * grant while already `true` is a no-op (see `tickWatchers`), so however
   * many times the watcher's every-3rd-attack threshold is crossed before
   * the shield is actually consumed, it still only ever absorbs exactly one
   * hit. That's what keeps this compounding-law-safe across a 45-wave
   * battle — it cannot stack into "absorbs N hits."
   */
  shielded: boolean;
  /**
   * Per-battle (not per-wave) count of attacks landed by this unit's own
   * side's current front-line unit, owned by whichever unit bears a
   * `watchFrontAttack` ability. Never reset mid-battle, only re-initialized
   * per unit instance at `instantiate` — matches `startOfBattleFired`'s
   * once-per-instance lifetime, so a Ward-Weaver's proc cadence carries
   * across wave boundaries within one battle, as designed.
   */
  watchCounter: number;
}

/** A hit reduced by armor still lands for at least this much. */
export const MIN_ATTACK_DAMAGE = 1;

/**
 * Pure and deterministic: same (lineup, gauntlet) always yields a
 * byte-identical event log. No unseeded randomness, no wall-clock,
 * no iteration over unordered collections.
 *
 * Tick order: heals -> simultaneous clash -> afterAttack triggers ->
 * poison ticks -> death resolution (faint ability, faint relics,
 * allyFaint listeners — horde before gauntlet, front to back).
 */
export function simulate(
  lineup: Lineup,
  gauntlet: Gauntlet
): { events: BattleEvent[]; result: BattleResult } {
  const events: BattleEvent[] = [];
  let nextInstanceId = 1;

  const teamRelics = (lineup.teamRelicIds ?? [])
    .map((id) => RELIC_DEFS[id])
    .filter((r): r is RelicDef => r !== undefined && r.scope === 'team');
  const teamAttack = teamRelics.reduce((s, r) => s + (r.attack ?? 0), 0);
  const teamHealth = teamRelics.reduce((s, r) => s + (r.health ?? 0), 0);
  // Whole-horde per-tick regen (The Forgotten Backpack). Same shape as a
  // unit's healPerTick (Fat Tick), just summed across team relics and applied
  // to every horde unit instead of only the carrier. Compounding-law check:
  // this is bounded exactly like Fat Tick's regen below — every tick it's
  // clamped to `maxHealth - health`, so it can never push a unit past its own
  // health ceiling no matter how many of the 45 waves it runs across.
  const teamHealPerTick = teamRelics.reduce((s, r) => s + (r.healPerTick ?? 0), 0);
  // Both sides share one in-combat ceiling. Absent (golden logs, tests,
  // gauntlet-only callers) it's BOARD_CAP, exactly as before.
  const combatCap = lineup.combatCap ?? BOARD_CAP;

  const instantiate = (
    def: UnitDef,
    side: Side,
    relicIds: string[] = [],
    tier = 1,
    attackScale = 1,
    healthScale = 1
  ): BattleUnit => {
    const relics = relicIds
      .map((id) => RELIC_DEFS[id])
      .filter((r): r is RelicDef => r !== undefined && r.scope === 'unit');
    let attack =
      Math.round(def.attack * tierAttackMultiplier(tier) * attackScale) +
      relics.reduce((s, r) => s + (r.attack ?? 0), 0);
    let health =
      Math.round(def.health * tierHealthMultiplier(tier) * healthScale) +
      relics.reduce((s, r) => s + (r.health ?? 0), 0);
    if (side === 'horde') {
      attack += teamAttack;
      health += teamHealth;
    }
    return {
      instanceId: nextInstanceId++,
      defId: def.id,
      name: def.name,
      attack,
      health,
      maxHealth: health,
      tier,
      side,
      ability: def.ability,
      relics,
      poison: 0,
      firstAttackDone: false,
      tailCharmUsed: false,
      damageReduction: (def.damageReduction ?? 0) * tier,
      startOfBattleFired: false,
      raised: false,
      shielded: false,
      watchCounter: 0,
    };
  };

  const view = (u: BattleUnit): UnitView => ({
    instanceId: u.instanceId,
    defId: u.defId,
    name: u.name,
    attack: u.attack,
    health: u.health,
    tier: u.tier,
    side: u.side,
  });

  const horde: BattleUnit[] = lineup.units
    .slice(0, BOARD_CAP)
    .map((u) => instantiate(UNIT_DEFS[u.defId], 'horde', u.relicIds, u.tier ?? 1));
  let enemies: BattleUnit[] = [];
  const fallen: Record<Side, BattleUnit[]> = { horde: [], gauntlet: [] };

  const boardOf = (side: Side): BattleUnit[] => (side === 'horde' ? horde : enemies);
  const opposing = (side: Side): BattleUnit[] => (side === 'horde' ? enemies : horde);

  events.push({ type: 'battleStart', horde: horde.map(view) });

  const applyDamage = (unit: BattleUnit, amount: number, cause: 'attack' | 'poison'): void => {
    // Armor blunts attacks only — poison is rot, it goes around the hide. The
    // floor keeps armor from ever producing an unkillable front rat.
    const dealt =
      cause === 'attack' && unit.damageReduction > 0
        ? Math.max(MIN_ATTACK_DAMAGE, amount - unit.damageReduction)
        : amount;
    unit.health -= dealt;
    let charmProc = false;
    if (unit.health <= 0 && !unit.tailCharmUsed) {
      const charm = unit.relics.find((r) => r.surviveLethal);
      if (charm) {
        unit.tailCharmUsed = true;
        unit.health = 1;
        charmProc = true;
      }
    }
    events.push({
      type: cause === 'poison' ? 'poisonTick' : 'damage',
      targetId: unit.instanceId,
      amount: dealt,
      remainingHealth: unit.health,
    });
    if (charmProc) {
      events.push({ type: 'relicProc', targetId: unit.instanceId, relicId: 'tail-charm', name: 'Tail-Charm' });
    }
  };

  const applyPoisonStacks = (target: BattleUnit, stacks: number): void => {
    target.poison += stacks;
    events.push({
      type: 'poisonApplied',
      targetId: target.instanceId,
      stacks,
      totalStacks: target.poison,
    });
  };

  const buff = (target: BattleUnit, attack: number, health: number): void => {
    target.attack += attack;
    target.health += health;
    target.maxHealth += health;
    events.push({
      type: 'buff',
      targetId: target.instanceId,
      attack,
      health,
      newAttack: target.attack,
      newHealth: target.health,
    });
  };

  /**
   * `index` is the source's current board index, or — when `removed` —
   * the index it occupied before dying, which is where "behind" now starts
   * and where summons/revives are inserted.
   */
  // Ability magnitudes scale with the source's tier (a tier-2 Brood-Mother
  // births 4 pups, a tier-2 Gnawer grants +4 attack).
  const applyEffect = (source: BattleUnit, index: number, removed: boolean): void => {
    if (!source.ability) return;
    const board = boardOf(source.side);
    const effect = source.ability.effect;
    const tier = source.tier;
    switch (effect.kind) {
      case 'summon': {
        const def = DEF_LOOKUP[effect.unitId];
        for (let i = 0; i < effect.count * tier; i++) {
          if (board.length >= combatCap) break;
          const summoned = instantiate(def, source.side);
          board.splice(index, 0, summoned);
          events.push({ type: 'summon', side: source.side, index, unit: view(summoned) });
        }
        break;
      }
      case 'buffBehind': {
        const start = removed ? index : index + 1;
        const targets = effect.all ? board.slice(start) : board.slice(start, start + 1);
        for (const target of targets) buff(target, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'buffAdjacent': {
        // `startOfBattle`-gated (see fireEntryTriggers: fires once per unit
        // instance, ever), so this is the same compounding-law shape as
        // Warren-Warden's `buffBehind` — it cannot re-fire on a later wave
        // and re-stack. `removed` is never true here (buffAdjacent is only
        // ever wired to `startOfBattle`, not `faint`), so `index` is always
        // the source's live board position; front has no index-1 neighbor,
        // back has no index+1 neighbor, middle placements get both — the
        // intended "middle is strictly better" shape.
        const targets: BattleUnit[] = [];
        if (index > 0) targets.push(board[index - 1]);
        if (index < board.length - 1) targets.push(board[index + 1]);
        for (const target of targets) buff(target, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'poisonFrontEnemy': {
        const target = opposing(source.side)[0];
        if (target) applyPoisonStacks(target, effect.stacks * tier);
        break;
      }
      case 'poisonTarget': {
        const target = opposing(source.side)[0];
        if (target && target.health > 0) applyPoisonStacks(target, effect.stacks * tier);
        break;
      }
      case 'gainStats': {
        buff(source, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'revive': {
        // Raise the oldest fallen ally — never the caster, and never a corpse
        // that has already been raised once.
        //
        // Two guards, two separate exploits. A fainting unit is pushed to
        // `fallen` *before* its own faint trigger fires, so raising the first
        // corpse resurrected the reviver forever (a lone Bone-Priest cleared
        // the whole gauntlet, unkillable — fixed in 0.6.2). Skipping only the
        // caster was not enough: two Bone-Priests each raise the *other's*
        // corpse, which dies, re-enters `fallen`, and gets raised again — an
        // immortal pair that full-cleared all 45 waves for 12 scrap. The
        // `raised` flag makes resurrection a once-per-corpse resource, so any
        // reviver ring is finite no matter how many priests you stack.
        const corpseIdx = fallen[source.side].findIndex((c) => c !== source && !c.raised);
        if (corpseIdx === -1 || board.length >= combatCap) break;
        const [corpse] = fallen[source.side].splice(corpseIdx, 1);
        corpse.raised = true;
        corpse.health = effect.health * tier;
        corpse.poison = 0;
        board.splice(index, 0, corpse);
        events.push({ type: 'revive', side: source.side, index, unit: view(corpse) });
        break;
      }
    }
  };

  const resolveDeaths = (): void => {
    for (;;) {
      let dead: BattleUnit | undefined;
      let deadIndex = -1;
      let deadBoard: BattleUnit[] | undefined;
      for (const board of [horde, enemies]) {
        deadIndex = board.findIndex((u) => u.health <= 0);
        if (deadIndex !== -1) {
          deadBoard = board;
          dead = board[deadIndex];
          break;
        }
      }
      if (!dead || !deadBoard) return;
      deadBoard.splice(deadIndex, 1);
      events.push({ type: 'death', unitId: dead.instanceId });
      fallen[dead.side].push(dead);

      if (dead.ability?.trigger === 'faint') applyEffect(dead, deadIndex, true);
      for (const relic of dead.relics) {
        if (!relic.onFaintDamageAll) continue;
        events.push({ type: 'relicProc', targetId: dead.instanceId, relicId: relic.id, name: relic.name });
        for (const foe of [...opposing(dead.side)]) applyDamage(foe, relic.onFaintDamageAll, 'attack');
      }
      for (const ally of [...deadBoard]) {
        if (ally.ability?.trigger === 'allyFaint' && ally.health > 0) applyEffect(ally, deadBoard.indexOf(ally), false);
      }
    }
  };

  /**
   * Entry triggers, fired in board order at the top of every wave:
   * `startOfWave` for every unit, `startOfBattle` only for units that have
   * never fired it. See `Ability` in data/units.ts for why the split exists.
   */
  const fireEntryTriggers = (board: BattleUnit[]): void => {
    for (const unit of [...board]) {
      const trigger = unit.ability?.trigger;
      if (trigger !== 'startOfBattle' && trigger !== 'startOfWave') continue;
      if (trigger === 'startOfBattle') {
        if (unit.startOfBattleFired) continue;
        unit.startOfBattleFired = true;
      }
      const index = board.findIndex((u) => u.instanceId === unit.instanceId);
      if (index === -1) continue;
      applyEffect(unit, index, false);
    }
  };

  let wavesCleared = 0;
  let totalDamage = 0;
  let damageThisWave = 0;

  for (let w = 0; w < gauntlet.waves.length && horde.length > 0; w++) {
    enemies = gauntlet.waves[w].units.map((d) =>
      instantiate(d, 'gauntlet', [], 1, enemyAttackScale(w), enemyHealthScale(w))
    );
    events.push({ type: 'waveStart', wave: w + 1, enemies: enemies.map(view) });
    damageThisWave = 0;
    // First-hit relics (Glass Shard) fire anew each wave — clear the horde's
    // "already swung" flag at every wave start. Enemies are re-instantiated
    // per wave, so they begin fresh already.
    for (const u of horde) u.firstAttackDone = false;

    fireEntryTriggers(horde);
    fireEntryTriggers(enemies);
    resolveDeaths();

    let ticks = 0;
    while (horde.length > 0 && enemies.length > 0 && ticks++ < MAX_TICKS_PER_WAVE) {
      for (const board of [horde, enemies]) {
        for (const unit of board) {
          const regen =
            unit.relics.reduce((s, r) => s + (r.healPerTick ?? 0), 0) +
            (unit.side === 'horde' ? teamHealPerTick : 0);
          const amount = Math.min(regen, unit.maxHealth - unit.health);
          if (amount > 0) {
            unit.health += amount;
            events.push({ type: 'heal', targetId: unit.instanceId, amount, newHealth: unit.health });
          }
        }
      }

      const front = horde[0];
      const foe = enemies[0];
      events.push({ type: 'clash', hordeId: front.instanceId, enemyId: foe.instanceId });

      const bonusOf = (u: BattleUnit): number =>
        u.firstAttackDone ? 0 : u.relics.reduce((s, r) => s + (r.firstHitBonus ?? 0), 0);
      const damageOut = front.attack + bonusOf(front);
      const damageIn = foe.attack + bonusOf(foe);
      front.firstAttackDone = true;
      foe.firstAttackDone = true;

      // Ward-Weaver's shield absorbs a whole attack hit outright, so it must
      // resolve before applyDamage even runs — that also means it resolves
      // before Tail-Charm's lethal-hit check inside applyDamage, which is
      // the intended order: a fully-absorbed hit was never lethal to begin
      // with, so it should never consume Tail-Charm.
      if (foe.shielded) {
        foe.shielded = false;
        events.push({ type: 'shieldAbsorbed', targetId: foe.instanceId });
      } else {
        applyDamage(foe, damageOut, 'attack');
      }
      if (front.shielded) {
        front.shielded = false;
        events.push({ type: 'shieldAbsorbed', targetId: front.instanceId });
      } else {
        applyDamage(front, damageIn, 'attack');
      }
      damageThisWave += damageOut;

      // Ward-Weaver: watches its own side's *current* front-line unit (not
      // itself) and counts its landed attacks. `front`/`foe` above just
      // landed an attack this tick (every tick both sides' front units
      // attack, by construction of the front-clash sim), so tick every
      // watcher on each side once and grant a shield to that side's current
      // front on every `every`th tick. Compounding-law check: the counter
      // grows unboundedly across the 45-wave battle (that's fine, it's a
      // modulo cadence, not a magnitude), but the *effect* it produces
      // (`front.shielded = true`) is a boolean, not incremented — repeated
      // grants before the shield is consumed are idempotent no-ops, so the
      // shield can never absorb more than one hit no matter how long the
      // battle runs. This must run after the shielded front/foe from *this*
      // tick have already resolved their (non-)damage above, so a proc this
      // tick protects the *next* hit, not the simultaneous one just traded.
      const tickWatchers = (board: BattleUnit[], currentFront: BattleUnit): void => {
        for (const watcher of board) {
          if (watcher.ability?.trigger !== 'watchFrontAttack' || watcher.health <= 0) continue;
          const effect = watcher.ability.effect;
          if (effect.kind !== 'shieldFront') continue;
          watcher.watchCounter++;
          if (watcher.watchCounter >= effect.every) {
            watcher.watchCounter = 0;
            currentFront.shielded = true;
            events.push({ type: 'shieldGranted', targetId: currentFront.instanceId, sourceId: watcher.instanceId });
          }
        }
      };
      // Note: if `front`/`foe` took lethal damage above (or has lethal
      // poison still pending later this tick), this can grant a shield to a
      // unit that `resolveDeaths` removes moments later. That's a wasted
      // proc, not a bug — the shield is still bounded to "one hit,"
      // consumed or not, so it never leaks value across the battle.
      tickWatchers(horde, front);
      tickWatchers(enemies, foe);

      // Marrow-Snap: a foe left at or below executeThreshold of its OWN max
      // health (not the bearer's) dies outright instead of surviving on a
      // sliver. Pure execute, no stat gain anywhere — see the compounding-
      // law doc comment on `executeThreshold` in data/relics.ts for why this
      // is safe to fire every tick, every wave, for 45 waves straight: it's
      // foe-relative and stateless, so nothing here can accumulate on the
      // horde. Only fires if the foe actually survived this clash (a kill
      // is a kill, not an execute) and skips a foe a surviveLethal relic
      // just rescued to 1 health.
      const executeRelic = front.relics.find((r) => r.executeThreshold !== undefined);
      if (executeRelic && foe.health > 0 && foe.health <= foe.maxHealth * executeRelic.executeThreshold!) {
        events.push({ type: 'relicProc', targetId: front.instanceId, relicId: executeRelic.id, name: executeRelic.name });
        // Finish the foe directly rather than routing through applyDamage:
        // this is a kill-condition check, not a fresh attack, so it must not
        // be blunted by the foe's own armor (damageReduction) the way a
        // normal hit would be.
        const finishing = foe.health;
        foe.health = 0;
        events.push({ type: 'damage', targetId: foe.instanceId, amount: finishing, remainingHealth: 0 });
      }

      // Gore-Cleaver: overkill damage that actually fells the front foe
      // carries to the next enemy in line, once, no chaining. Guard against
      // Tail-Charm (or any future surviveLethal) actually saving the foe —
      // check post-applyDamage health, not just the raw overkill math.
      if (front.relics.some((r) => r.cleaveOverkill) && foe.health <= 0) {
        // Carry what actually spilled past the kill, i.e. how far the foe's
        // health went negative — not the raw swing, which armor may have
        // blunted before it landed.
        const overkill = -foe.health;
        const next = enemies[1];
        if (overkill > 0 && next) {
          events.push({ type: 'relicProc', targetId: front.instanceId, relicId: 'gore-cleaver', name: 'Gore-Cleaver' });
          applyDamage(next, overkill, 'attack');
        }
      }

      if (front.ability?.trigger === 'afterAttack') applyEffect(front, 0, false);
      if (foe.ability?.trigger === 'afterAttack') applyEffect(foe, 0, false);

      for (const board of [horde, enemies]) {
        for (const unit of [...board]) {
          if (unit.poison > 0 && unit.health > 0) applyDamage(unit, unit.poison, 'poison');
        }
      }

      resolveDeaths();
    }

    totalDamage += damageThisWave;
    if (ticks > MAX_TICKS_PER_WAVE) break;
    if (enemies.length === 0 && horde.length > 0) {
      wavesCleared++;
      events.push({ type: 'waveClear', wave: w + 1 });
      // Antidote between waves: carried damage persists, poison does not —
      // otherwise plague enemies would compound with attrition (tunable).
      for (const unit of horde) unit.poison = 0;
    }
  }

  const survivingHealth = horde.reduce((sum, u) => sum + u.health, 0);
  const score =
    wavesCleared * SCORE_PER_WAVE + survivingHealth + (horde.length === 0 ? damageThisWave : 0);
  events.push({ type: 'battleEnd', wavesCleared, score });

  return {
    events,
    result: {
      wavesCleared,
      score,
      survivors: horde.map(view),
      damageDealt: totalDamage,
      enemiesDefeated: fallen.gauntlet.length,
    },
  };
}
