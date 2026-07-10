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
   * Pure execute (Marrow-Snap): if a clash leaves the foe at or below this
   * fraction of the FOE's own max health, it dies outright instead of
   * surviving on a sliver. Compounding-law note: this is stateless and
   * foe-relative — no stat, health, or attack is ever added to the bearer,
   * so there is nothing here that can accumulate across the 45-wave battle.
   * Each wave's enemies are freshly instantiated (see `simulate`'s per-wave
   * loop), so the "free" HP this saves resets every wave along with them;
   * it only ever changes the outcome of the single clash it fires on.
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
    desc: 'executes foes at ≤55% hp', executeThreshold: 0.55,
  },
  // Easter egg (issue #24): the name is the whole point — someone else's
  // gear, left behind on an earlier ride, still has a little use left in it.
  // Team-scope so it doesn't retread Fat Tick's single-unit sustain or
  // Filth-Totem's flat stat buff: it's whole-horde upkeep instead of either.
  // Bounded per the compounding law — see the `teamHealPerTick` comment in
  // sim.ts: it's clamped to each unit's own maxHealth every tick, so it
  // cannot accumulate across the 45-wave battle.
  'forgotten-backpack': {
    id: 'forgotten-backpack', name: 'The Forgotten Backpack', scope: 'team', cost: 12,
    desc: 'whole horde heals 1/clash', healPerTick: 1,
  },
};
