import { xorshift128 } from './prng';
import { fnv1a } from './seed';

/**
 * Weekly anomalies (issue #141, specced in ROADMAP.md's "Seasons, Anomalies &
 * Live-Ops" section).
 *
 * A season's only automatic week-to-week variance today is the gauntlet
 * reseeding — the theme rolls a new primary/secondary/pivot and that's it.
 * That reads as "same game, different flavor text" once a player knows the
 * four archetypes, and it pushed every ounce of real novelty onto hand-
 * authored unit churn. An anomaly is ONE deterministic modifier per season,
 * derived from the season id, applied identically to all seven days for
 * every player — so the week has an identity that a roster swap can't give it.
 *
 * Three rules this module exists to enforce:
 *
 * 1. **Pure function of the season id.** Same derivation shape as
 *    `generateGauntlet`'s theme roll (`xorshift128(fnv1a(...))`), so an
 *    anomaly is as verifiable and as shareable as the gauntlet itself, and
 *    `supabase/functions/verify-scores` can re-derive it server-side from
 *    `scores.season_id` with no payload change. Never wall-clock, never
 *    per-account, never `Math.random`.
 *
 * 2. **An anomaly must do something the theme roll cannot.** This is the
 *    trap the first draft of the launch trio fell into: "Plague Week =
 *    force the plague archetype" is not an anomaly, because the theme
 *    already rolls plague as primary roughly one week in four. Every entry
 *    below therefore moves a knob that is otherwise CONSTANT for all time —
 *    the primary/secondary budget shares, the pivot wave's floor, or the
 *    per-wave unit cap.
 *
 * 2b. **Do not force an archetype.** This rule originally rested on two
 *    independent arguments. ADR-0007 killed the first one; the second still
 *    stands on its own, so the rule stands.
 *
 *    The DEAD argument (difficulty): measured 2026-07-29 via
 *    `scripts/anomaly-guardrail.ts`, forcing swarm lifted a maxed board's
 *    average depth by up to +7.3 waves and forcing armored dropped p95 from
 *    38 to 30, because the four archetypes are not balanced against each
 *    other in a front-clash sim. That used to disqualify an anomaly outright.
 *    Under ADR-0007 it no longer does — a week-wide difficulty shift is
 *    symmetric across players and the PvP league absorbs it.
 *
 *    The LIVE argument (variance): "the warren commits to one archetype"
 *    plays differently every week, where "this week is armored" plays the
 *    same every time it comes up. A forced archetype is a fixed puzzle on a
 *    rotation, not a new one. The 2026-08-08 cull deleted three anomalies for
 *    exactly this failure — being technically a modifier while being
 *    functionally the same week — so this argument is now the better
 *    evidenced of the two, not the weaker one. An anomaly reshapes how the
 *    week is composed and lets the season keep deciding what it is composed
 *    of.
 *
 *    `GauntletOverrides` therefore still has no `primary` field. If ROADMAP's
 *    Archetype Lock is ever revived it must answer the variance objection
 *    first (it is no longer blocked on a board partition, only on being
 *    interesting), and it must resolve the collision where the forced primary
 *    is the archetype the season already rolled as its secondary — swap the
 *    two rather than re-rolling, so the secondary stays a pure function of
 *    the same stream position.
 *
 * 3. **No carve-outs from the Compounding Law (ADR-0003).** #141 explicitly
 *    rejects candidates like "poison persists across waves this week." The
 *    horde is one persistent object across 45 waves; a weekly exemption from
 *    the cap rule is how you ship the next Warren-Warden. This rule is
 *    absolute and ADR-0007 does not touch it.
 *
 *    It is NOT the same rule as "never touch `simulate`", though the two
 *    coincided for as long as every anomaly was a `generateGauntlet`
 *    override. Now that depth-distorting candidates are back on the table
 *    (Sudden Death turns revive/heal off, which is a `simulate` change), the
 *    line worth drawing is: flipping a rule OFF for the week is fine, because
 *    it cannot compound; adding a repeatable permanent effect is never fine,
 *    however it is scoped. A `simulate`-touching anomaly needs a
 *    `compounding-law.test.ts` canary, which is the price of admission for
 *    that category and the reason the shop-side ones stay cheaper to ship.
 */
export interface GauntletOverrides {
  /** Fraction of each wave's budget force-spent on the primary (base 0.6). */
  primaryShare?: number;
  /** Fraction force-spent on the secondary once pivoted (base 0.25). */
  secondaryShare?: number;
  /** Force the wave the secondary starts mustering from (base rolls 4–7). */
  pivotWave?: number;
  /** Bodies allowed in one wave (base `WAVE_UNIT_CAP` = 5). */
  waveUnitCap?: number;
}

/**
 * Shop-side override — absent (`undefined`) for every anomaly through
 * `two-warrens`. Grown Past Use (#165 Part 2 follow-up) is the first
 * exception to the "anomalies only override `generateGauntlet`" rule from
 * this file's header: it reaches into `rollOfferings` instead, so it carries
 * zero `simulate`/compounding surface (ADR-0003 still holds — this never
 * touches a unit's in-battle behavior) but is the first to touch the economy.
 */
export interface ShopOverrides {
  /** Once any copy of a unit reaches `MAX_TIER` on board or bench, exclude
   * it from the shop's unit pool for the rest of the week (`shop.ts`'s
   * `shopExclusionsFor`, re-derived live every roll — same mechanism as the
   * existing owned-team-relic filter). */
  excludeMaxedUnits?: boolean;
}

export interface AnomalyDef {
  id: string;
  /** Shown on the shop banner and in the scout report. */
  name: string;
  /** One line, grimy, present tense — matches `scout.ts`'s flavor voice. */
  blurb: string;
  /**
   * Does this anomaly move absolute depth materially against a clean week?
   *
   * **This is no longer a ship gate (ADR-0007).** It used to be: anything
   * past ~±2 waves was held back until a per-week board partition existed,
   * which shelved every genuinely eventful candidate and left only
   * composition reshuffles — all three of which were deleted on 2026-08-08
   * for being too small to notice. The firewall protected max-depth
   * comparability on a global cross-week board; the nightly PvP league
   * (#154/#157) is the scoring metric now, and it settles between players
   * INSIDE one week, so a week-wide difficulty shift is symmetric and comes
   * out in the wash.
   *
   * The flag survives as measured information, not permission: it labels the
   * week, and it is what a restored depth board (#172) would partition on.
   * Still set it from `balance:anomaly` rather than guessing, and still keep
   * each entry's measured note — the number is worth knowing even though it
   * no longer decides anything.
   *
   * What DOES gate an anomaly now: the playability floor (does a realistic
   * player still have a week worth riding — `balance:realistic`, not the
   * maxed-board fixture) and the income coupling (depth-proportional income
   * per ADR-0002 means a harder week shrinks the PvP board everyone can
   * field). See `scripts/anomaly-guardrail.ts`.
   */
  distorting: boolean;
  gauntlet: GauntletOverrides;
  /** See `ShopOverrides`. Absent = no shop-side effect (every anomaly before
   * Grown Past Use). */
  shop?: ShopOverrides;
  /**
   * Extra board slots granted for the week, free — the stated Trial
   * compensation (Twist/Trial split, posted to #165) for whatever tax the
   * anomaly levies. 0/absent for every Twist (no cost, no compensation
   * needed). Applied once, at the week's first `newBuild` — never re-granted
   * per dawn, see `advanceAfterDawn`.
   */
  bonusBoardSlots?: number;
}

/**
 * `one-warren`, `teeming-dark`, and `two-warrens` (the original launch trio,
 * all pure `generateGauntlet` overrides) were removed 2026-08-08: they read
 * as "same game, different flavor text" in play, and Grown Past Use is the
 * only entry that changes how the week is actually built (the board you can
 * field) rather than just reshaping enemy wave composition. `ANOMALY_DEFS`
 * having a single entry is intentional, not a placeholder — `anomalyFor`
 * degenerates to "every season past `ANOMALY_FIRST_SEASON` draws Grown Past
 * Use" as a result, which is correct.
 *
 * Deliberately NOT here:
 *   - Bounty Run / any scrap multiplier — two reasons now. #141 requires a
 *     fresh `npm run snowball` audit (economy multipliers are the one
 *     category that can re-open the snowball question), and #163 measured a
 *     surplus already: a day-3 45-clearer banks ~3 000 scrap against a board
 *     costing 600-1 400. Adding scrap solves nothing anyone has. A scrap
 *     SINK is the interesting direction — see #176.
 *   - A second `rearguard` per wave — #138 capped that at one on purpose
 *     after an unchecked sweep flooded deep waves with four Sluice-Wardens.
 *     Relaxing a knob with that history wants its own measured pass.
 *
 * No longer parked here, per ADR-0007: The Long Dark (start at wave N) and
 * Sudden Death (revive/heal off) were held back only because they are
 * depth-distorting by construction, and distortion stopped being
 * disqualifying when the PvP league became the scoring frame. They are now
 * ordinary candidates that need the playability-floor and income measurements
 * like anything else. Archetype Lock stays out, but on rule 2b's variance
 * argument rather than its difficulty one.
 *
 * Insertion order is the roll order and is load-bearing: adding an entry in
 * the middle re-maps which anomaly every future season draws. Append only.
 */
export const ANOMALY_DEFS: Record<string, AnomalyDef> = {
  'grown-past-use': {
    id: 'grown-past-use',
    name: 'Grown Past Use',
    // This blurb is the ONLY player-facing explanation of the anomaly — there
    // is no rules panel, no hint when an excluded unit stops appearing, and
    // nothing else announces `bonusBoardSlots`. So it has to carry the trigger
    // (★3), the duration (the week) and the compensation (the slot), not just
    // atmosphere. The pure-flavour blurbs the removed launch trio used were
    // fine for anomalies that only reshaped what you FOUGHT; this one changes
    // what you can BUILD, and an unexplained unit vanishing from the shop
    // reads as a bug. Rewritten 2026-08-09 (Jesper) — the original second
    // clause ("the warren spends its scrap where it hasn't spoken yet") had an
    // unresolvable pronoun, a metaphor with no in-game referent, and implied
    // the player's scrap was redirected when only the shop's offer pool
    // changes. Same class of copy bug as issue #50 (Ward-Weaver's ambiguous
    // pronoun); keep future anomaly blurbs concrete for the same reason.
    blurb: 'Take a rat to ★3 and the shop is done with its kind for the week. One extra slot to ride with — small comfort.',
    // A Trial, not a Twist (#165's Twist/Trial split): a real tax on whoever
    // built around a strong tier-3 carry, so it ships with the stated
    // same-week compensation below rather than reading as "just harder" —
    // per the design-bank rule this issue's design-refresh comment set.
    //
    // `distorting` measures whether an ALREADY-MAXED board's depth ceiling
    // moves against the CLEAN gauntlet (anomaly-guardrail.ts's method) — this
    // anomaly sets no `gauntlet` override at all, so that measurement is
    // trivially zero and `false` here is correct BY THAT DEFINITION, but it
    // is not the number that matters for this entry. This anomaly's real
    // cost lands entirely on which boards are BUILDABLE during the week, not
    // on enemy composition, so the guardrail that actually speaks to it is a
    // `balance:realistic`-shaped economy pass with the exclusion wired into
    // the shop calls, not `balance:anomaly`. See
    // `scripts/grown-past-use-reachability-probe.ts`: the exclusion makes any
    // comp needing two tier-3 copies of the SAME defId (`original`,
    // `press-kin-core` in both guardrail fixtures) structurally unreachable —
    // a hard 12-base-copy ceiling against the 18 two tier-3s need, confirmed
    // empirically, not a probability question. That's an intended
    // consequence of the mechanic as specified, not a bug — those fixtures
    // need a documented exception for anomaly weeks, not this anomaly needing
    // a carve-out.
    distorting: false,
    gauntlet: {},
    shop: { excludeMaxedUnits: true },
    // Reuses `purchasedSlots` (an existing player-local upgrade, normally
    // bought with scrap) rather than a scrap discount — same reasoning that
    // made Rat of Wealth the safe v1 patron pick in the #165 thread: no new
    // sync/anti-cheat surface, nothing to re-derive server-side beyond what
    // `verify-scores` already ignores (the shop journey itself is never
    // synced, only the final board).
    bonusBoardSlots: 1,
  },
};

/**
 * First season that can draw an anomaly. Seasons before this stay clean.
 *
 * ROADMAP asks for the first weeks of the game's life to run clean so
 * newcomers learn the base rules and the all-time baseline stays honest;
 * the game has been live since 2026-07-04, so that debt is paid on its own
 * terms. Lexicographic compare, the same check `App.svelte`'s dawn rollover
 * already uses on `build.seasonId` — and it holds for re-issue tokens too,
 * since those keep the natural Monday as their first 10 chars
 * ('2026-07-13.2' still sorts before '2026-08-10').
 *
 * 2026-08-03 is taken: that's the PvP-league cutover (#154/#157), and
 * moving to points-scored-per-night rather than max depth is itself a big
 * enough rule change for one week. Anomalies start the Monday after, so the
 * league gets one clean baseline week before the rules start moving and a
 * bad night has one unambiguous cause (issue #165).
 */
export const ANOMALY_FIRST_SEASON = '2026-08-10';

/**
 * The season's anomaly, or `null` for a clean week.
 *
 * Seeded off a `#anomaly` sub-key of the season id, exactly as
 * `generateGauntlet` derives its waves from a `#waves` sub-key of the same
 * id — so the anomaly roll is independent of the theme roll (a season can't
 * have its anomaly correlated to its primary archetype) while staying a pure
 * function of the same input. A mid-season re-issue reseeds the anomaly
 * along with everything else, which is the intended behavior: a re-issued
 * season is a new season.
 */
export function anomalyFor(seasonId: string): AnomalyDef | null {
  if (seasonId < ANOMALY_FIRST_SEASON) return null;
  const pool = Object.values(ANOMALY_DEFS);
  if (pool.length === 0) return null;
  const rng = xorshift128(fnv1a(`${seasonId}#anomaly`));
  return pool[rng.int(pool.length)];
}
