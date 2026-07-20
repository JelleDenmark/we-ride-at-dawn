# We Ride at Dawn

A grimy dark-fantasy idle auto-battler: players assemble a horde of rats that auto-fights its way through a fixed weekly gauntlet once an hour, hauling back scrap by how deep it pushed. Single-context repo — one glossary for the whole game.

## Language

**Horde**:
The player's full collection of owned units — everything on the board and the bench together.
_Avoid_: Team, roster, army (roster is fine informally but Horde is the code/domain term)

**Board**:
The subset of the Horde currently deployed and fighting, in left-to-right order. Board position matters: only the frontmost unit on each side ever clashes.
_Avoid_: Lineup, party (Lineup is a specific type name — see below — not a synonym for Board)

**Bench**:
Owned units held in reserve, not fighting. Capacity is fixed (`BENCH_SIZE`), independent of the Board's cap.

**Lineup**:
The minimal snapshot of a Board (unit ids, tiers, relics) handed to the simulator. Not player-facing vocabulary — an internal boundary type between the shop/build layer and combat.

**Unit**:
A single rat or enemy — the game's only combatant type. Both sides of a fight are Units drawn from the same underlying definition shape (`UnitDef`), so "unit" spans player rats and enemies; use **Rat** when a horde-side unit specifically is meant, and **Enemy** for the opposing side.

**Rat**:
A player-side Unit. Recruited from the Shop, owned permanently (within a season) as part of the Horde.

**Enemy**:
An opposing Unit, drawn from the fixed `ENEMY_POOL` when a Gauntlet is generated. Enemies are freshly generated for every Wave — they carry no state between Waves, unlike Rats.

**Tier**:
A Unit's power level, 1 to `MAX_TIER`. Reached by merging three copies of the same Rat at the same tier into one copy at the next tier — the game's core power-progression lever ("merging").

**Archetype**:
A tag on a Unit (`swarm | brute | armored | plague`) describing its strategic identity. Doubles as the label for a Gauntlet's daily theme (see Theme) — the same four values classify both what a Rat *is* and what a Wave leans toward.
_Avoid_: Class, type (Type is used for other things in code; Archetype is the domain term)

**Ability**:
A Unit's triggered combat behavior — a `(trigger, effect)` pair. Not every Unit has one.

**Trigger**:
The combat event that fires a Unit's Ability: `startOfBattle`, `startOfWave`, `faint`, `afterAttack`, or `allyFaint`.

**Clash**:
One simultaneous front-vs-front hit exchange: the frontmost Rat on the Board against the frontmost Enemy in the Wave. Only front-position Units deal or take clash damage; everything else acts through Abilities, summons, or poison.

**Wave**:
One `EnemyWave` — a themed mini-roster of Enemies fought as a single Clash-line. A Gauntlet is a fixed sequence of Waves; clearing one Wave advances Depth by one.

**Depth**:
The count of Waves cleared in a single Ride. The game's core progress and scoring metric — "how far the Horde got," synonymous with `wavesCleared`.
_Avoid_: Score (Score is Depth once submitted to the leaderboard, not a separate concept), Progress

**Gauntlet**:
The full ordered sequence of Waves (`WAVE_COUNT` of them) a Horde fights through. Deterministically generated from a Season's seed — byte-identical for every Ride within that Season, regardless of which day or hour the Ride happens.
_Avoid_: Dungeon, run (Run is closer to Ride — see below)

**Ride**:
One complete attempt through the Gauntlet, from Wave 1 until the Horde loses a Clash or the Gauntlet ends. Happens automatically roughly once an hour (the idle heartbeat) using whatever Horde the player has built at that moment. Many Rides happen per Season; each just reports a Depth.
_Avoid_: Run, attempt, battle (Battle is bigger than one Clash but smaller than a Ride — see below)

**Battle**:
The fight against one Wave's Enemies within a Ride — the unit of simulation `simulate()` resolves one of. A Ride is a sequence of Battles (one per Wave reached); a Battle is a sequence of Clashes (one per tick until one side is empty).
_Avoid_: Fight, encounter

**Season**:
A fixed 7-day (`SEASON_DAYS`) period, starting Monday 06:00 CET, during which one Gauntlet seed is live. `Season Best` (the player's deepest Depth this Season) drives the leaderboard and resets to zero at the next Season's start.
_Avoid_: Week, expedition (Expedition appears in older comments/docs as a synonym for Season — prefer Season going forward)

**Day**:
A 1-indexed position within a Season (1 through `SEASON_DAYS`). Governs Shop offerings, Board-cap growth (`boardCapForDay`), and unlock gates (`unlockDay`) — but **not** Gauntlet difficulty (see ADR-0003).

**Scrap**:
The single currency. Earned from Depth on every Ride (`scrapForDepth`); spent in the Shop on Rats, Relics, rerolls, and Board slots. (Interest on the banked total was removed in #129 — income is depth-only now.)

**Shop**:
The between-Rides purchasing screen: a rolling set of offered Rats and Relics (`ShopSlot`s) the player can buy, reroll, or freeze with Scrap.

**Relic**:
A purchasable item that attaches to one Rat (a Unit Relic) or to the whole Horde (a Team Relic), modifying combat without being a Unit itself.

**Merge**:
Combining three owned copies of the same Rat at the same Tier into one copy at the next Tier. The primary power-spike a player chases; "merge-fishing" is intentionally seeking a third copy via rerolls.

**Theme**:
A Gauntlet's declared Archetype leaning: a `primary` and `secondary` Archetype, with the secondary only appearing from its `pivotWave` onward. Drives which Enemies get force-spent budget share, so the in-game scout report matches what's actually fielded.

**Compounding Law**:
The standing design constraint that any permanent stat/effect gain on a repeating Trigger (`startOfWave`, `faint`, `allyFaint`, `afterAttack`) is unbounded over a full Gauntlet, because a Ride's Horde is the same persistent set of Units across all `WAVE_COUNT` Waves. Every new Rat ability must state where it sits against this law before shipping. Does **not** apply the same way to Enemies, which regenerate fresh every Wave and carry no state between them.
