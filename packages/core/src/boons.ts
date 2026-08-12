import { xorshift128 } from './prng';
import { fnv1a } from './seed';
import { BOARD_CAP } from './sim';
import type { Lineup, LineupUnit } from './data/units';

/**
 * Daily PvP boons (issue #184, design bank in `docs/design/boons.md`).
 *
 * Every dawn, every player is offered the SAME three boons and picks ONE. The
 * pick applies to that night's league round and nothing else. This module owns
 * what the pool is and which three a given ride-date offers; it does not apply
 * anything — the effects are read by the duel path in later phases.
 *
 * Four rules this module exists to enforce:
 *
 * 1. **Pure function of the ride-date.** Same derivation shape as
 *    `anomalyFor(seasonId)` and `generateGauntlet`'s theme roll
 *    (`xorshift128(fnv1a(...))`), so the day's offer is re-derivable anywhere
 *    with no stored state and no server round-trip. Never wall-clock, never
 *    per-account, never `Math.random`.
 *
 *    This is what makes the offer ENFORCEABLE rather than merely shared: the
 *    nightly job re-derives the trio and rejects a pick that wasn't on it, so
 *    an edited client can't field a boon it was never offered. That check is
 *    the only server-side authority in the whole boon path — the board itself
 *    is client-trusted by design (see `validateBoard`'s note in pvp.ts).
 *
 * 2. **PvP-only.** A boon touches `simulateDuel` and nothing else: no gauntlet
 *    effect, no economy effect, no shop effect. This is load-bearing, not
 *    tidiness. A duel is ONE wave (see `duel.ts`), so a once-per-battle effect
 *    has nothing to compound against and ADR-0003's compounding law is
 *    structurally inapplicable — which is the entire reason combat boons can
 *    ship at all. The moment a boon reaches the 45-wave gauntlet that argument
 *    dies and the law applies in full.
 *
 * 3. **One end of a line, or the whole line — never an arbitrary slice.**
 *    Positional boons read `units[0]` or `units[n - 1]` and nothing between.
 *    They exist to invalidate an opponent's ORDERING, and ordering is the one
 *    lever a player fully controls; a boon that could reach the middle would
 *    make every slot need hedging, and the counter-play would collapse from
 *    "protect your ends" into "field interchangeable rats". Stat boons carry
 *    no such risk (they move nobody) and are not restricted to the ends. What
 *    is ruled out for both is the arbitrary slice — neither cheap to reason
 *    about nor free of reasoning, for no design gain.
 *
 * 4. **Insertion order is the roll order and is load-bearing. APPEND ONLY.**
 *    Same rule as `ANOMALY_DEFS`, with one extra consequence worth knowing:
 *    because the draw is keyed on the ride-date rather than the season, adding
 *    an entry re-maps HISTORICAL days too, not just future ones. That is
 *    harmless only because nothing re-derives a past day's trio — the duel
 *    replay reveals each entrant's boon from the round's stored snapshot, and
 *    `isBoonOffered` is only ever asked about the round currently being
 *    scored. Do not add a caller that re-derives an old date's offer.
 */

/**
 * What a boon actually does. Nothing consumes this yet — phase 1 (#184) is
 * plumbing only, and the duel-side application lands in later phases. It is
 * defined now so the pool is authored against a real shape rather than a
 * placeholder, and so adding the application is a pure read of data that
 * already exists.
 *
 * Every magnitude below is a PLACEHOLDER. Numbers come from the `pvp:boons`
 * measurement pass, not from this file — see #184's measurement section, and
 * note that two entries (`silenceFront`, `deepScout`) resist a fixture sweep
 * by construction and must not be tuned off it alone.
 *
 * `self` / `opponent` in each doc line is which board the effect reads, which
 * is also the ordering it resolves in: buffs first, opponent-side positional
 * manipulation LAST, so a displacement can push a buffed rat off the front but
 * can never erase the buff (#184 rule 2).
 */
export type BoonEffect =
  /** opponent — their `units[n - 1]` moves to `units[0]`. */
  | { kind: 'dragBackToFront' }
  /** opponent — their `units[0]` moves to `units[n - 1]`. */
  | { kind: 'buryFrontToBack' }
  /**
   * self — a throwaway body is inserted at `units[0]`.
   *
   * Two things make this more than a chump block, both worth preserving when
   * it is implemented. It eats the enemy front's FIRST-hit relic bonus:
   * `firstAttackDone` is a per-unit flag that both `bonusOf` and
   * `ignoresArmorOf` read, so Glass Shard's armour-ignoring opener gets spent
   * on a worthless body. And it shifts the whole line back one, so an
   * opponent's `dragBackToFront` pulls a different rat than they aimed at.
   *
   * The body must NOT count against `combatCap` (each duel board carries its
   * own — see `simulateCore`'s cap split), or the boon is dead weight on a
   * full board, which is most boards by midweek.
   */
  | { kind: 'decoyFront' }
  /**
   * opponent — their `units[0]` loses its ABILITY for the duel. Relics are
   * untouched: a silenced rat keeps Marrow-Snap, keeps Glass Shard, and keeps
   * Weeping Boil, which is a relic rather than a unit ability and so still
   * detonates on death.
   *
   * Aimed at the front on purpose. `buffBehind` buffs the rats behind its
   * caster, so its carrier wants to stand at or near the front for coverage —
   * which is exactly where this lands, making it a reliable answer to
   * position-dependent buffs. Whole-board grants (`teamBuff`,
   * `teamBuffByWave`, `grantArmor { all: true }`) fire the same from any slot
   * and are caught only if the player happened to lead with them. The
   * counter-play that creates — don't lead with your team-buffer — costs
   * something real, since a `buffBehind` carrier gives up reach by moving
   * back.
   */
  | { kind: 'silenceFront' }
  /** self — `units[0]` gains health. */
  | { kind: 'frontHealth'; amount: number }
  /**
   * self — `units[n - 1]` gains attack.
   *
   * Must be applied as an `attackBuffs` grant rather than a raw `attack`
   * write. The `backlineDamage` path sums base attack, relics, team attack and
   * `attackBuffs` while deliberately excluding `tierAttackMultiplier`, so a
   * raw write would silently fail to reach a backline attacker — the one
   * board shape this boon is most obviously for.
   */
  | { kind: 'backAttack'; amount: number }
  /** opponent — their `units[n - 1]` loses attack. */
  | { kind: 'sapBackAttack'; amount: number }
  /**
   * self, client-only — reveals every rival's exact roster for the day.
   *
   * The single boon with no sim surface at all: it flips `scoutLevel` in the
   * app from the basic aggregate to the exact-roster render path, which is
   * already fully wired and dormant behind a hardcoded constant.
   *
   * It reveals ROSTERS, not other players' boon picks. Picks are secret until
   * the round is scored, and keeping them secret from this boon too is what
   * keeps the pick layer a clean simultaneous reveal for everyone.
   */
  | { kind: 'deepScout' }
  /**
   * self — the first N incoming attacks on this side are absorbed whole.
   *
   * Adopts orphaned plumbing rather than adding any: Ward-Weaver moved to
   * `grantArmor` on 2026-07-24 and left `blockFrontHits` with its per-side
   * `blockCharges` pool, its `shieldAbsorbed` event and its replay rendering
   * wired with zero users. The `Math.max` cap-not-sum rule on that pool exists
   * to stop a stack of casters and is irrelevant to a single, non-stackable
   * source, so this seeds the pool directly.
   */
  | { kind: 'blockHits'; hits: number }
  /**
   * self — the first unit summoned during the duel is summoned twice.
   *
   * The only entry here that is a trigger modifier rather than a pre-sim
   * transform, so it is the only one that needs a once-per-battle flag (the
   * `raised` pattern) and the only one that lands on the summon-cap coupling
   * from #105/#148. Per ADR-0007's note on `simulate`-touching content, it
   * ships with a `compounding-law.test.ts` canary as the price of admission.
   *
   * Worthless to a board with no summoner. That is accepted rather than
   * designed around (Jesper, 2026-08-12): a player holding no summoner picks
   * one of the other two. Offers are NOT filtered per board — filtering would
   * cost rule 1's derived offer and the server-side check that rides on it.
   */
  | { kind: 'echoFirstSummon' };

export interface BoonDef {
  id: string;
  /** Shown on the choice card and, after the round, in the duel replay. */
  name: string;
  /**
   * One declarative sentence, present tense, game voice.
   *
   * This is the ONLY player-facing explanation a boon ever gets — there is no
   * rules panel and no tooltip. So it must carry the MECHANIC, not just
   * atmosphere: which end of which line, and what happens to it. Same lesson
   * `ANOMALY_DEFS` records the hard way (its pure-flavour launch trio read as
   * "different flavor text" and was deleted), and the same reason Grown Past
   * Use's blurb was rewritten to state its rule outright.
   *
   * No numbers in the blurb. Magnitudes are placeholders until the measurement
   * pass, and copy that hardcodes them goes stale silently.
   */
  blurb: string;
  effect: BoonEffect;
}

/** How many boons a player chooses between each dawn. */
export const BOONS_PER_DAY = 3;

/**
 * The pool. APPEND ONLY — see rule 4 above.
 *
 * Deliberately NOT here, recorded so they are not re-proposed (full reasoning
 * in `docs/design/boons.md`):
 *   - Rotating your own line by one. Strictly dominated by the board editor —
 *     the player can already build in that order for free. This generalises:
 *     a boon must do something the player cannot already do for nothing.
 *   - Swapping the opponent's front two. Too small to notice, which is the
 *     exact failure that got the original anomaly launch trio deleted on
 *     2026-08-08 after it had already shipped.
 *   - Reversing the opponent's whole line ("About Face"). Not rejected —
 *     held. On any board of three or more it strictly dominates
 *     `dragBackToFront`, and shipping both would make one of them dead.
 *   - Granting the backline-damage path to your own rearmost rat ("Long
 *     Knives"). Also held rather than rejected; good shape, held only to keep
 *     the launch roster small.
 */
export const BOON_DEFS: Record<string, BoonDef> = {
  drag: {
    id: 'drag',
    name: 'Dragged Forward',
    blurb: "Your rival's hindmost rat is hauled to the front of their line.",
    effect: { kind: 'dragBackToFront' },
  },
  buried: {
    id: 'buried',
    name: 'Buried',
    blurb: "Your rival's leading rat is shoved to the back of their line.",
    effect: { kind: 'buryFrontToBack' },
  },
  'a-body-first': {
    id: 'a-body-first',
    name: 'A Body First',
    blurb: 'A runt takes the front of your line. It dies first, so nothing better does.',
    effect: { kind: 'decoyFront' },
  },
  silence: {
    id: 'silence',
    name: 'Silence',
    blurb: "Your rival's leading rat forgets its trick. Its charms still work.",
    effect: { kind: 'silenceFront' },
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    blurb: 'Your leading rat takes the field heavier than it left the warren.',
    effect: { kind: 'frontHealth', amount: 4 },
  },
  blunt: {
    id: 'blunt',
    name: 'Blunt',
    blurb: "Your rival's hindmost rat comes to the fight with a dulled tooth.",
    effect: { kind: 'sapBackAttack', amount: 2 },
  },
  rearguard: {
    id: 'rearguard',
    name: 'Rearguard',
    blurb: 'Your hindmost rat sharpens up while it waits its turn.',
    effect: { kind: 'backAttack', amount: 2 },
  },
  'deep-scout': {
    id: 'deep-scout',
    name: 'Deep Scout',
    blurb: "You read every rival's line tonight, rat by rat.",
    effect: { kind: 'deepScout' },
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    blurb: 'The first blows against your line land on nothing at all.',
    effect: { kind: 'blockHits', hits: 2 },
  },
  echo: {
    id: 'echo',
    name: 'Echo',
    blurb: 'The first rat your warren calls up answers twice.',
    effect: { kind: 'echoFirstSummon' },
  },
};

/**
 * The first ride-date that offers boons. Compared as a string, which is safe
 * because ride-dates are zero-padded `YYYY-MM-DD` (`currentRideDate`).
 *
 * DORMANT ON PURPOSE. Phase 1 of #184 is plumbing only — the pool above is
 * authored but NOTHING applies any of its effects yet, so a date that has
 * already passed would offer players three cards that do nothing. This
 * sentinel is the launch switch: move it to the intended Monday only once the
 * effects land, and only for boons whose effects are actually implemented.
 *
 * Boons launch on a season reset rather than mid-week, deliberately. League
 * points accumulate across the week, so introducing a new rule on day 5 makes
 * the standings at either end of one season mean different things.
 */
export const BOON_FIRST_DATE = '2099-01-01';

/**
 * The three boons offered on `rideDate` — identical for every player, derived,
 * never stored.
 *
 * Returns an empty array before `BOON_FIRST_DATE`, which is what makes the
 * feature dormant by construction rather than by a flag someone can forget.
 *
 * The draw is a partial Fisher-Yates over pool INDICES, which gives three
 * distinct boons (a naive three-times-`int(len)` would let a day offer the
 * same boon twice) while touching the rng exactly `BOONS_PER_DAY` times, so
 * the sequence stays stable if `BOONS_PER_DAY` ever changes.
 */
export function boonsFor(rideDate: string): BoonDef[] {
  if (rideDate < BOON_FIRST_DATE) return [];
  const pool = Object.values(BOON_DEFS);
  if (pool.length <= BOONS_PER_DAY) return pool.slice();

  const rng = xorshift128(fnv1a(`${rideDate}#boons`));
  const order = pool.map((_, i) => i);
  for (let i = 0; i < BOONS_PER_DAY; i++) {
    const j = i + rng.int(order.length - i);
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order.slice(0, BOONS_PER_DAY).map((i) => pool[i]);
}

/**
 * Was `boonId` on `rideDate`'s menu? The server-side authority over a
 * submitted pick — the nightly job asks this before honouring one, so a client
 * cannot field a boon it was never offered.
 *
 * Only ever ask about the round being scored. Re-deriving an old date's offer
 * is not sound once the pool has grown (rule 4); a past round's actual picks
 * live in its stored snapshot, which is also what the duel replay reveals.
 *
 * A null/absent pick is legal everywhere — not picking is a valid state and
 * means no boon, never an auto-pick (#184 rule 7).
 */
export function isBoonOffered(rideDate: string, boonId: string | null | undefined): boolean {
  if (boonId === null || boonId === undefined) return true;
  return boonsFor(rideDate).some((b) => b.id === boonId);
}

/**
 * The body A Body First shoves to the front.
 *
 * Gutter Runt rather than a bespoke def: it is already exactly 1/1 and
 * abilityless, it already has art, and it was retired from the shop pool
 * outright (issue #109, `retireDay: 1`) — so nobody can buy one, and seeing
 * one lead a line is itself a signal that something unusual happened. Reusing
 * a retired rat as the body the warren throws away is also the truer reading
 * of the boon than minting a new rat for the job.
 *
 * Note this is a cost-2 unit, so unlike a cost-0 summon body `validateBoard`
 * will ACCEPT it on a submitted board. That is not a new hole: the validator
 * deliberately checks structural legality and not affordability (see its doc
 * comment), so a hand-edited payload could already field eight ★3 rats. A
 * free 1/1 is not the exploit worth closing.
 */
export const DECOY_DEF_ID = 'gutter-runt';

/**
 * Which side an effect reads. Self-effects touch the picker's own board;
 * opponent-effects touch the board across the table.
 */
function isSelfEffect(e: BoonEffect): boolean {
  switch (e.kind) {
    case 'dragBackToFront':
    case 'buryFrontToBack':
    case 'silenceFront':
    case 'sapBackAttack':
      return false;
    default:
      return true;
  }
}

/** Shallow-copies the entry at `index` and hands it to `patch`. Never mutates
 * the caller's Lineup — `scoreRound` reuses the same board object across every
 * duel of a round, so an in-place write would leak a boon into the next fight. */
function patchUnit(
  lineup: Lineup,
  index: number,
  patch: (u: LineupUnit) => LineupUnit
): Lineup {
  const units = lineup.units.slice();
  if (index < 0 || index >= units.length) return lineup;
  units[index] = patch({ ...units[index] });
  return { ...lineup, units };
}

/** Moves the unit at `from` to `to`, preserving the order of everything else. */
function moveUnit(lineup: Lineup, from: number, to: number): Lineup {
  const units = lineup.units.slice();
  if (units.length < 2) return lineup;
  const [moved] = units.splice(from, 1);
  units.splice(to, 0, moved);
  return { ...lineup, units };
}

/** Apply one boon to the board of the player who picked it. */
function applySelf(lineup: Lineup, e: BoonEffect): Lineup {
  const last = lineup.units.length - 1;
  switch (e.kind) {
    case 'frontHealth':
      return patchUnit(lineup, 0, (u) => ({ ...u, boonHealth: (u.boonHealth ?? 0) + e.amount }));
    case 'backAttack':
      return patchUnit(lineup, last, (u) => ({ ...u, boonAttack: (u.boonAttack ?? 0) + e.amount }));
    case 'decoyFront': {
      // The decoy must not eat a combat-cap slot, or the boon is dead weight
      // on a full board — which is most boards by midweek. Each duel side
      // carries its own cap (see simulateCore), so raising this one by exactly
      // the body we added keeps the picker's real capacity untouched.
      const cap = (lineup.combatCap ?? BOARD_CAP) + 1;
      return { ...lineup, units: [{ defId: DECOY_DEF_ID }, ...lineup.units], combatCap: cap };
    }
    default:
      // deepScout is client-only; blockHits and echoFirstSummon are phase 5.
      return lineup;
  }
}

/** Apply one boon to the board of the player who did NOT pick it. */
function applyOpponent(lineup: Lineup, e: BoonEffect): Lineup {
  const last = lineup.units.length - 1;
  switch (e.kind) {
    case 'sapBackAttack':
      return patchUnit(lineup, last, (u) => ({ ...u, boonAttack: (u.boonAttack ?? 0) - e.amount }));
    case 'dragBackToFront':
      return moveUnit(lineup, last, 0);
    case 'buryFrontToBack':
      return moveUnit(lineup, 0, last);
    default:
      // silenceFront is phase 3.
      return lineup;
  }
}

/**
 * Resolve both boards for a duel, applying each side's boon. THE one place the
 * ordering rule lives — every caller goes through here so the client replay and
 * the nightly job cannot disagree about what a fight looked like.
 *
 * Order, per #184 rule 2:
 *   1. each side's SELF effect on its own board;
 *   2. each side's OPPONENT effect on the other board.
 *
 * Buffs therefore land before any displacement, which is what makes a
 * displacement able to push a buffed rat off the front without ever erasing
 * the buff — the grant rides on the unit, not on the slot. A board takes at
 * most one opponent effect (its opponent holds one boon), so step 2 has no
 * internal ordering to resolve.
 *
 * Every read is a SNAPSHOT of the board as submitted (rule 3): `units[0]` and
 * `units[n - 1]` are resolved against the line as it stands when that step
 * runs, never against whoever happens to be front once the fight is moving.
 *
 * Pure — inputs are never mutated. That matters because `scoreRound` reuses
 * one board object across every duel of a round-robin, so an in-place write
 * would leak a boon into the next fight.
 */
export function boardsForDuel(
  a: Lineup,
  boonA: BoonEffect | null | undefined,
  b: Lineup,
  boonB: BoonEffect | null | undefined
): { a: Lineup; b: Lineup } {
  let outA = boonA && isSelfEffect(boonA) ? applySelf(a, boonA) : a;
  let outB = boonB && isSelfEffect(boonB) ? applySelf(b, boonB) : b;
  if (boonA && !isSelfEffect(boonA)) outB = applyOpponent(outB, boonA);
  if (boonB && !isSelfEffect(boonB)) outA = applyOpponent(outA, boonB);
  return { a: outA, b: outB };
}

/** The effect a boon id names, or null for no pick / an unknown id. */
export function boonEffect(boonId: string | null | undefined): BoonEffect | null {
  if (!boonId) return null;
  return BOON_DEFS[boonId]?.effect ?? null;
}
