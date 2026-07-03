export interface RelicDef {
  id: string;
  name: string;
  scope: 'unit' | 'team';
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
}

export const RELIC_DEFS: Record<string, RelicDef> = {
  'rusted-nail': { id: 'rusted-nail', name: 'Rusted Nail', scope: 'unit', attack: 2 },
  'glass-shard': { id: 'glass-shard', name: 'Glass Shard', scope: 'unit', firstHitBonus: 3 },
  'weeping-boil': { id: 'weeping-boil', name: 'Weeping Boil', scope: 'unit', onFaintDamageAll: 2 },
  'fat-tick': { id: 'fat-tick', name: 'Fat Tick', scope: 'unit', attack: 1, health: 2, healPerTick: 1 },
  'tail-charm': { id: 'tail-charm', name: 'Tail-Charm', scope: 'unit', surviveLethal: true },
  'filth-totem': { id: 'filth-totem', name: 'Filth Totem', scope: 'team', health: 1 },
};
