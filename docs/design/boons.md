# Daily PvP boons — design bank

Design bank for the daily boon system (issue #184). Written 2026-08-12, after the
patron/companion framing (#114) was dropped in favour of a bare choice screen.

Same status convention as `future-minions.md`: **concepts, not committed content**,
except where a rule is marked as a decision. Numbers throughout are placeholders —
they come from a measurement pass, not from this file.

This file is the design bank. Issue #184 is the build spec. When they disagree, the
issue wins for *what gets built* and this file wins for *why*.

---

## What the system is

Every dawn, every player is offered **the same three boons** and picks **one**. The
pick applies to that night's 22:00 league round and nothing else. The three on offer
rotate daily, drawn from a shared pool.

The point is season identity without unit churn: under the nightly league, a boon is
the axis where your week diverges from five rivals who chose differently, and it costs
no new unit authoring to keep producing different weeks.

---

## Decided rules

Owner decisions (Jesper, 2026-08-12). Not open for re-litigation.

1. **Boons are PvP-only.** They apply inside `simulateDuel` and nowhere else. No
   gauntlet effect, no economy effect, no shop effect.
2. **Buffs resolve first; the opponent's positional manipulation resolves last.** A
   displacement boon can push a buffed rat off the front, but never erases the buff.
3. **Positional boons snapshot the line as submitted.** They read `units[0]` /
   `units[n-1]` once, before the sim starts. They never follow whoever is currently
   front.
4. **One pick per player per day.** No stacking, no carry-over, no combining.
5. **The three on offer are identical for every player**, derived from the ride-date.
   No per-player rolls, no rerolls.
6. **No grouping.** The trio is three draws from one flat pool. An
   aggressive/defensive/tactical split was considered and dropped as premature — it
   constrains authoring before there is any evidence about what the pool needs.
7. **No pick means no boon.** Never an auto-pick. A random default would hand the
   disengaged path an edge it didn't choose, which makes the mechanic dishonest.

### Why PvP-only is the load-bearing rule

A duel is **one wave** (`duel.ts`). A once-per-battle effect in a one-wave battle has
nothing to compound against, so ADR-0003's compounding law is structurally
inapplicable — which is what lets combat boons ship at all.

This inverts the earlier recommendation in #165, which favoured economy-only boons
and parked the combat ones. That reasoning assumed combat meant the 45-wave gauntlet,
where the compounding law bites hard. Narrowing scope to the duel removed the risk
rather than adding to it.

---

## The targeting principle

**A boon targets one end of a line, or the whole line — never an arbitrary slice.**

The narrow version of this rule ("positional boons only touch `units[0]` and
`units[n-1]`") is what was originally proposed, and it is correct for positional
boons specifically. The reason is worth being precise about, because it determines
how far the rule generalises:

Positional boons exist to **invalidate the opponent's ordering**. Ordering is the one
strategic lever a player fully controls, so a boon that can reach into the middle of
the line makes ordering unreasonable — you would have to hedge every slot. Restricting
manipulation to the two ends means you hedge your ends and the middle of your board
stays yours. That is what keeps the counter-play "protect your ends" rather than
"build interchangeable rats," which would collapse board diversity.

**Stat boons do not carry that risk** and are not restricted to the ends. A stat boon
that touches the whole team moves no rats and invalidates no ordering decision. It is
a legitimate shape.

What is ruled out in both cases is the **arbitrary slice** — "your last two," "the
middle three." A slice is neither an end (cheap to reason about) nor the whole line
(no reasoning needed); it is the shape that makes a board hard to think about for no
design gain. This is why the original `Rearguard` spec ("+attack on your last two")
trims to the backmost only.

---

## Roster

### Shipping

| Boon | Effect | Class |
|---|---|---|
| **Drag** | The opponent's `units[n-1]` moves to their `units[0]` | pre-sim lineup write |
| **Buried** | The opponent's `units[0]` moves to their `units[n-1]` | pre-sim lineup write |
| **A Body First** | A 1/1 body is inserted at the front of your own line | pre-sim lineup write |
| **Silence** | The opponent's `units[0]` loses its ability for the duel | pre-sim instantiate flag |
| **Bulwark** | +X health on your `units[0]` | pre-sim stat write |
| **Blunt** | −X attack on the opponent's `units[n-1]` | pre-sim stat write |
| **Rearguard** | +X attack on your `units[n-1]` | pre-sim stat write |
| **Deep Scout** | Read every rival's exact roster for the day | client-only, no sim |
| **Guardian** | Block the first X incoming attacks on your side | adopts orphaned plumbing |
| **Echo** | The first unit summoned in combat is summoned twice | trigger modifier |

### Held

- **Long Knives** — your `units[n-1]` gains `backlineDamage` for the duel. Good shape
  and nearly free (it reuses the Slink-Rat / MBP Rat primitive exactly), and
  self-limiting by accident: that code sums base attack + relics + team attack +
  `attackBuffs` while deliberately excluding `tierAttackMultiplier`, so parking a 3★
  monster at the back yields its base attack, not 9×. Held only to keep the launch
  roster small.
- **About Face** — reverse the opponent's entire line. Held because on any board of
  three or more it strictly dominates Drag, and Drag is the better design: surgical,
  leaves the rest of the opponent's plan intact. Shipping both would make one dead.
- **Silence (backmost)** — a sibling that strips the opponent's `units[n-1]` ability.
  Held to ship after the frontmost version, so the two are not introduced as a
  confusing pair.

### Rejected, with reasons

- **Wheel** (rotate your own line by one) — strictly worse than building the board in
  that order in the first place. Any self-repositioning boon is dominated by the board
  editor. This generalises: **a boon must do something the player cannot already do
  for free.**
- **Shove** (swap the opponent's front two) — too small to notice. This is the exact
  failure that got the original anomaly trio (One Warren / Teeming Dark / Two Warrens)
  deleted on 2026-08-08 after shipping.

---

## Engine notes

Grounded against the code, 2026-08-12. These are the facts the roster leans on.

**The line is an ordered array and the clash is strictly front-vs-front.** `horde[0]`
against `enemies[0]` each tick; the dead rotate out and the next steps up. Everything
positional is therefore an array permutation applied before `simulateCore` is called.

**Drag hard-counters backline attackers for free.** The `backlineDamage` case in
`sim.ts` breaks when `index === 0` — a unit at the front already deals damage through
the normal clash, so the backline path is skipped to avoid a double-dip. It fires at
`startOfWave`, which is *inside* the sim and therefore after every pre-sim transform.
So dragging a backline attacker to the front disables its ability outright and exposes
its body. Two units carry it today: Slink-Rat and **MBP Rat** (`attack: 4, health: 1`),
which dies to the first clash tick once dragged.

**A Body First eats first-hit relic bonuses.** `firstAttackDone` is a per-unit flag,
and both `bonusOf` and `ignoresArmorOf` read it. The enemy front's first attack lands
on whatever is in front of it — so a decoy spends Glass Shard's armour-ignoring opener
on a 1-health body. The decoy must **not** count against `combatCap` (each duel board
carries its own, `sim.ts:405`) or the boon is a dud on full boards, which is most
boards by midweek.

**Silence strips the ability only, never relics.** Abilities come from `UNIT_DEFS` at
instantiate time, so Silence needs an optional per-entry flag on the Lineup that
`instantiate` respects — slightly deeper than an array write, still pre-sim, no
sim-logic change. Consequences worth stating in the copy: a silenced rat keeps
Marrow-Snap, keeps Glass Shard, and **keeps Weeping Boil** (`relics.ts:106` — it is a
relic, not a unit, so a silenced carrier still detonates on death). What Silence does
reach on the front slot is unit faint triggers: Brood-Mother's death-summon,
Bone-Priest's revive, and the runt faint payloads.

**Silence removes buffs, because a buff unit's buff *is* its ability** — and the front
slot turns out to be the right place to aim it, for a reason that is a property of the
engine rather than a coincidence. The split matters:

- **Position-dependent buffs are reliably hit.** `buffBehind` buffs the units behind
  its caster, so a `buffBehind` carrier wants to sit at or near the front to cover the
  most rats. That puts it exactly where front-Silence lands. This is why front-Silence
  is well-targeted rather than a coin flip.
- **Position-independent buffs are hit only by accident.** `teamBuff`, `teamBuffByWave`
  and `grantArmor { all: true }` fire the same wherever their caster stands, so
  front-Silence catches them only if the player happened to put that rat first.

The counter-play this creates is exactly the kind the system wants: *don't lead with
your team-buffer*. It is an ordering decision with a real cost, since a `buffBehind`
carrier gives up coverage by moving back. Note the boon fires pre-sim, so a silenced
buff never applies at all — there is no partial-buff or already-applied case to resolve.

**Guardian has no collision.** Ward-Weaver moved to `grantArmor` on 2026-07-24, leaving
`blockFrontHits` and the whole `blockCharges` machinery — pool, `shieldAbsorbed` event,
replay rendering — wired with zero shipped users. Guardian adopts it. The `Math.max`
cap-not-sum rule on that pool exists to stop stacked casters and is irrelevant to a
single non-stackable source.

**Positional boons re-target support buffs for free.** `buffAdjacent` and `buffBehind`
read a unit's live board position, so any displacement silently changes who the
opponent's support rats are buffing. Depth at no code cost.

**Boons cannot be aimed.** `scoreRound` is all-vs-all: every entrant duels every other
entrant once. A boon applies across all of a player's duels that night. Deep Scout
reads the field, not a target; Drag displaces every opponent's backmost.

---

## The choice screen

**Placement: not a dawn gate.** Boons are PvP-only, and at 06:00 the player has not
built the board the boon applies to — no shop seen, no idea what they can afford. A
gate at dawn maximises pick rate and minimises pick quality. Instead the card lives at
the top of the league panel with a persistent unpicked marker, and the screen surfaces
itself once the day's board sync settles. Unmissable, never between the player and the
ride.

**The trio stays readable all day, and after lock.** Players need to see what the three
options were while positioning their board, and after the round to reason about what
rivals could have taken. The screen is a permanent fixture of the day, not a one-shot
prompt.

**Picks are secret until the round is scored, then revealed in the replay.** Decided
2026-08-12, reversing an earlier draft that let the pick ride in the anon-readable
`pvp_boards.board` payload. A visible pick turns the choice into a counter-picking race
rather than a read; hiding it until reveal makes it a genuine simultaneous commitment.

This is a commit-reveal without any cryptography, because the server holds the secret:
the pick lives in its own table with no anon access, the nightly job reads every pick
under the service role, and the boon is written into the round's snapshotted boards —
which are already public post-round for the duel replay (`bbc9ee9`). So the reveal
surface already exists; the boon just has to ride along in the snapshot.

The honest cost: this gives up the cheapest part of the original plan. Riding in the
board jsonb meant no schema change and no new RPC. Secrecy means a new table plus a
write RPC and a read-own RPC, both security-definer and keyed on `device_id` (which is
no longer published to anon as of `b6489d8` — that is the boundary secrecy leans on).

**Picks stay changeable until 22:00.** The decision survives the secrecy reversal but
its reasoning does not, so re-deriving it: the original argument was that public picks
would make "lock on pick" degenerate, since the correct play would be to pick last after
reading everyone else's commitment, and all six players would sit until 21:59. With
secret picks that argument is void — nobody can read anyone. What remains is simpler and
still points the same way: a changeable pick is a pure simultaneous-reveal game with one
lock moment shared with the board, and there is no longer any downside to weigh against
it.

**Copy.** One declarative sentence per card, in the game's voice, no numbers and no
category tags. Cards stack vertically — three across at phone width gives ~100px
columns and tap targets below the 44px floor. Colours from the tokens per ADR-0006.

**The overnight state is unspecified.** Rounds close at 22:00 but ride-dates roll at
06:00 (`currentRideDate`), leaving eight hours where the player's ride-date belongs to
a round that has already fought — the same seam that caused the 2026-07-21
no-rides-overnight bug. Most likely the same screen with the cards inert and the footer
swapped to a countdown, but it needs designing.

---

## Open

- X values for every boon. From a `pvp:boons` measurement pass, not guessed.
- How large the pool needs to be before the daily rotation reads as a rotation rather
  than a near-fixed trio.
- Whether the trio should avoid repeating a boon on adjacent days (the Slay the Spire
  rule, cited in #165's design refresh).
- The overnight/locked screen state.

## A note on measuring boons

The pass/fail bar is that **no boon may be a dominant pick**. In a six-player league
where everyone scouts everyone, a single best boon is identified within a week and the
mechanic collapses into a mandatory tap.

But one boon resists the fixture sweep by construction. **Silence is read-dependent** —
against a vanilla front with no ability it does literally nothing, against a support
front it is devastating. It will measure poorly on an averaged sweep and well in live
play, so a sweep alone must not decide its fate. The same caution applies to Deep Scout,
whose entire value is information a simulation cannot act on.
