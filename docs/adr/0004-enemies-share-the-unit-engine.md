---
status: accepted
---

# Enemies are `UnitDef`s, not a separate stat-block system

Enemies could have been modeled as a lightweight, Rat-agnostic data shape (just attack/health scaled by Wave index) — simpler, and free of concerns (Tier, Relics) that only make sense for the player's Horde. Instead, `ENEMY_POOL` entries are full `UnitDef`s, the same type Rats use, merged into one `DEF_LOOKUP` and resolved through the same combat/Ability engine (`applyEffect`, the same `Trigger`/`Effect` union) for both sides.

The payoff: any combat mechanic built for one side — poison stacking, `damageReduction` (flat armor), summon-on-trigger, buffs — is automatically available to the other with zero engine work, just a new data entry. This is why Enemy "mage" (status/curse) design is cheap today despite never having been built for Enemies before, and why Dire-Rat's armor mechanic could in principle apply to an Enemy tomorrow with one field. The cost is the inverse: Enemies inherit fields they never use (Tier, cost-as-Shop-price semantics), and any change to the shared engine (e.g. adding a true ranged/backline damage path, see the `future-minions.md` "Slink-Rat" primitive) affects both sides' combat resolution at once and must be designed bidirectionally rather than per-side.
