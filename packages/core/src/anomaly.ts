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
 * 2b. **Do not force an archetype.** Measured 2026-07-29 via
 *    `scripts/anomaly-guardrail.ts`: forcing the primary archetype is not a
 *    variance knob at all, it is a DIFFICULTY knob, because the four
 *    archetypes are not balanced against each other in a front-clash sim.
 *    Forcing swarm lifted a maxed board's average depth by up to +7.3 waves
 *    (a budget spent on cheap chaff is far easier than the same budget spent
 *    on brutes — the same asymmetry ADR-0003 records for armor); forcing
 *    armored dropped p95 from 38 to 30. Both are depth-distorting by a wide
 *    margin. Every knob that leaves the season's OWN rolled primary alone
 *    measured neutral. So an anomaly reshapes how the week is composed and
 *    lets the season keep deciding what it is composed of — which is also
 *    the better design: "the warren commits to one archetype" plays
 *    differently every week, where "this week is armored" plays the same
 *    every time it comes up.
 *
 *    `GauntletOverrides` therefore has no `primary` field. If a future
 *    distorting anomaly (ROADMAP's Archetype Lock) ever needs one, it must
 *    (a) go behind the season-6 board partition, and (b) resolve the
 *    collision where the forced primary is the archetype the season already
 *    rolled as its secondary — swap the two rather than re-rolling, so the
 *    secondary stays a pure function of the same stream position.
 *
 * 3. **No carve-outs from the Compounding Law (ADR-0003).** #141 explicitly
 *    rejects candidates like "poison persists across waves this week." The
 *    horde is one persistent object across 45 waves; a weekly exemption from
 *    the cap rule is how you ship the next Warren-Warden. Note that every
 *    launch anomaly is a `generateGauntlet` override and touches `simulate`
 *    not at all — that is deliberate for v1, and it means the trio carries
 *    zero compounding surface by construction.
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

export interface AnomalyDef {
  id: string;
  /** Shown on the shop banner and in the scout report. */
  name: string;
  /** One line, grimy, present tense — matches `scout.ts`'s flavor voice. */
  blurb: string;
  /**
   * Comparability firewall (ROADMAP: "never let a distorting week write the
   * global frame"). `false` = depth stays comparable to a clean week, so the
   * season rides the normal board. `true` = the anomaly moves absolute depth
   * enough that its scores must be partitioned off the global/all-time board.
   *
   * This flag is NOT a guess — it is set from the balance gate
   * (`balance:maxed-board-guardrail` against the current 43/45 ceiling), and
   * an anomaly whose measured ceiling moves more than ~±2 waves must be
   * flipped to `true` and held back until the season-6 board partitioning
   * exists. See each entry's measured note below.
   */
  distorting: boolean;
  gauntlet: GauntletOverrides;
}

/**
 * The launch trio. All three are pure `generateGauntlet` overrides — no
 * `simulate` change, no economy change, no new trigger — which is what makes
 * them the safe first cut per #141's "safe by construction" classification.
 *
 * Deliberately NOT in v1:
 *   - Bounty Run / any scrap multiplier — #141 requires a fresh
 *     `npm run snowball` audit first; economy multipliers are the one
 *     category that can re-open the snowball question.
 *   - The Long Dark (start at wave N), Sudden Death (revive/heal off),
 *     Archetype Lock — all depth-DISTORTING by construction, so they wait
 *     for the season-6 per-week board partition.
 *   - A second `rearguard` per wave — #138 capped that at one on purpose
 *     after an unchecked sweep flooded deep waves with four Sluice-Wardens.
 *     Relaxing a knob with that history is not a launch-week move.
 *
 * Insertion order is the roll order and is load-bearing: adding an entry in
 * the middle re-maps which anomaly every future season draws. Append only.
 */
export const ANOMALY_DEFS: Record<string, AnomalyDef> = {
  'one-warren': {
    id: 'one-warren',
    name: 'One Warren',
    blurb: 'One warren rides this week, and it has emptied itself into the dark.',
    // Mono-theme week. A clean wave force-spends 60% of its budget on the
    // primary and 25% on the secondary, with the remainder rolled free
    // across all archetypes — so no season can ever be much more than 60%
    // one thing. 0.9 is a shape the generator has never produced. WHICH
    // archetype it commits to is still the season's own roll, per rule 2b,
    // so this plays as a different puzzle each time it comes up.
    // Measured neutral: Δavg +0.05..+0.24, ΔMAX 0..+1 across all three
    // maxed comps (scripts/anomaly-guardrail.ts).
    distorting: false,
    gauntlet: { primaryShare: 0.9 },
  },
  'teeming-dark': {
    id: 'teeming-dark',
    name: 'Teeming Dark',
    blurb: 'The tunnels will not hold them all. They come anyway, one rank too deep.',
    // WAVE_UNIT_CAP has been 5 for the whole life of the game, so this is
    // the clearest "the rules moved" signal available without touching the
    // sim. Front-clash means a 6th body is mostly queue depth rather than
    // extra simultaneous damage, which is why one more rank costs a maxed
    // board only about a wave and a half instead of collapsing it.
    // Re-measured against the current roster (`balance:anomaly`, post
    // unit-churn): Δavg -1.56..-1.65, ΔMAX -1 on two comps but -3 on
    // press-kin-core — the worst comp decides, and -3 breaches the ±2
    // threshold. Flipped from the original launch measurement (Δavg
    // -1.2..-1.8, ΔMAX -1 flat, all inside threshold at the time). Still the
    // only entry meaningfully HARDER than a clean week; held back with the
    // other depth-distorting candidates until the season-6 board partition,
    // per #165 Part 1 — not gated out of ANOMALY_DEFS today since nothing
    // yet consumes this flag at runtime.
    distorting: true,
    gauntlet: { waveUnitCap: 6 },
  },
  'two-warrens': {
    id: 'two-warrens',
    name: 'Two Warrens',
    blurb: 'Two warrens ride together this week. Neither waits its turn.',
    // The secondary normally musters from wave 4–7 at a 0.25 share against
    // the primary's 0.6, so a clean week always opens single-archetype and
    // never stops being primary-dominated. pivotWave 1 plus an even 0.45/0.45
    // split makes the week genuinely two-headed from the first clash — the
    // counter-building decision moves to wave 1, and neither archetype is the
    // one you can afford to ignore.
    //
    // The even split is load-bearing, not flavour. The first cut kept the
    // primary at 0.6 and merely raised the secondary to 0.4, which measured
    // as a NO-OP on 62 of 200 seasons: the secondary phase is bounded by what
    // its archetype can afford out of the wave budget, not by its quota, so
    // raising the quota alone frequently changes nothing and the week would
    // have announced an anomaly that wasn't there. Lowering the PRIMARY is
    // what actually frees the budget. Now 0/200 no-ops, 33.5 of 45 waves
    // changed per season.
    // Measured neutral: Δavg -0.14, ΔMAX 0.
    distorting: false,
    gauntlet: { primaryShare: 0.45, secondaryShare: 0.45, pivotWave: 1 },
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
