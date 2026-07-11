# Future minions — positional & strategic concepts

Rough design bank for future seasons, ahead of implementation. Written 2026-07-11,
after the 0.6.5 season cut. These are **concepts, not committed units** — stat
lines are placeholders, names are provisional, and each carries an honest note on
engine cost and the compounding-law risk that must be cleared before it ships.

The point is to have a stocked shelf so each season can **retire a few rats and
introduce a few**, keeping the shop feeling new without redesigning the engine
every time.

---

## The seasonal rotation mechanism (how retire/introduce actually works)

Confirmed against the code, so future seasons can rotate cheaply:

- Every unit stays in `UNIT_DEFS` **permanently** — golden logs and determinism
  tests reference them by id, so removing a def breaks history. Retirement is
  **not** deletion.
- What rotates is `SHOP_UNIT_POOL` in `shop.ts` (the filter that decides what the
  shop can roll). Warren-Warden is already retired this way — still in `UNIT_DEFS`,
  filtered out of the pool.
- `unlockDay` gates a unit to appear only from expedition day N onward (Dawn/Dusk-Runt
  use it). A season can stagger introductions the same way.
- **Reskin-replacement pattern:** when a unit's *kit* should survive but its identity
  should refresh, ship a new def with the same stats/ability and different name/art
  (MD Rattyfock is Warren-Warden's kit, reskinned). Cheap way to "retire" a face
  while keeping a proven mechanic.

So a season's content churn is: add new defs, flip a few pool-membership lines,
optionally add `unlockDay`s. No schema work.

---

## What the combat structure makes easy vs hard (design negative space)

Before proposing units, the constraints that kill whole categories of idea:

- **Combat is front-vs-front, one clash per wave.** Only `horde[0]` ever takes or
  deals clash damage; the rest act through auras, summons, or poison-from-anywhere.
  This is why `afterAttack` on a back unit never fires (Blight-Witch had to move to
  `startOfWave`), and why the interesting positional axis is "how do you make a
  *back* slot matter."
- **Taunt / bodyguard doesn't work here.** In a game where the front already eats
  every hit, "draw fire to me" is a no-op. Redirect/taunt units are a dead category
  unless we add multi-target enemy attacks first. Noted so nobody designs one.
- **Ranged healing / back-line support that only helps the front** is mostly covered
  already by team auras and Fat-Tick-style relics; a dedicated "healer" adds little
  over what exists.
- **The compounding law is the real gate.** 45 waves, one persistent horde: any
  permanent effect on a repeating trigger (`startOfWave`, `faint`, `allyFaint`,
  `afterAttack`) compounds ~45×. Every concept below states where it sits.

The genuinely underexplored axes worth mining: **backline damage**, **back-slot
value / positional patience**, **mid-battle repositioning (your own line and the
enemy's)**, and **build-around synergy (tribes / adjacency counts)**.

---

## Concepts

### 1. Slink-Rat — backline sniper *(flagship; engine investment)*

> Fights from the dark. Attacks the front foe from any slot, but folds the moment
> anything reaches it.

- **Axis:** the first true **backline damage dealer**. Opens a whole "glass cannon
  behind a wall" archetype — you build a tank front specifically to keep it alive.
- **Rough stats:** attack 3, health 1, cost 6. Deliberately fragile: worthless if it
  ever reaches front.
- **Mechanic:** each wave, adds its attack to the front clash against `enemies[0]`,
  taking no retaliation (it's not the one clashing). Scales with tier like any attack.
- **Engine cost: HIGH.** Needs a second damage source in the tick loop — the same
  change discussed as "Blight-Witch option B." Touches how a clash resolves; must
  decide interaction with Ward-Weaver blocks, Gore-Cleaver overkill, Marrow-Snap
  execute (does a sniper's hit count as "the crossing blow"? — probably no, keep
  execute tied to the front clash only).
- **Compounding:** none — fixed damage per wave, no accumulation. Multiple snipers
  stack additively but are bounded by board size. Safe.
- **Counterplay:** dies instantly at front; a wave that kills your tank fast turns
  your snipers into free kills. Rewards front-line investment, punishes greed.

This is the highest-value concept because the **engine primitive (backline damage)
unlocks a family**, not just one unit — future poison-dart, hex, and marksman rats
all reuse it.

### 2. Cellar-Coil — positional patience *(cheap-ish; watch the cap)*

> Bides in the back, tightening. The longer it waits its turn, the harder it lands
> when the line finally breaks to it.

- **Axis:** makes the **back slot** actively desirable — the opposite of every
  front-value unit. Strategic tension: you want it protected AND you want it to
  eventually fight.
- **Rough stats:** attack 2, health 4, cost 5.
- **Mechanic:** each wave it survives **while not in front**, it stores +1 attack
  (×tier), **capped** (e.g. +6 / +12 / +18 by tier). The stored charge is real stats
  it keeps when it rotates up.
- **Engine cost: LOW–MODERATE.** `startOfWave` + a "not front" condition + a per-unit
  cap counter.
- **Compounding: THIS IS THE TRAP.** A permanent per-wave gain is exactly the shipped
  Warren-Warden shape. **It is only safe because of the hard cap** — the cap must be
  part of the def, not a suggestion, and it needs a compounding-law canary. Un-capped,
  this is an instant exploit.
- **Counterplay:** does nothing until the front collapses onto it; a fast-winning
  board never cashes the charge. Slow, greedy payoff.

### 3. Bolt-Hole Rat — retreat & reposition *(engine investment; safe)*

> Won't die where it stands. The first killing blow, it bolts for the back of the
> line instead.

- **Axis:** introduces **mid-battle repositioning** — nothing currently moves a unit
  during combat. Strategically, it keeps a fragile, valuable back-liner (a summoner,
  a Slink-Rat) alive through the one wave that would have caught it out of position.
- **Rough stats:** attack 2, health 3, cost 6.
- **Mechanic:** once per battle, an otherwise-lethal hit instead leaves it at 1 HP and
  **splices it to the back** of the horde (Tail-Charm's survive-lethal + a reposition).
- **Engine cost: MODERATE.** Reuses the `surviveLethal` hook, adds a board-reorder on
  trigger. The reposition primitive is reusable (future "shove an ally forward,"
  "rotate the line" units).
- **Compounding:** single-use per battle, no accumulation. Safe.
- **Counterplay:** only once; still 1 HP and fragile; a wave with follow-up damage
  finishes it anyway.

### 4. Gutter-Hook — enemy-order disruption *(engine investment; situational)*

> Reaches past the front rank with a barbed line and yanks the coward at the back
> into the teeth of the horde.

- **Axis:** manipulating **the enemy's** positioning — an entirely new lever. Pull a
  dangerous or squishy backline enemy forward to kill it before it acts; the inverse
  variant (shove the enemy front-tank to the back) is a second unit from the same
  primitive.
- **Rough stats:** attack 2, health 3, cost 6.
- **Mechanic:** `startOfWave`, moves `enemies[last]` to the front of the enemy line.
- **Engine cost: MODERATE.** Reorders the opposing side (enemies are fresh each wave,
  so it's a per-wave reshuffle, not stateful).
- **Compounding:** none — reorders a fresh wave each time, no accumulation. Safe. Can
  be *strong* against waves built around a protected backliner, but bounded.
- **Counterplay:** useless against single-enemy waves; a purely situational tech pick,
  which is healthy (rewards reading the gauntlet theme).

### 5. Pack-Caller — tribal / adjacency synergy *(cheap; safe)*

> Louder in a crowd of its own. The more kin ride beside it, the harder it drives them.

- **Axis:** **build-around coherence** — rewards a themed board (all-Runt, all-poison)
  over a rainbow of best-in-slot picks. A deckbuilding axis the roster doesn't have yet.
- **Rough stats:** attack 2, health 3, cost 5.
- **Mechanic:** `startOfBattle`, grants adjacent rats +1/+1 **for each** other rat on
  the board sharing a tag (e.g. a `tribe` field: "runt", "plague", "brute"). Reuses
  `buffAdjacent`, scaled by a board count.
- **Engine cost: LOW.** Add an optional `tribe` tag to `UnitDef`; the effect is a
  counted `buffAdjacent`.
- **Compounding:** `startOfBattle`, fires once, bounded by board size. Safe.
- **Counterplay:** near-dead in an incoherent board; demands committing your recruits
  to a theme, which costs flexibility against the daily gauntlet.

### 6. Whistle-Cur — on-demand sacrifice *(cheap to build; DANGEROUS)*

> Blows a wet, carrying note that tells the front rat to lie down and die — so the
> ones behind can feed.

- **Axis:** turns the **faint economy** (Corpse-Glutton, Bone-Priest, Gnawer, Weeping
  Boil) from reactive to *controllable* — you choose when a rat dies to trigger the
  payoffs. High strategic ceiling.
- **Mechanic (as tempting, DO NOT SHIP AS-IS):** `startOfWave`, fell `horde[0]` to
  fuel on-faint effects.
- **Compounding: EXPLOIT-CLASS.** This is a literal on-demand faint engine feeding
  `gainStats`/`revive` — the exact Rat-Piper×Corpse-Glutton shape the 2026-07-11 hunt
  flagged (#82), except *worse* because it doesn't even need summon chaff. A per-wave
  version is an instant, unbounded stat/revive loop.
- **If pursued at all:** gate hard — `startOfBattle` (once ever), or once-per-battle,
  and only ship it *after* the Corpse-Glutton allyFaint cap decision (#82) lands, with
  a dedicated compounding canary. Documented here mainly as a **cautionary concept**:
  the sacrifice fantasy is great, but it's the most direct path to the project's
  third shipped compounding incident.

---

## Cross-cutting engine investments (each unlocks a family)

Rather than one-off code per unit, three primitives each open several future units:

- **A. Backline damage path** (unlocks Slink-Rat + future dart/hex/marksman rats, and
  cleanly reframes the old Blight-Witch "ranged" option). Biggest unknown; highest
  leverage. Worth a spike to derisk before committing a season to it.
- **B. Mid-battle repositioning primitive** (unlocks Bolt-Hole + "shove ally forward" /
  "rotate the line" / self-retreat units). Moderate, self-contained.
- **C. Enemy-order manipulation** (unlocks Gutter-Hook + enemy-backline-debuff units).
  Moderate, self-contained.

## Rough prioritization for the next content season

1. **Pack-Caller** — cheap, safe, adds a real deckbuilding axis. Ship first, low risk.
2. **Cellar-Coil** — cheap once the cap + canary are in; adds back-slot value.
3. **Slink-Rat + primitive A** — the flagship archetype; do the spike first, then it
   pays off for several seasons.
4. **Bolt-Hole (primitive B)** and **Gutter-Hook (primitive C)** — one per following
   season, each carrying its reusable primitive.
5. **Whistle-Cur** — parked behind #82 and a canary; may never ship as-is.

Every one of these needs the standard treatment before it's real: a compounding-law
note in-code, a targeted probe (not just the generic benchmarks — see the execute /
combo blind spots), and a cost/efficiency pass. Rough is rough.
