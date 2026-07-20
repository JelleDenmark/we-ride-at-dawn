export interface RelicDef {
  id: string;
  name: string;
  scope: 'unit' | 'team';
  cost: number;
  desc: string;
  attack?: number;
  health?: number;
  /** Extra damage on the unit's first attack of the battle (Glass Shard). */
  firstHitBonus?: number;
  /**
   * Glass Shard rework (Jesper's call, 2026-07-16): the first-hit bonus
   * damage scales with the current wave number instead of a flat literal,
   * and is deliberately left UNCAPPED — the compounding-law risk (this
   * relic can eventually out-damage the rest of the build by late waves)
   * was explicitly accepted rather than capped. Recomputed fresh from
   * `currentWave` on every wave's first hit; nothing is stored on the
   * unit, so it cannot stack within a wave or carry over — it only grows
   * because the wave number itself grows.
   */
  firstHitBonusScalesWithWave?: boolean;
  /** On faint, deal this much damage to every enemy (Weeping Boil). */
  onFaintDamageAll?: number;
  /** Heal this much at the start of each combat tick (Fat Tick). */
  healPerTick?: number;
  /** Survive one otherwise-lethal hit at 1 health, once per battle (Tail-Charm). */
  surviveLethal?: boolean;
  /** Overkill damage that fells the front foe carries to the next enemy in
   * line, once, no chaining (Gore-Cleaver). */
  cleaveOverkill?: boolean;
  /**
   * Pure execute (Marrow-Snap): if the bearer's clash hit drives the foe
   * from ABOVE this fraction of the FOE's own max health to at or below it,
   * the foe dies outright instead of surviving on a sliver. CROSSING
   * semantics (season-launch change, Jesper 2026-07-11): the executing blow
   * itself must do the threshold-crossing work — a foe already under the
   * line (poison chip, earlier clashes) cannot be tap-executed, so
   * Blight-Witch's wave-start AoE poison no longer sets up free executes
   * (it steals the crossing instead of enabling it). Compounding-law note:
   * stateless and foe-relative — no stat, health, or attack is ever added
   * to the bearer, so nothing here can accumulate across the 45-wave
   * battle. Each wave's enemies are freshly instantiated, so the "free" HP
   * this saves resets every wave along with them.
   */
  executeThreshold?: number;
}

export const RELIC_DEFS: Record<string, RelicDef> = {
  'rusted-nail': {
    id: 'rusted-nail', name: 'Rusted Nail', scope: 'unit', cost: 4,
    desc: '+2 attack', attack: 2,
  },
  'glass-shard': {
    id: 'glass-shard', name: 'Glass Shard', scope: 'unit', cost: 4,
    desc: '+dmg = wave number, first hit each wave', firstHitBonusScalesWithWave: true,
  },
  'weeping-boil': {
    id: 'weeping-boil', name: 'Weeping Boil', scope: 'unit', cost: 4,
    desc: 'faint: 2 dmg, all foes', onFaintDamageAll: 2,
  },
  // SEASON-4 JOINT-TUNING FLAG (issue #135): Grave-Leech gives sustain a
  // unit-side home, and this relic was the game's only heal before it — a
  // Leech wearing a Fat Tick stacks both drains on one front rat. Jesper's
  // options on the issue: retire this from the shop pool, re-scope it to a
  // pure stat stick (drop healPerTick), or keep both if benchmarks clear
  // it. Decision DEFERRED to the balance pass, but the two must be tuned
  // together — probe a wave-40+ ride with and without this on the Leech.
  'fat-tick': {
    id: 'fat-tick', name: 'Fat Tick', scope: 'unit', cost: 6,
    desc: '+1/+2, heal 1/clash', attack: 1, health: 2, healPerTick: 1,
  },
  'tail-charm': {
    id: 'tail-charm', name: 'Tail-Charm', scope: 'unit', cost: 6,
    desc: 'cheats death once', surviveLethal: true,
  },
  'filth-totem': {
    id: 'filth-totem', name: 'Filth Totem', scope: 'team', cost: 6,
    desc: 'all rats +0/+1', health: 1,
  },
  'gore-cleaver': {
    id: 'gore-cleaver', name: 'Gore-Cleaver', scope: 'unit', cost: 5,
    desc: 'overkill spills to next foe', cleaveOverkill: true,
  },
  'marrow-snap': {
    id: 'marrow-snap', name: 'Marrow-Snap', scope: 'unit', cost: 5,
    desc: 'kills a foe its own hit drops to half health or below', executeThreshold: 0.5,
  },
  // Easter egg (issue #24): the name is the whole point — someone else's
  // gear, left behind on an earlier ride, still has a little use left in it.
  // Flat team-wide +2/+2 combat-start buff, same mechanism as Filth Totem:
  // applied once via instantiate() before the wave loop starts, not a
  // repeating trigger, so it's inherently safe under the compounding law.
  // Previously a per-tick-split heal, but that was mostly wasted — only the
  // front-line horde unit (horde[0]) can ever take damage in this game's
  // combat model, so splitting a heal pool across the whole board mostly
  // healed units that could never be hit. Redesigned as a flat stat buff.
  'forgotten-backpack': {
    id: 'forgotten-backpack', name: 'The Forgotten Backpack', scope: 'team', cost: 12,
    desc: '+2/+2, whole horde', attack: 2, health: 2,
  },
};
