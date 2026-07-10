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
    desc: '+3 dmg, first hit each wave', firstHitBonus: 3,
  },
  'weeping-boil': {
    id: 'weeping-boil', name: 'Weeping Boil', scope: 'unit', cost: 4,
    desc: 'faint: 2 dmg, all foes', onFaintDamageAll: 2,
  },
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
    desc: 'snaps foes its blow drops to half', executeThreshold: 0.5,
  },
  // Easter egg (issue #24): the name is the whole point — someone else's
  // gear, left behind on an earlier ride, still has a little use left in it.
  // Team-scope heal distributed per-unit to prevent unbounded scaling with
  // board size (#75). Total team heal pool per tick is 1, divided among all
  // horde units (so 1 unit gets 1/tick, 2 units get 0.5/tick each, etc).
  // Bounded per compounding law: each unit's heal is clamped to maxHealth - health.
  'forgotten-backpack': {
    id: 'forgotten-backpack', name: 'The Forgotten Backpack', scope: 'team', cost: 12,
    desc: 'whole horde heals 1/clash (split)', healPerTick: 1,
  },
};
