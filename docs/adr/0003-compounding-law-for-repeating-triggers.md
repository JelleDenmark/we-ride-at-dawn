---
status: accepted
---

# Any permanent effect on a repeating Trigger must ship with a hard cap

A Ride's Horde is the same persistent set of Units across all `WAVE_COUNT` (45) Waves — nothing resets between Waves within a Ride. That means any Ability with a repeating Trigger (`startOfWave`, `faint`, `allyFaint`, `afterAttack`) which grants a *permanent* stat or effect gain compounds roughly 45×, not once. This stopped being theoretical after three separate incidents shipped: a `startOfBattle` buff on Warren-Warden was quietly re-firing every Wave instead of once, letting a maxed board of them solo-clear the Gauntlet (fixed 0.6.5); Rat-Piper × Corpse-Glutton's `allyFaint` stat-farming reached wave 39/45 uncapped (tracked as #82); and a front-slot Bone-Priest's `faint`-revive could target itself, since nothing else had died yet, producing an unkillable 1-HP loop that clears indefinitely.

We now treat this as a standing constraint on new Rat design, not a case-by-case bug hunt: a repeating-Trigger Ability that grants anything permanent (stats, wards, revives) must either be inherently bounded (e.g. capped by Board size) or carry an explicit, code-commented hard cap plus a dedicated compounding-law test canary before it ships — see `docs/design/future-minions.md`'s per-concept compounding notes for the pattern. This does **not** apply the same way to Enemies: they are regenerated fresh for every Wave and carry no state between Waves, so an Enemy Ability only needs to be safe within a single Battle, not across the whole Gauntlet.
