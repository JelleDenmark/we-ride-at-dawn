<script lang="ts">
  // Orientation for a cold read of this ~2300-line file (search for these
  // anchors rather than reading linearly):
  //   - Imports from `core` (below) — this file is UI/orchestration only;
  //     all game logic (gauntlet/sim/shop rules) lives in packages/core.
  //   - `onMount(...)` — PWA update/install-prompt wiring.
  //   - "Idle heartbeat" comment — the hourly auto-ride loop: advances the
  //     day at each dawn boundary, runs `simulate()` for elapsed hours,
  //     updates scrap/seasonBest/ride log. This is the real economy loop;
  //     `packages/core/scripts/snowball.ts` models the same loop headlessly.
  //   - `stopReplay` / `skipReplay` — the "watch the next ride" replay
  //     controls (a live preview of the current build, not a past ride).
  //   - `clickShopSlot` and nearby — shop purchase/reroll/freeze actions,
  //     thin wrappers around the pure functions imported from `core`'s
  //     `shop.ts` (this file never mutates game rules itself).
  //   - `fetchTop` / `fetchRank` — leaderboard panel data, from `leaderboard.ts`.
  //   - the closing script tag below this block — the markup/template
  //     starts right after it; component state above is what drives it.
  import { onMount } from 'svelte';
  import {
    currentRideDate,
    dailySeed,
    generateGauntlet,
    simulate,
    UNIT_DEFS,
    RELIC_DEFS,
    newBuild,
    advanceAfterDawn,
    weekdayFor,
    seasonIdFor,
    interestFor,
    scrapForDepth,
    SEASON_DAYS,
    buyUnit,
    canRecruit,
    buyRelic,
    hasValidRelicTarget,
    sellUnit,
    sellBenchUnit,
    sellRefund,
    rerollShop,
    autoRerollShop,
    toggleFreeze,
    moveUnit,
    benchUnit,
    deployUnit,
    swapWithBench,
    lineupFromBuild,
    unitStats,
    REROLL_COST,
    combatCapForBuild,
    BENCH_SIZE,
    effectiveBoardCap,
    nextSlotPrice,
    buyBoardSlot,
    upcomingUnlocks,
    tierAttackMultiplier,
    tierHealthMultiplier,
    reviveHpForTier,
    poisonStacksForTier,
    simulateBossTrial,
    type ActionResult,
    type BattleResult,
    type BuildState,
    type TimeOfDay,
    type UnitDef,
  } from '@wrad/core';
  import { ReplayPlayer } from './replay/ReplayPlayer';
  import { CHANNEL } from './env';
  import { ART_URL } from './art';
  import {
    savePending as saveBuild,
    loadPending,
    saveLastRide,
    loadLastRide,
    saveLastIncomeHour,
    loadLastIncomeHour,
    saveSeasonBest,
    loadSeasonBest,
    saveSeasonKills,
    loadSeasonKills,
    savePlayerName,
    loadPlayerName,
    saveRideLog,
    loadRideLog,
    RIDE_LOG_MAX,
    loadInstallNudgeDismissed,
    saveInstallNudgeDismissed,
    saveBossTrialToday,
    loadBossTrialToday,
    type RideLogEntry,
    type LastRide,
    type BossTrialToday,
  } from './persistence';
  import {
    submitRun,
    telemetryConfigured,
    telemetryEnabled,
    setTelemetryEnabled,
  } from './telemetry';
  import {
    submitScore,
    fetchTop,
    fetchRank,
    defaultName,
    isMe,
    type BoardRow,
  } from './leaderboard';
  import {
    submitBossTrialScore,
    fetchBossTrialTop,
    fetchBossTrialRank,
    type BossTrialRow,
  } from './boss-trial-board';
  import { startUpdateCheck } from './updateCheck';
  import { startPwaUpdate } from './pwaUpdate';
  import { startInstallPromptCapture, promptInstall, isIOS, isStandalone } from './pwaInstall';

  function addDay(date: string): string {
    return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }

  function copenhagenSeconds(now: Date): number {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Copenhagen',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .format(now)
      .split(':')
      .map(Number);
    return p[0] * 3600 + p[1] * 60 + p[2];
  }

  // Dawn-Runt/Dusk-Runt (issue #12): which half of the day a given instant
  // falls in, Copenhagen local time — noon is the cutoff, reusing
  // copenhagenSeconds the same way the existing dawn (06:00 CET) boundary
  // does. simulate() never reads the clock itself; this is the one place
  // real wall-clock time gets resolved and threaded in via Lineup.timeOfDay.
  function timeOfDayAt(now: Date): TimeOfDay {
    return copenhagenSeconds(now) < 12 * 3600 ? 'beforeNoon' : 'afterNoon';
  }

  function fmtRideHour(hourBucket: number): string {
    const d = new Date(hourBucket * HOUR_MS);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  }

  function formatCountdown(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}h ${String(m).padStart(2, '0')}m`
      : `${m}m ${String(s).padStart(2, '0')}s`;
  }

  const HOUR_MS = 3_600_000;
  const OFFLINE_RIDE_CAP = 24; // credit at most a day of missed skirmishes at once

  // Day-1 recruitment freeze: every board resets empty at the Monday 06:00
  // CET season boundary, so a player who logs in at 06:00 can start earning
  // immediately while one who logs in at 09:00 has already missed hours with
  // nothing to show for them (an empty board earns nothing, and — unlike a
  // gap later in the week — there's no built board to retroactively credit)
  // — a standing bias against anyone not awake for a European Monday
  // morning. No hour before 10:00 CET on day 1 credits income (a 06:05
  // login and a 09:55 login are treated identically, so there's no new
  // incentive to rush-build for backdated credit). The first hour that
  // counts is the 10:00–11:00 bucket. Every other day already has a real
  // roster earning through any gap, so this only applies to day 1.
  const DAY1_CUTOFF_SEC = 10 * 3600;

  /** Whether hour bucket `h` (epoch hours) falls inside the day-1 freeze:
   * its ride-date is the season's Monday and its Copenhagen local time is
   * before 10:00. Checked per hour (not just "now") so offline catch-up on
   * day 1 skips only the frozen hours, not the ones after 10:00 — and stays
   * correct even if catch-up crosses into day 2 before it's credited. */
  function isFrozenHour(h: number, seasonId: string): boolean {
    const instant = new Date(h * HOUR_MS);
    return currentRideDate(instant) === seasonId && copenhagenSeconds(instant) < DAY1_CUTOFF_SEC;
  }

  // build.date is the current expedition day's date; the horde rides its
  // gauntlet every hour for scrap. Day is the ISO weekday (synchronized:
  // everyone shares a Monday→Sunday week).
  let build = $state<BuildState>(
    loadPending() ?? newBuild(currentRideDate(), weekdayFor(currentRideDate()))
  );
  const storedBest = loadSeasonBest(seasonIdFor(currentRideDate()));
  let seasonBest = $state(storedBest.best);
  let seasonBestHour = $state<number | undefined>(storedBest.hour);
  // Cumulative season total of enemies felled across every completed ride —
  // only climbs, resets with seasonBest. Leaderboard tiebreak under depth.
  let seasonKills = $state(loadSeasonKills(build.seasonId));
  let rideLog = $state<RideLogEntry[]>(loadRideLog(build.seasonId));
  let lastRide = $state<LastRide | null>(loadLastRide());
  let lastIncomeHour = $state<number>(loadLastIncomeHour() ?? Math.floor(Date.now() / HOUR_MS));
  let awaySummary = $state<{ rides: number; scrap: number } | null>(null);
  let nowTick = $state(Date.now());
  let speed = $state(1);

  // The ride shows the daily gauntlet: the same waves all day, every day.
  const currentGauntlet = $derived(generateGauntlet(build.date, build.day));
  const theme = $derived(currentGauntlet.theme);
  // Live outcome of the current horde on the next ride — updates as you
  // build (and as the hour flips, and as the noon boundary flips — Dawn-Runt/
  // Dusk-Runt care about it), so you see your depth change in real time.
  const currentOutcome = $derived(
    build.board.length > 0
      ? simulate(
          { ...lineupFromBuild(build), timeOfDay: timeOfDayAt(new Date(nowTick)) },
          currentGauntlet
        )
      : null
  );
  const currentDepth = $derived(currentOutcome ? currentOutcome.result.wavesCleared : 0);
  const scrapPerHour = $derived(scrapForDepth(currentDepth));
  // Rats gated to a later day (issue #12 and friends) are otherwise
  // invisible until the day they show up in the shop pool — nothing told
  // players they existed at all. Soonest-unlocking first.
  const upcoming = $derived(upcomingUnlocks(build.day));
  // True only during the day-1 recruitment freeze (see isFrozenHour above) —
  // drives the idle-panel status line. The live ride preview below is
  // unaffected: it always simulates the current board, freeze or not.
  const inRecruitmentWindow = $derived(
    isFrozenHour(Math.floor(nowTick / HOUR_MS), build.seasonId)
  );
  // While frozen, the first ride is 10:00 CET, not the next wall-clock hour
  // (which could be hours away from 10:00 on an early-morning day-1 login) —
  // count down to the actual freeze boundary instead.
  const secondsToNextHour = $derived(
    inRecruitmentWindow
      ? DAY1_CUTOFF_SEC - copenhagenSeconds(new Date(nowTick))
      : 3600 - (Math.floor(nowTick / 1000) % 3600)
  );
  let telemetry = $state(telemetryEnabled());

  // Leaderboard identity: a themed default until the player names their
  // warlord (keyed by the anonymous device id, renameable).
  let playerName = $state(loadPlayerName() ?? '');
  let nameEntryOpen = $state(loadPlayerName() === null);
  let nameDraft = $state(playerName || defaultName());
  let board = $state<BoardRow[]>([]);
  let myRank = $state<number | null>(null);
  let boardBusy = $state(false);

  async function refreshBoard() {
    boardBusy = true;
    try {
      const [rows, rank] = await Promise.all([
        fetchTop(build.seasonId, 20),
        fetchRank(build.seasonId, seasonBest, seasonKills),
      ]);
      board = rows;
      myRank = rank;
    } finally {
      boardBusy = false;
    }
  }

  // Daily Boss Trial (issue #107, Phase 1 — a leaderboard number only, no
  // rewards). `bossTrial` is today's stored result (persistence.ts, keyed by
  // seasonId+day — the same primitive `build.day` already is elsewhere in
  // this file); non-null means the once-per-day gate is used and the "run"
  // button below stays disabled until the next day/season rollover reloads
  // it back to null.
  let bossTrial = $state<BossTrialToday | null>(loadBossTrialToday(build.seasonId, build.day));
  let bossTrialBoard = $state<BossTrialRow[]>([]);
  let bossTrialRank = $state<number | null>(null);
  let bossTrialBoardBusy = $state(false);
  let bossTrialRunning = $state(false);

  // Reload the daily gate whenever the day or season changes (dawn advance,
  // week rollover, dev fast-forward) — loadBossTrialToday's seasonId+day
  // match already encodes "is today's trial available", so simply re-reading
  // it here is the entire reset; no separate zeroing step like seasonBest
  // needs on season change (that one isn't scoped to the day, this is).
  $effect(() => {
    bossTrial = loadBossTrialToday(build.seasonId, build.day);
  });

  async function refreshBossTrialBoard() {
    bossTrialBoardBusy = true;
    try {
      const [rows, rank] = await Promise.all([
        fetchBossTrialTop(build.seasonId, 20),
        bossTrial ? fetchBossTrialRank(build.seasonId, bossTrial.damage, bossTrial.phases) : Promise.resolve(null),
      ]);
      bossTrialBoard = rows;
      bossTrialRank = rank;
    } finally {
      bossTrialBoardBusy = false;
    }
  }

  /** Run the live board through the trial once, bank the local daily-best
   * gate immediately (so a dropped/slow submit can't reopen the button), and
   * fire-and-forget the score to the board. Disabled by the template
   * whenever `bossTrial` is already set or the board is empty. */
  async function runBossTrial() {
    if (bossTrial !== null || bossTrialRunning || build.board.length === 0) return;
    bossTrialRunning = true;
    try {
      const result = simulateBossTrial(lineupFromBuild(build));
      const today: BossTrialToday = { damage: result.totalDamage, phases: result.phasesSurvived };
      bossTrial = today;
      saveBossTrialToday(build.seasonId, build.day, today.damage, today.phases);
      // Same guard as submitBest: an unnamed device still gets the local
      // gate/result, it just doesn't post to the shared board until named.
      if (playerName) {
        await submitBossTrialScore({
          seasonId: build.seasonId,
          name: playerName,
          damage: today.damage,
          phases: today.phases,
          day: build.day,
          lineup: lineupFromBuild(build),
        });
      }
      await refreshBossTrialBoard();
    } finally {
      bossTrialRunning = false;
    }
  }

  // Guard so an unchanged best/name/day doesn't re-POST on every rebuild.
  let lastSubmit = '';
  async function submitBest() {
    if (!playerName || seasonBest <= 0) return;
    const sig = `${build.seasonId}|${playerName}|${seasonBest}|${build.day}|${seasonKills}`;
    if (sig === lastSubmit) return;
    lastSubmit = sig;
    await submitScore({
      seasonId: build.seasonId,
      name: playerName,
      depth: seasonBest,
      day: build.day,
      lineup: lineupFromBuild(build),
      rideHour: seasonBestHour,
      kills: seasonKills,
    });
    await refreshBoard();
  }

  function confirmName() {
    const n = nameDraft.trim().slice(0, 24) || defaultName();
    playerName = n;
    savePlayerName(n);
    nameEntryOpen = false;
    lastSubmit = ''; // force a resubmit so the board shows the new name
    void submitBest();
  }

  function openRename() {
    nameDraft = playerName;
    nameEntryOpen = true;
  }

  let pendingRelic = $state<number | null>(null);
  // Armed "pick a rat to swap out" mode: holds the bench index waiting to be
  // swapped onto the board. Mirrors pendingRelic's armed-selection pattern;
  // only one of the two can be armed at a time (arming either clears both).
  let pendingSwap = $state<number | null>(null);
  let inspect = $state<{ area: 'shop' | 'board' | 'bench'; index: number } | null>(null);
  let notice = $state('');

  const TRIGGER_WHEN: Record<string, string> = {
    startOfBattle: 'At the start of the ride,',
    startOfWave: 'At the start of every wave,',
    faint: 'When it faints,',
    afterAttack: 'After it attacks,',
    allyFaint: 'Whenever a friendly rat faints,',
  };

  const TIME_OF_DAY_LABEL: Record<string, string> = {
    beforeNoon: ' (before noon)',
    afterNoon: ' (after noon)',
  };

  // --- Inspect-sheet ability text (Jesper, pre-launch): the tile shows only
  // a keyword tag, so THIS is where a player learns what a unit really does —
  // including exactly how much it scales per star. Numbers come from the same
  // core tables the sim uses (never hand-copied), so they can't drift.

  // Shared per-star blurb builder: `mult(t)` is the per-tier stat multiplier,
  // which differs by effect (the 3x `tierAttackMultiplier` curve for fire-once
  // buffs vs. the shallow linear curve gainStats uses — see the two wrappers
  // below). Numbers come from the same core tables the sim uses, never
  // hand-copied, so display can't drift from the mechanic.
  function buffScaleWith(attack: number, health: number, mult: (t: number) => number): string {
    const at = (t: number) =>
      health > 0 && attack > 0
        ? `+${attack * mult(t)}/+${health * mult(t)}`
        : attack > 0
          ? `+${attack * mult(t)} attack`
          : `+${health * mult(t)} health`;
    return `${at(1)} (★2 ${at(2)} · ★3 ${at(3)})`;
  }

  /** "+2/+2 (★2 +6/+6 · ★3 +18/+18)" for the 3x-per-star buff curve. */
  function buffScale(attack: number, health: number): string {
    return buffScaleWith(attack, health, tierAttackMultiplier);
  }

  /**
   * "+1/+1 (★2 +2/+2 · ★3 +3/+3)" for the SHALLOW linear (1/2/3) per-star
   * curve. gainStats is the sole buff sim.ts scales by a flat `* tier` rather
   * than `tierAttackMultiplier` (1/3/9): its `allyFaint` trigger repeats every
   * wave, so the shallow curve is deliberate to keep the compounding bounded
   * (see compounding-law.test.ts's allyFaint canary). Using `buffScale` here
   * would over-promise +9/+9 at ★3 when the sim actually grants +3/+3.
   */
  function gainStatsScale(attack: number, health: number): string {
    return buffScaleWith(attack, health, (t) => t);
  }

  function abilitySentence(defId: string): string {
    const def = UNIT_DEFS[defId];
    // Passive armor is not an `ability`, but it's absolutely something the
    // player must be told about — Dire-Rat's whole identity lives here.
    const armor = def?.damageReduction ?? 0;
    const armorSentence =
      armor > 0
        ? `Shrugs off ${armor} from every blow that lands (★2 ${armor * 2} · ★3 ${armor * 3}) — a hit always lands for at least 1, and rot (poison) seeps straight through.`
        : '';
    if (!def?.ability) {
      return armorSentence || 'No special trick — just a body to swell the ranks.';
    }
    const e = def.ability.effect;
    if (e.kind === 'blockFrontHits') {
      return 'Each wave, blocks the front rat’s first incoming hit outright — whoever is front at the time. ★2 blocks the first 2 hits, ★3 the first 3. Charges reset every wave and never carry over.';
    }
    let what = '';
    switch (e.kind) {
      case 'summon': {
        const name = UNIT_DEFS[e.unitId]?.name ?? e.unitId;
        what = `summons ${e.count} ${name}${e.count > 1 ? 's' : ''} (★2 ${e.count * 2} · ★3 ${e.count * 3}) in front`;
        break;
      }
      case 'buffBehind':
        what = `grants ${buffScale(e.attack, e.health)} to ${e.all ? 'every rat behind it' : 'the rat behind it'}`;
        break;
      case 'bequeathAttack':
        what = `passes its OWN current attack to the rat behind it, plus a bonus for how deep into the ride it fell (capped at ${e.waveBonusCapMultiplier}× its own attack) — the rat right behind it inherits everything; the last slot has nobody to pass it to`;
        break;
      case 'poisonFrontEnemy':
        what = `applies ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) to the frontmost enemy — poison bites for its full count every clash and clears when the wave falls`;
        break;
      case 'poisonLastEnemy':
        what = `applies ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) to the enemy at the back of the line — poison bites for its full count every clash and clears when the wave falls`;
        break;
      case 'poisonTarget':
        what = `applies ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) to whatever it just struck`;
        break;
      case 'gainStats':
        what = `gains ${gainStatsScale(e.attack, e.health)}`;
        break;
      case 'revive':
        what = `revives your first fallen rat at ${reviveHpForTier(1)} health (★2 ${reviveHpForTier(2)} · ★3 ${reviveHpForTier(3)}), never above the rat's own max; each fallen rat can only be raised once`;
        break;
      case 'buffAdjacent':
        what = `grants ${buffScale(e.attack, e.health)} to the rat(s) beside it — a middle seat buffs both neighbours`;
        break;
      case 'teamBuff':
        what = `grants ${buffScale(e.attack, e.health)} to the whole horde, itself included`;
        break;
      case 'poisonAllEnemies':
        what = `rots every enemy in the wave with ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) — poison bites for its full count every clash, ignores armor, and clears when the wave falls`;
        break;
    }
    const when = def.ability.condition
      ? `${TIME_OF_DAY_LABEL[def.ability.condition.timeOfDay] ?? ''}`
      : '';
    const abilityPart = `${TRIGGER_WHEN[def.ability.trigger]} it ${what}${when}.`;
    return armorSentence ? `${abilityPart} ${armorSentence}` : abilityPart;
  }

  function isSummoner(defId: string): boolean {
    return UNIT_DEFS[defId]?.ability?.effect.kind === 'summon';
  }

  // Compact tile tag (issue: mobile shop overflow) — the tile shows only a
  // symbol + 1-2 word keyword; the full sentence lives in the inspect sheet
  // (abilitySentence, above) which already exists as the tap-to-detail
  // destination, so the tile no longer needs to repeat it. Symbol register
  // matches the game's existing restrained-glyph vocabulary (⚙ ❄ ✦ ★), not
  // illustrated icons or emoji.
  const TIME_OF_DAY_ICON: Record<string, string> = { beforeNoon: '☀', afterNoon: '☾' };

  function keywordTag(def: UnitDef): string | null {
    const ability = def.ability;
    if (ability) {
      switch (ability.effect.kind) {
        case 'summon':
          return '❋ summon';
        case 'buffBehind':
        case 'buffAdjacent':
        case 'gainStats':
        case 'bequeathAttack':
          return '▲ buff';
        case 'teamBuff': {
          const icon = ability.condition ? (TIME_OF_DAY_ICON[ability.condition.timeOfDay] ?? '▲') : '▲';
          return `${icon} buff`;
        }
        case 'poisonFrontEnemy':
        case 'poisonLastEnemy':
        case 'poisonTarget':
        case 'poisonAllEnemies':
          return '☠ poison';
        case 'revive':
          return '✚ revive';
        case 'blockFrontHits':
          return '⛨ block';
      }
    }
    if ((def.damageReduction ?? 0) > 0) return '⛨ armor';
    return null;
  }

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  // Stale-tab fix (PWA-SCOPE.md Phase 1): a deployed build never reaches an
  // already-open tab on its own. `updateAvailable` flips true when the
  // poller notices `./index.html` now points at a different entry bundle
  // than the one this tab booted with; `updateDismissed` hides the banner
  // until the next detection re-shows it (simple by design). Phase 2
  // (pwaUpdate.ts) feeds the same flag from a waiting service worker, so
  // there's still only ever one banner regardless of which signal fires.
  let updateAvailable = $state(false);
  let updateDismissed = $state(false);
  // Set once pwaUpdate.ts has a waiting SW ready to activate; null means
  // "no SW involved this session" (unsupported browser, or Phase 1's poll
  // fired instead) and reloadForUpdate falls back to a plain reload.
  let applyPwaUpdate: ((reload?: boolean) => Promise<void>) | null = null;

  function dismissUpdateBanner() {
    updateDismissed = true;
  }

  function reloadForUpdate() {
    if (applyPwaUpdate) {
      // Activates the waiting SW (skipWaiting) and reloads once it's in
      // control — without this, a plain location.reload() could still be
      // served by the *old* SW.
      void applyPwaUpdate(true);
    } else {
      location.reload();
    }
  }

  // Install nudge (PWA-SCOPE.md Phase 2): ROADMAP.md's retention-loop notes
  // want this surfaced after the player's first good ride, not cold on
  // load — `seasonBest > 0` (below) is exactly that gate, and it's already
  // persisted so a returning player who hasn't installed yet sees it right
  // away rather than waiting for a fresh "first" ride.
  let canInstall = $state(false); // beforeinstallprompt captured (Chromium/Android)
  let installDismissed = $state(loadInstallNudgeDismissed());
  let installOutcome = $state<'accepted' | 'dismissed' | 'unavailable' | null>(null);
  const iosInstallEligible = isIOS() && !isStandalone();
  // The actual "first good ride" gate: seasonBest only climbs from a
  // completed ride that cleared at least one wave (see the income-loop
  // effect below), so `seasonBest > 0` is precisely "the player's first
  // good ride has happened" and stays true afterward all season.
  let showInstallNudge = $derived(
    seasonBest > 0 && !installDismissed && (canInstall || iosInstallEligible)
  );
  let bannerCount = $derived(
    (updateAvailable && !updateDismissed ? 1 : 0) + (showInstallNudge ? 1 : 0)
  );

  function dismissInstallNudge() {
    installDismissed = true;
    saveInstallNudgeDismissed();
  }

  async function doInstall() {
    const outcome = await promptInstall();
    installOutcome = outcome;
    if (outcome !== 'unavailable') dismissInstallNudge();
  }

  onMount(() => {
    // Persist the income clock on first ever load so offline hours accrue
    // from here on (without this, each reload would reset the baseline).
    if (loadLastIncomeHour() === null) saveLastIncomeHour(lastIncomeHour);
    // Heal a shop that was already dead before this session — e.g. a player who
    // bought their last rat under the old "every stall must be empty" rule and
    // got stuck with no rats and only unaffordable relics. The free reroll
    // otherwise only fires reactively after a buy, so an already-dead shop
    // never self-heals; do it once on load. autoRerollShop no-ops unless dead.
    const healed = autoRerollShop(build);
    if (healed.ok) {
      build = healed.state;
      saveBuild(build);
    }
    const id = setInterval(() => (nowTick = Date.now()), 1000);
    // Load the board now, then keep it loosely fresh while the tab is open.
    void refreshBoard();
    const boardId = setInterval(() => void refreshBoard(), 60_000);
    void refreshBossTrialBoard();
    const bossTrialBoardId = setInterval(() => void refreshBossTrialBoard(), 60_000);
    const stopUpdateCheck = startUpdateCheck(() => {
      updateDismissed = false;
      updateAvailable = true;
    });
    void startPwaUpdate(() => {
      updateDismissed = false;
      updateAvailable = true;
    }).then((updateSW) => {
      applyPwaUpdate = updateSW;
    });
    const stopInstallCapture = startInstallPromptCapture(
      () => {
        canInstall = true;
      },
      () => {
        // Installed via our button or the browser's own UI — stop nudging.
        canInstall = false;
        dismissInstallNudge();
      }
    );
    void (async () => {
      player = new ReplayPlayer();
      await player.init(stageEl);
    })();
    return () => {
      clearInterval(id);
      clearInterval(boardId);
      clearInterval(bossTrialBoardId);
      stopUpdateCheck();
      stopInstallCapture();
    };
  });

  // Idle heartbeat: advance the expedition day at each dawn (a difficulty
  // step, reset after day 7), then credit the hourly skirmishes since the
  // last visit. Runs on load and each tick, but only acts on a boundary.
  $effect(() => {
    void nowTick;
    const now = new Date(nowTick);
    const today = currentRideDate(now);
    const season = seasonIdFor(today);

    let advanced = false;

    if (!build.seasonId || build.seasonId < season) {
      // A new week (or a stale/legacy build): everyone resets Monday, and a
      // mid-week joiner starts cold at the current day's difficulty. (A build
      // that's *ahead* — dev fast-forward — is left alone.)
      stopReplay();
      build = newBuild(today, weekdayFor(today));
      saveBuild(build);
      lastIncomeHour = Math.floor(nowTick / HOUR_MS);
      saveLastIncomeHour(lastIncomeHour);
      advanced = true;
    } else {
      // Same week: carry the horde forward one dawn per day elapsed.
      let guard = 0;
      while (currentRideDate(now) > build.date && guard++ < 40) {
        const lineup = lineupFromBuild(build);
        if (lineup.units.length > 0) {
          const timedLineup = { ...lineup, timeOfDay: timeOfDayAt(now) };
          const outcome = simulate(timedLineup, generateGauntlet(build.date, build.day));
          const ride: LastRide = { date: build.date, day: build.day, lineup, result: outcome.result };
          saveLastRide(ride);
          lastRide = ride;
          submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: CHANNEL === 'dev' });
        }
        const dawnInterest = interestFor(build.scrap);
        build = advanceAfterDawn(build, addDay(build.date));
        if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
        advanced = true;
      }
    }

    // Credit each elapsed hour as its own ride: the horde fights the day's
    // gauntlet, earns that ride's depth, and the ride is logged.
    // (Offline hours use the current board and day — the honest limit of
    // lazy crediting; the 24h cap keeps the drift small.)
    const nowHour = Math.floor(nowTick / HOUR_MS);
    const elapsed = Math.min(nowHour - lastIncomeHour, OFFLINE_RIDE_CAP);
    if (elapsed > 0) {
      const lineup = lineupFromBuild(build);
      let earned = 0;
      const rides: RideLogEntry[] = [];
      if (lineup.units.length > 0) {
        for (let h = nowHour - elapsed + 1; h <= nowHour; h++) {
          // Day-1 recruitment freeze: this hour bucket earned nothing for
          // anyone (see isFrozenHour) — skip it rather than credit a ride.
          if (isFrozenHour(h, build.seasonId)) continue;
          const timedLineup = { ...lineup, timeOfDay: timeOfDayAt(new Date(h * HOUR_MS)) };
          const { result } = simulate(timedLineup, generateGauntlet(build.date, build.day));
          const scrap = scrapForDepth(result.wavesCleared);
          earned += scrap;
          rides.push({
            hour: h,
            depth: result.wavesCleared,
            scrap,
            survivors: result.survivors.length,
            enemiesDefeated: result.enemiesDefeated,
          });
        }
      }
      lastIncomeHour = nowHour;
      saveLastIncomeHour(nowHour);
      if (rides.length > 0) {
        rideLog = [...rides.reverse(), ...rideLog].slice(0, RIDE_LOG_MAX);
        saveRideLog(build.seasonId, rideLog);
        // Only completed rides count toward the weekly best (the leaderboard
        // score) — a deep preview that never rides earns nothing. Same rule
        // for the cumulative kill total: it only grows from rides that ran.
        const deepest = rides.reduce((a, r) => (r.depth > a.depth ? r : a));
        if (deepest.depth > seasonBest) {
          seasonBest = deepest.depth;
          seasonBestHour = deepest.hour;
          saveSeasonBest(build.seasonId, seasonBest, deepest.hour);
        }
        seasonKills += rides.reduce((sum, r) => sum + r.enemiesDefeated, 0);
        saveSeasonKills(build.seasonId, seasonKills);
      }
      if (earned > 0) {
        build = { ...build, scrap: build.scrap + earned };
        // rides.length, not elapsed — elapsed can include day-1 frozen
        // hours that were skipped above and never became a ride.
        awaySummary = { rides: rides.length, scrap: earned };
      }
      saveBuild(build);
    } else if (advanced) {
      saveBuild(build);
    }
  });

  // The weekly best is set by completed rides (in the income loop above);
  // this effect handles the season rollover (real or dev jump) and pushes
  // improvements to the leaderboard.
  let bestSeasonId = $state(build.seasonId);
  $effect(() => {
    if (build.seasonId !== bestSeasonId) {
      bestSeasonId = build.seasonId;
      seasonBest = 0;
      seasonBestHour = undefined;
      seasonKills = 0;
      rideLog = [];
      saveSeasonBest(build.seasonId, 0);
      saveSeasonKills(build.seasonId, 0);
      saveRideLog(build.seasonId, []);
      void refreshBoard(); // new week → pull the fresh (empty) board
      void refreshBossTrialBoard(); // and the boss-trial board alongside it
    }
    // Auto-submit the season-best on any improvement (guarded so an
    // unchanged score never re-POSTs).
    void submitBest();
  });

  /**
   * Kill any in-flight or finished replay whenever `build` is replaced
   * wholesale (week reset, fresh build, dev day-advance). Without this the
   * stage keeps animating the OLD roster's fight next to a board that no
   * longer contains those rats (playtest finding, 2026-07-11). The
   * generation counter lets watchRide detect that its ride was obsoleted
   * mid-play and skip writing `result`/`phase` for a ride nobody's watching.
   */
  let replayGeneration = 0;
  function stopReplay() {
    replayGeneration++;
    // Drain an in-flight play() instantly — same trick as the skip button;
    // the next watchRide resets speed from the user's chosen multiplier.
    if (phase === 'riding' && player) player.speed = 1e9;
    phase = 'idle';
    result = null;
  }

  function freshBuild() {
    stopReplay();
    build = newBuild(build.date, build.day);
    saveBuild(build);
    inspect = null;
    pendingRelic = null;
    pendingSwap = null;
    notice = '';
  }

  function addScrap() {
    build = { ...build, scrap: build.scrap + 10 };
    saveBuild(build);
  }

  // Dev: advance one expedition day (a difficulty step; resets after day 7).
  function simulateDawn() {
    const lineup = lineupFromBuild(build);
    if (lineup.units.length > 0) {
      const timedLineup = { ...lineup, timeOfDay: timeOfDayAt(new Date()) };
      const outcome = simulate(timedLineup, generateGauntlet(build.date, build.day));
      const ride: LastRide = { date: build.date, day: build.day, lineup, result: outcome.result };
      saveLastRide(ride);
      lastRide = ride;
      submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: true });
    }
    const dawnInterest = build.day >= SEASON_DAYS ? 0 : interestFor(build.scrap);
    stopReplay();
    build = advanceAfterDawn(build, addDay(build.date));
    if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
    saveBuild(build);
    inspect = null;
    pendingRelic = null;
    pendingSwap = null;
    notice = '';
  }

  // Dev: credit some hours of idle income without waiting — simulates the
  // next h hourly gauntlets using the day's fixed gauntlet. (A scrap cheat:
  // the wall clock will ride those hours again for real.)
  // Respects the day-1 recruitment freeze by default (see isFrozenHour),
  // same as the real hourly loop, so dev-testing sees what real players see.
  // To test the game *past* the freeze, either skip past 10:00 CET first
  // with a couple of small skips, or skip enough hours in one call that the
  // later ones land after 10:00 — those still credit normally.
  function devSkipHours(h: number) {
    const lineup = lineupFromBuild(build);
    if (lineup.units.length === 0) {
      notice = 'recruit some rats first';
      return;
    }
    const nowHour = Math.floor(Date.now() / HOUR_MS);
    let earned = 0;
    const rides: RideLogEntry[] = [];
    for (let i = 1; i <= h; i++) {
      const hourBucket = nowHour + i;
      if (isFrozenHour(hourBucket, build.seasonId)) continue;
      const timedLineup = { ...lineup, timeOfDay: timeOfDayAt(new Date(hourBucket * HOUR_MS)) };
      const { result } = simulate(timedLineup, generateGauntlet(build.date, build.day));
      const scrap = scrapForDepth(result.wavesCleared);
      earned += scrap;
      rides.push({
        hour: hourBucket,
        depth: result.wavesCleared,
        scrap,
        survivors: result.survivors.length,
        enemiesDefeated: result.enemiesDefeated,
      });
    }
    if (rides.length === 0) {
      notice = 'those hours are inside the day-1 recruitment freeze (rides start 10:00 CET)';
      return;
    }
    rideLog = [...rides.reverse(), ...rideLog].slice(0, RIDE_LOG_MAX);
    saveRideLog(build.seasonId, rideLog);
    const deepest = rides.reduce((a, r) => (r.depth > a.depth ? r : a));
    if (deepest.depth > seasonBest) {
      seasonBest = deepest.depth;
      seasonBestHour = deepest.hour;
      saveSeasonBest(build.seasonId, seasonBest, deepest.hour);
    }
    seasonKills += rides.reduce((sum, r) => sum + r.enemiesDefeated, 0);
    saveSeasonKills(build.seasonId, seasonKills);
    build = { ...build, scrap: build.scrap + earned };
    awaySummary = { rides: rides.length, scrap: earned };
    saveBuild(build);
  }

  function setSpeed(s: number) {
    speed = s;
    if (player) player.speed = s;
  }

  function skipReplay() {
    if (player) player.speed = 1e9;
  }

  function jumpToFinalWave() {
    player?.jumpToLastWave();
  }

  function apply(res: ActionResult): boolean {
    if (res.ok) {
      build = res.state;
      saveBuild(build);
      notice = '';
      return true;
    }
    notice = res.reason;
    return false;
  }

  /** Apply an action and auto-reroll the shop if every rat stall is bought out
   * (relics may still linger). Used for actions that empty shop slots (buyUnit,
   * buyRelic). */
  function applyAndAutoReroll(res: ActionResult): boolean {
    if (apply(res)) {
      const autoRoll = autoRerollShop(build);
      if (autoRoll.ok) {
        build = autoRoll.state;
        saveBuild(build);
      }
      return true;
    }
    return false;
  }

  // Tapping a stall opens its inspect card; the card houses the buy/pin
  // action, so nothing is spent by accident.
  function clickShopSlot(i: number) {
    if (build.shop.slots[i].kind === 'empty') return;
    inspect = { area: 'shop', index: i };
  }

  function clickBoardUnit(boardIndex: number) {
    if (pendingRelic !== null) {
      if (applyAndAutoReroll(buyRelic(build, pendingRelic, boardIndex))) pendingRelic = null;
      return;
    }
    if (pendingSwap !== null) {
      if (apply(swapWithBench(build, boardIndex, pendingSwap))) pendingSwap = null;
      return;
    }
    inspect = { area: 'board', index: boardIndex };
  }

  // General escape hatch for armed relic/swap selection ("pick a rat to
  // carry it" / "pick a rat to swap out"). Covers any dead-end this class of
  // two-step interaction could hit — not just the all-rats-already-carry-it
  // case guarded upfront in pinRelicFromCard — e.g. arming a unit relic with
  // zero rats on the board, or simply changing your mind mid-pick.
  function cancelPending() {
    pendingRelic = null;
    pendingSwap = null;
    notice = '';
  }

  function clickBenchUnit(benchIndex: number) {
    // Relics are pinned to fighters, not bench rats — a bench tap while
    // arming a relic just does nothing (the board stays the valid target).
    if (pendingRelic !== null) return;
    // Tapping a (possibly different) bench rat while a swap is armed just
    // re-arms it on the newly tapped rat, consistent with pendingRelic
    // letting you re-pick the shop stall before landing on a rat.
    if (pendingSwap !== null) {
      pendingSwap = benchIndex;
      notice = 'pick a rat to swap out';
      return;
    }
    inspect = { area: 'bench', index: benchIndex };
  }

  function recruitFromCard(i: number) {
    if (applyAndAutoReroll(buyUnit(build, i))) inspect = null;
  }

  // The ONLY way to grow the board beyond BOARD_FLOOR, up to the hard
  // BOARD_CAP (issue #9, steepened + made purchase-only by issue #70). Not
  // gated behind the inspect card — it's a standing shop action, like reroll.
  function buySlot() {
    apply(buyBoardSlot(build));
  }

  function pinRelicFromCard(i: number) {
    const slot = build.shop.slots[i];
    if (slot.kind !== 'relic') return;
    if (RELIC_DEFS[slot.relicId].scope === 'team') {
      if (applyAndAutoReroll(buyRelic(build, i))) inspect = null;
    } else if (!hasValidRelicTarget(build, slot.relicId)) {
      // Every board rat already carries it (or the board is empty) — arming
      // "pick a rat to carry it" here would soft-lock, since every possible
      // tap would fail buyRelic's per-rat check with nothing to clear
      // pendingRelic. The card's disabled state should already prevent this
      // click, but guard here too in case it's ever called another way.
      notice = 'every rat already carries this';
    } else {
      // Unit relics need a target: close the card, arm the pick-a-rat mode.
      // Only one armed-selection mode at a time — arming this one clears
      // any armed swap.
      pendingSwap = null;
      pendingRelic = i;
      inspect = null;
      notice = 'pick a rat to carry it';
    }
  }

  function moveFromCard(delta: number) {
    if (inspect?.area !== 'board') return;
    const to = inspect.index + delta;
    if (apply(moveUnit(build, inspect.index, to))) inspect = { area: 'board', index: to };
  }

  function sellFromCard() {
    if (inspect?.area !== 'board') return;
    if (apply(sellUnit(build, inspect.index))) inspect = null;
  }

  function benchFromCard() {
    if (inspect?.area !== 'board') return;
    if (apply(benchUnit(build, inspect.index))) inspect = null;
  }

  function deployFromCard() {
    if (inspect?.area !== 'bench') return;
    if (apply(deployUnit(build, inspect.index))) inspect = null;
  }

  function swapFromCard() {
    if (inspect?.area !== 'bench') return;
    // Only one armed-selection mode at a time — arming this one clears any
    // armed relic-pin.
    pendingRelic = null;
    pendingSwap = inspect.index;
    inspect = null;
    notice = 'pick a rat to swap out';
  }

  function sellBenchFromCard() {
    if (inspect?.area !== 'bench') return;
    if (apply(sellBenchUnit(build, inspect.index))) inspect = null;
  }

  function freeze(i: number, e: Event) {
    e.stopPropagation();
    apply(toggleFreeze(build, i));
  }

  // Watch the current horde ride this hour's gauntlet (the same fight that
  // earns idle scrap). Deterministic — just a look at what your horde does.
  async function watchRide() {
    if (!player || phase === 'riding' || !currentOutcome) {
      if (build.board.length === 0) notice = 'recruit some rats first';
      return;
    }
    inspect = null;
    pendingRelic = null;
    pendingSwap = null;
    phase = 'riding';
    result = null;
    player.speed = speed;
    // Capture the outcome: the hour can flip (or the horde change) while the
    // replay runs, and the result must match the ride that was watched.
    const outcome = currentOutcome;
    const gen = replayGeneration;
    await player.play(outcome.events);
    // A build replacement (week reset / fresh build / dev day-advance) may
    // have stopped this replay mid-play — its result belongs to a roster
    // that no longer exists, so don't write it over the fresh idle state.
    if (gen !== replayGeneration) return;
    result = outcome.result;
    phase = 'done';
  }

  function backToWarren() {
    phase = 'idle';
    result = null;
  }
</script>

{#if (updateAvailable && !updateDismissed) || showInstallNudge}
  <div class="banner-stack">
    {#if updateAvailable && !updateDismissed}
      <div class="update-banner" role="status">
        <button class="update-banner-reload" onclick={reloadForUpdate}>
          ⚔ a fresh build rode in — tap to reload
        </button>
        <button class="update-banner-dismiss" onclick={dismissUpdateBanner} aria-label="dismiss"
          >✕</button
        >
      </div>
    {/if}
    {#if showInstallNudge}
      <div class="install-banner" role="status">
        {#if canInstall}
          <button class="install-banner-action" onclick={doInstall}>
            🐀 install We Ride at Dawn — ride offline, one tap away
          </button>
        {:else}
          <span class="install-banner-action install-banner-static">
            🐀 add to Home Screen (Share → Add to Home Screen) to ride offline
          </span>
        {/if}
        <button class="install-banner-dismiss" onclick={dismissInstallNudge} aria-label="dismiss"
          >✕</button
        >
      </div>
    {/if}
  </div>
{/if}

<main
  class:update-banner-open={(updateAvailable && !updateDismissed) || showInstallNudge}
  style:padding-top={bannerCount > 1 ? '104px' : undefined}
>
  <h1>WE RIDE AT DAWN</h1>
  <p class="sub">
    Week of {build.seasonId.slice(0, 10)} · day {build.day}/{SEASON_DAYS} · rides hourly{CHANNEL === 'dev'
      ? ' · dev build'
      : ''}
  </p>

  {#if CHANNEL === 'dev'}
  <div class="dev">
    <span class="panel-label">testing</span>
    <button onclick={() => devSkipHours(6)}>⏩ +6h income</button>
    <button onclick={simulateDawn}>⏭ next day</button>
    <button onclick={freshBuild}>fresh build</button>
    <button onclick={addScrap}>+10 scrap</button>
    <span class="dev-theme">theme: {theme.primary} + {theme.secondary} @ wave {theme.pivotWave}</span>
    <span class="dev-sep">·</span>
    {#each [1, 2, 4] as s}
      <button class:active={speed === s} onclick={() => setSpeed(s)}>{s}×</button>
    {/each}
    <button onclick={skipReplay} disabled={phase !== 'riding'}>skip ⏭</button>
  </div>
  {/if}

  <div class="build">
    <div class="status-row">
      <span class="scrap">⚙ {build.scrap} scrap</span>
      <span class="status-notice">
        {#if notice}<span class="notice">{notice}</span>{/if}
        {#if pendingRelic !== null || pendingSwap !== null}
          <button class="cancel-pending" onclick={cancelPending}>cancel</button>
        {/if}
      </span>
    </div>

    <div class="horde-panel">
    <div class="panel-label row-label">
      <span>your horde · {build.board.length}/{effectiveBoardCap(build)}</span>
      <span>front → into the drains</span>
    </div>
    <div class="board horde-board">
      {#each build.board as unit, bi}
        {@const stats = unitStats(unit)}
        <button
          class="tile unit-tile"
          class:selected={inspect?.area === 'board' && inspect.index === bi}
          class:pin-target={pendingRelic !== null || pendingSwap !== null}
          onclick={() => clickBoardUnit(bi)}
        >
          {#if ART_URL[unit.defId]}
            <img class="portrait" src={ART_URL[unit.defId]} alt="" />
          {/if}
          <span class="tile-name">{UNIT_DEFS[unit.defId].name}{unit.tier > 1 ? ` ★${unit.tier}` : ''}</span>
          <span class="tile-stats">{stats.attack}/{stats.health}</span>
          <span class="tile-sub">
            {#if unit.relicIds.length > 0}
              ✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
            {:else}
              {keywordTag(UNIT_DEFS[unit.defId]) ?? ''}
            {/if}
          </span>
        </button>
      {/each}
      {#each Array.from({ length: Math.max(0, effectiveBoardCap(build) - build.board.length) }) as _}
        <div class="tile empty-tile">empty</div>
      {/each}
    </div>
    {#if nextSlotPrice(build) !== undefined}
      <div class="market-actions slot-actions">
        <button
          class="buy-slot"
          disabled={build.scrap < (nextSlotPrice(build) ?? Infinity)}
          onclick={buySlot}
        >
          + warren slot ({effectiveBoardCap(build)} → {effectiveBoardCap(build) + 1}) · {nextSlotPrice(build)} scrap
        </button>
      </div>
    {/if}
    {#if build.teamRelicIds.length > 0}
      <div class="team-relics">
        Team: {build.teamRelicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
      </div>
    {/if}
    </div>

    <div class="bench-panel">
    <div class="panel-label row-label">
      <span>the bench · {build.bench.length}/{BENCH_SIZE}</span>
      <span>held back — never fights</span>
    </div>
    <div class="board bench-board">
      {#each build.bench as unit, bi}
        {@const stats = unitStats(unit)}
        <button
          class="tile unit-tile bench-tile"
          class:selected={inspect?.area === 'bench' && inspect.index === bi}
          class:arming={pendingSwap === bi}
          onclick={() => clickBenchUnit(bi)}
        >
          {#if ART_URL[unit.defId]}
            <img class="portrait" src={ART_URL[unit.defId]} alt="" />
          {/if}
          <span class="tile-name">{UNIT_DEFS[unit.defId].name}{unit.tier > 1 ? ` ★${unit.tier}` : ''}</span>
          <span class="tile-stats">{stats.attack}/{stats.health}</span>
          <span class="tile-sub">
            {#if unit.relicIds.length > 0}
              ✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
            {:else}
              {keywordTag(UNIT_DEFS[unit.defId]) ?? ''}
            {/if}
          </span>
        </button>
      {/each}
      {#each Array.from({ length: Math.max(0, BENCH_SIZE - build.bench.length) }) as _}
        <div class="tile empty-tile">empty</div>
      {/each}
    </div>
    </div>

    <div class="shop-panel">
    <div class="panel-label row-label">
      <span>the scrap-market · ⚙ {build.scrap}</span>
      <span>❄ keeps a stall when you reroll</span>
    </div>
    <div class="board">
      {#each build.shop.slots as slot, i}
        {#if slot.kind === 'unit'}
          {@const def = UNIT_DEFS[slot.defId]}
          <button
            class="tile shop-tile"
            class:frozen={build.shop.frozen[i]}
            onclick={() => clickShopSlot(i)}
          >
            {#if ART_URL[def.id]}
              <img class="portrait" src={ART_URL[def.id]} alt="" />
            {/if}
            <span class="tile-name">{def.name}</span>
            <span class="tile-stats">{def.attack}/{def.health}</span>
            <span class="tile-sub">{keywordTag(def) ?? ''}</span>
            <span class="tile-cost">⚙ {def.cost}</span>
            <span
              class="freeze"
              role="button"
              tabindex="-1"
              onclick={(e) => freeze(i, e)}
              onkeydown={() => {}}>❄</span>
          </button>
        {:else if slot.kind === 'relic'}
          {@const relic = RELIC_DEFS[slot.relicId]}
          <button
            class="tile shop-tile relic-tile"
            class:frozen={build.shop.frozen[i]}
            class:arming={pendingRelic === i}
            onclick={() => clickShopSlot(i)}
          >
            <span class="tile-name">{relic.name}</span>
            <span class="tile-sub">{relic.desc}</span>
            <span class="tile-cost">⚙ {relic.cost} · {relic.scope === 'team' ? 'whole team' : 'one rat'}</span>
            <span
              class="freeze"
              role="button"
              tabindex="-1"
              onclick={(e) => freeze(i, e)}
              onkeydown={() => {}}>❄</span>
          </button>
        {:else}
          <div class="tile empty-tile">sold</div>
        {/if}
      {/each}
    </div>
    <div class="market-actions">
      <button
        onclick={() => apply(rerollShop(build))}
        disabled={pendingRelic !== null || pendingSwap !== null}
      >↻ reroll · {REROLL_COST} scrap</button>
    </div>
    </div>

    {#if upcoming.length > 0}
      <div class="arriving">
        <span class="panel-label">arriving later this week</span>
        <div class="chips">
          {#each upcoming as def}
            <span class="chip">{def.name} · day {def.unlockDay}</span>
          {/each}
        </div>
      </div>
    {/if}

    {#if build.board.length === 0 && build.scrap > 0}
      <p class="onboarding-hint">your warren is empty — spend your {build.scrap} ⚙ to recruit your first rats</p>
    {/if}
  </div>

  <div class="phase-divider"><span>the ride</span></div>

  <div class="battle-panel">
    <div class="stage" class:hidden={phase === 'idle'} bind:this={stageEl}></div>

    {#if phase === 'riding'}
      <div class="ride-controls">
        {#each [1, 2, 4] as s}
          <button class:active={speed === s} onclick={() => setSpeed(s)}>{s}×</button>
        {/each}
        <button onclick={jumpToFinalWave}>⏭ to final wave</button>
      </div>
    {/if}

    {#if phase !== 'idle'}
      <p class="ride-caption">the next hourly ride · your horde as it stands now</p>
      {#if result}
        <p class="result">
          Your horde rides to <strong>wave {result.wavesCleared}</strong>
          &middot; {result.survivors.length > 0
            ? `⚑ the drains cleared — ${result.survivors.length} rats ride home`
            : 'until the last rat falls'}
        </p>
        <p class="result-note">the drains hold steady through the day, changing anew each dawn</p>
      {/if}
      <button class="ride" onclick={backToWarren} disabled={phase === 'riding'}>
        {phase === 'riding' ? 'Riding…' : '← back to the warren'}
      </button>
    {:else}
      <div class="idle">
        <p class="muster-line">Your horde rides the drains <strong>every hour</strong>, hauling back scrap by how deep it pushes. The drains hold steady through the day, changing anew each dawn.</p>
        {#if inRecruitmentWindow}
          <p class="onboarding-hint">recruitment window — the horde doesn't ride until <strong>10:00 CET</strong>. Build your board now; the first haul lands at 10:00.</p>
        {/if}
        <div class="idle-stats">
          <div class="stat"><span class="stat-big">{currentDepth}</span><span class="stat-lbl">next depth</span></div>
          <div class="stat"><span class="stat-big">+{scrapPerHour}</span><span class="stat-lbl">next haul</span></div>
          <div class="stat"><span class="stat-big">{formatCountdown(secondsToNextHour)}</span><span class="stat-lbl">rides in</span></div>
        </div>
        <p class="idle-note">
          {#if inRecruitmentWindow}
            "next haul" is a preview of your build, not banked yet — it won't be credited until 10:00 CET · scrap per depth cleared once rides start (deeper waves pay less) · gets tougher deeper
          {:else}
            scrap per depth cleared, every hour (deeper waves pay less) · +{interestFor(build.scrap)} interest banked each dawn · gets tougher deeper
          {/if}
        </p>
        <button class="watch" onclick={watchRide}>▶ watch the next ride</button>
        <p class="season-best">Deepest ride this week: <strong>wave {seasonBest}</strong> · resets Monday</p>
        <p class="season-kills">Rats felled this week: <strong>{seasonKills}</strong></p>
        {#if currentDepth > seasonBest}
          <p class="season-hint">the next ride will reach wave {currentDepth}</p>
        {/if}
        {#if awaySummary}
          <p class="away">While you were away: {awaySummary.rides} rides · <strong>+{awaySummary.scrap} scrap</strong>.</p>
        {/if}
        {#if rideLog.length > 0}
          <div class="ride-log">
            <div class="panel-label rl-head">recent rides</div>
            <ul class="rl-rows">
              {#each rideLog as r}
                <li class="rl-row" class:deepest={r.depth === seasonBest && r.depth > 0}>
                  <span class="rl-time">{fmtRideHour(r.hour)}</span>
                  <span class="rl-depth">wave {r.depth}{r.depth === seasonBest && r.depth > 0 ? ' ★' : ''}</span>
                  <span class="rl-kills">{r.enemiesDefeated ?? 0} felled</span>
                  <span class="rl-scrap">+{r.scrap} ⚙</span>
                  <!-- Riding until the last rat falls is the normal end of a ride;
                       only the rare full clear gets a badge. -->
                  <span class="rl-surv">{r.survivors > 0 ? '⚑ cleared the drains!' : ''}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="leaderboard">
    <div class="lb-head">
      <span class="panel-label">Deepest riders · week of {build.seasonId.slice(0, 10)}</span>
      <button class="lb-refresh" onclick={() => void refreshBoard()} disabled={boardBusy}>
        {boardBusy ? '…' : '↻'}
      </button>
    </div>
    {#if board.length === 0}
      <p class="lb-empty">{boardBusy ? 'reading the war-drums…' : 'no riders yet this week — be the first'}</p>
    {:else}
      <ol class="lb-rows">
        {#each board as row, i}
          <li class="lb-row" class:me={isMe(row)}>
            <span class="lb-rank">{i + 1}</span>
            <span class="lb-name">{row.name}{isMe(row) ? ' · you' : ''}</span>
            <span class="lb-kills">{row.kills} felled</span>
            <span class="lb-depth">wave {row.depth}</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if myRank !== null && myRank > board.length}
      <p class="lb-myrank">your rank: <strong>#{myRank}</strong> · wave {seasonBest} · {seasonKills} felled</p>
    {/if}
    <p class="lb-you">
      riding as <strong>{playerName || '—'}</strong>
      <button class="lb-rename" onclick={openRename}>rename</button>
    </p>
  </div>

  <!-- Daily Boss Trial (issue #107, Phase 1 — leaderboard number only, no
       rewards yet). The trial fights the player's LIVE current board (no
       snapshot), once per calendar day; `bossTrial` non-null means today's
       shot is already spent (persistence.ts, keyed by seasonId+day). -->
  <div class="boss-trial">
    <div class="bt-head">
      <span class="panel-label">Boss Trial · day {build.day}/{SEASON_DAYS}</span>
      <button class="lb-refresh" onclick={() => void refreshBossTrialBoard()} disabled={bossTrialBoardBusy}>
        {bossTrialBoardBusy ? '…' : '↻'}
      </button>
    </div>
    <p class="bt-blurb">
      Once a day, your live horde faces a boss. Fell it to reach the next phase — every phase the next boss hits half again as hard, until the horde falls. Score is total damage dealt.
    </p>
    {#if bossTrial}
      <p class="bt-result">Today's damage: <strong>{bossTrial.damage}</strong> · felled {bossTrial.phases} {bossTrial.phases === 1 ? 'boss' : 'bosses'} · back tomorrow</p>
    {:else}
      <button
        class="watch bt-run"
        onclick={() => void runBossTrial()}
        disabled={bossTrialRunning || build.board.length === 0}
      >
        {bossTrialRunning ? 'Fighting…' : "Run today's Boss Trial"}
      </button>
      {#if build.board.length === 0}
        <p class="bt-hint">recruit a horde first — the trial fights your live board</p>
      {/if}
    {/if}
    {#if bossTrialBoard.length === 0}
      <p class="lb-empty">{bossTrialBoardBusy ? 'reading the war-drums…' : 'no challengers yet this week — be the first'}</p>
    {:else}
      <ol class="bt-rows">
        {#each bossTrialBoard as row, i}
          <li class="bt-row" class:me={isMe(row)}>
            <span class="bt-rank">{i + 1}</span>
            <span class="bt-name">{row.name}{isMe(row) ? ' · you' : ''}</span>
            <span class="bt-phases">{row.phases} felled</span>
            <span class="bt-damage">{row.damage} dmg</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if bossTrialRank !== null && bossTrialRank > bossTrialBoard.length}
      <p class="bt-myrank">your rank: <strong>#{bossTrialRank}</strong> · {bossTrial?.damage ?? 0} dmg</p>
    {/if}
  </div>

  {#if telemetryConfigured}
    <label class="telemetry">
      <input
        type="checkbox"
        checked={telemetry}
        onchange={(e) => {
          telemetry = e.currentTarget.checked;
          setTelemetryEnabled(telemetry);
        }}
      />
      share anonymous run data to help sharpen the drains
    </label>
  {/if}

  {#if inspect}
    {@const ins = inspect}
    <div class="sheet-backdrop" role="presentation" onclick={() => (inspect = null)}>
      <div class="sheet" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
        {#if ins.area === 'shop'}
          {@const slot = build.shop.slots[ins.index]}
          {#if slot.kind === 'unit'}
            {@const def = UNIT_DEFS[slot.defId]}
            {@const afford = build.scrap >= def.cost}
            {@const recruitable = canRecruit(build, ins.index)}
            {@const copies = build.board.filter((u) => u.defId === def.id && u.tier === 1).length}
            {@const t2 = unitStats({ defId: def.id, tier: 2, relicIds: [] })}
            {@const t3 = unitStats({ defId: def.id, tier: 3, relicIds: [] })}
            <div class="card-head">
              {#if ART_URL[def.id]}<img class="card-portrait" src={ART_URL[def.id]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}</div>
                <div class="card-stats">
                  {def.attack}/{def.health}
                  <span class="card-tier">★2 {t2.attack}/{t2.health} · ★3 {t3.attack}/{t3.health}</span>
                </div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(def.id)}</p>
            {#if isSummoner(def.id)}
              <p class="card-hint">summoned rats fight beyond your warren's size (up to {combatCapForBuild(build)} in the drains)</p>
            {/if}
            <p class="card-hint">recruit three of a kind and they merge into one stronger ★ rat</p>
            <div class="card-actions">
              <button class="primary" disabled={!recruitable} onclick={() => recruitFromCard(ins.index)}>
                Recruit · ⚙ {def.cost}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if !afford}<div class="card-warn">not enough scrap</div>
            {:else if !recruitable}<div class="card-warn">the warren is full</div>
            {:else if copies >= 2}<div class="card-note">third of a kind — this buy merges them into a ★2</div>{/if}
          {:else if slot.kind === 'relic'}
            {@const relic = RELIC_DEFS[slot.relicId]}
            {@const afford = build.scrap >= relic.cost}
            {@const owned = relic.scope === 'team' && build.teamRelicIds.includes(relic.id)}
            {@const noTarget = relic.scope === 'unit' && !hasValidRelicTarget(build, relic.id)}
            <div class="card-head">
              <div class="card-relic-icon">✦</div>
              <div>
                <div class="card-name">{relic.name}</div>
                <div class="card-sub">{relic.scope === 'team' ? 'whole team' : 'pin to one rat'}</div>
              </div>
            </div>
            <p class="card-ability">{relic.desc}.</p>
            <p class="card-hint">one of each per {relic.scope === 'team' ? 'horde' : 'rat'} — no stacking duplicates</p>
            <div class="card-actions">
              <button class="primary" disabled={!afford || owned || noTarget} onclick={() => pinRelicFromCard(ins.index)}>
                {relic.scope === 'team' ? 'Add' : 'Pin'} · ⚙ {relic.cost}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if owned}<div class="card-warn">the horde already carries one</div>
            {:else if noTarget}<div class="card-warn">every rat already carries this</div>
            {:else if !afford}<div class="card-warn">not enough scrap</div>{/if}
          {/if}
        {:else if ins.area === 'board'}
          {@const unit = build.board[ins.index]}
          {#if unit}
            {@const def = UNIT_DEFS[unit.defId]}
            {@const stats = unitStats(unit)}
            {@const benchFull = build.bench.length >= BENCH_SIZE}
            <div class="card-head">
              {#if ART_URL[unit.defId]}<img class="card-portrait" src={ART_URL[unit.defId]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}{unit.tier > 1 ? ` ★${unit.tier}` : ''}</div>
                <div class="card-stats">{stats.attack}/{stats.health}</div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(unit.defId)}</p>
            {#if isSummoner(unit.defId)}
              <p class="card-hint">summoned rats fight beyond your warren's size (up to {combatCapForBuild(build)} in the drains)</p>
            {/if}
            {#if unit.relicIds.length > 0}
              <p class="card-relics">✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}</p>
            {/if}
            <div class="card-actions">
              <button disabled={ins.index === 0} onclick={() => moveFromCard(-1)}>front ▶</button>
              <button disabled={ins.index >= build.board.length - 1} onclick={() => moveFromCard(1)}>◀ back</button>
              <button disabled={benchFull} onclick={benchFromCard}>bench</button>
              <button onclick={sellFromCard}>sell · +{sellRefund(unit, build.day)}</button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if benchFull}<div class="card-warn">the bench is full</div>{/if}
          {/if}
        {:else}
          {@const unit = build.bench[ins.index]}
          {#if unit}
            {@const def = UNIT_DEFS[unit.defId]}
            {@const stats = unitStats(unit)}
            {@const boardFull = build.board.length >= effectiveBoardCap(build)}
            <div class="card-head">
              {#if ART_URL[unit.defId]}<img class="card-portrait" src={ART_URL[unit.defId]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}{unit.tier > 1 ? ` ★${unit.tier}` : ''}</div>
                <div class="card-stats">{stats.attack}/{stats.health}</div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(unit.defId)}</p>
            <p class="card-hint">
              {boardFull
                ? 'the warren is full — swap this one in for a fighting rat'
                : 'benched rats never fight — deploy to send this one to the horde'}
            </p>
            {#if unit.relicIds.length > 0}
              <p class="card-relics">✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}</p>
            {/if}
            <div class="card-actions">
              {#if boardFull}
                <button class="primary" onclick={swapFromCard}>swap in</button>
              {:else}
                <button class="primary" onclick={deployFromCard}>deploy</button>
              {/if}
              <button onclick={sellBenchFromCard}>sell · +{sellRefund(unit, build.day)}</button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if nameEntryOpen}
    <div class="sheet-backdrop" role="presentation">
      <div class="sheet name-sheet" role="dialog" aria-modal="true">
        <div class="card-name">name your warlord</div>
        <p class="card-sub">This is how you'll ride on the weekly leaderboard. Rename it any time.</p>
        <input
          class="name-input"
          type="text"
          maxlength="24"
          bind:value={nameDraft}
          placeholder="Gutter-Warlord"
          onkeydown={(e) => e.key === 'Enter' && confirmName()}
        />
        <div class="card-actions">
          <button class="primary" onclick={confirmName}>ride out</button>
          <button onclick={() => (nameDraft = defaultName())}>↻ new name</button>
          {#if playerName}
            <button onclick={() => (nameEntryOpen = false)}>cancel</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .banner-stack {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
  }

  .update-banner,
  .install-banner {
    display: flex;
    align-items: stretch;
    justify-content: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .update-banner {
    background: var(--accent);
    border-bottom: 1px solid #7a3018;
  }

  .install-banner {
    background: var(--ink-dim);
    border-bottom: 1px solid var(--bg);
  }

  .update-banner-reload,
  .install-banner-action {
    flex: 1;
    max-width: 940px;
    padding: 8px 12px;
    font-family: inherit;
    font-size: 13px;
    font-weight: bold;
    color: #f5ead2;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .install-banner-static {
    cursor: default;
  }

  .update-banner-dismiss,
  .install-banner-dismiss {
    padding: 8px 14px;
    font-family: inherit;
    font-size: 13px;
    color: #f5ead2;
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.85;
  }

  .update-banner-dismiss {
    border-left: 1px solid #7a3018;
  }

  .install-banner-dismiss {
    border-left: 1px solid var(--bg);
  }

  main {
    max-width: 940px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    text-align: center;
  }

  main.update-banner-open {
    padding-top: 60px;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    letter-spacing: 6px;
    color: var(--ink);
  }

  .sub {
    margin: 4px 0 16px;
    color: var(--ink-dim);
    font-size: 13px;
  }

  .panel-label {
    font-size: 12px;
    color: var(--ink-dim);
  }

  .dev {
    max-width: 620px;
    margin: 0 auto 10px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    border: 1px dashed #322820;
    border-radius: 8px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .dev input[type='date'] {
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    color: var(--ink);
    font-family: inherit;
    font-size: 12px;
    padding: 3px 6px;
  }

  .dev button {
    padding: 3px 10px;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .dev button.active {
    border-color: var(--accent);
    color: #f0e6d2;
  }

  .dev button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .dev-theme {
    color: #c9b891;
  }

  .dev-sep {
    color: #4a3520;
  }

  .build {
    max-width: 620px;
    margin: 0 auto 16px;
    text-align: left;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
  }

  .horde-panel {
    padding: 10px 12px 12px;
    border: 1.5px solid #6b4a2a;
    border-radius: 10px;
    background: #1c150f;
  }

  .bench-panel {
    margin-top: 8px;
    padding: 8px 12px 10px;
    border: 1px dashed #4a3520;
    border-radius: 10px;
    background: #191310;
  }

  .shop-panel {
    margin-top: 14px;
    padding: 10px 12px 12px;
    border: 1px solid #322820;
    border-radius: 10px;
  }

  .arriving {
    margin-top: 10px;
    padding: 8px 12px;
    border: 1px dashed #4a3520;
    border-radius: 8px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 5px;
  }

  .chip {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 10px;
    background: #2a2118;
    color: #c9b891;
  }

  .phase-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 620px;
    margin: 26px auto 14px;
    color: var(--accent);
    font-size: 13px;
    letter-spacing: 4px;
    text-transform: uppercase;
  }

  .phase-divider::before,
  .phase-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #4a3520;
  }

  .battle-panel {
    max-width: 620px;
    margin: 0 auto;
    padding: 14px;
    border: 1px solid #322820;
    border-radius: 10px;
    background: #100d0a;
  }

  .scrap {
    font-size: 16px;
    color: #d4af37;
  }

  .status-notice {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .notice {
    font-size: 13px;
    color: #d8452e;
  }

  .cancel-pending {
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid #6b4a2a;
    border-radius: 6px;
    background: transparent;
    color: #d4af37;
  }

  .row-label {
    display: flex;
    justify-content: space-between;
    margin: 10px 2px 5px;
  }

  .board {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }

  .horde-board {
    grid-template-columns: repeat(5, 1fr);
    /* Fill right-to-left so the front rat (index 0) sits top-right and stays
       in the first row when the horde grows past 5 and wraps. */
    direction: rtl;
  }

  .horde-board .tile {
    direction: ltr;
  }

  .bench-board {
    grid-template-columns: repeat(3, 1fr);
    max-width: 280px;
  }

  .bench-tile {
    opacity: 0.92;
  }

  .tile {
    position: relative;
    /* Grid items default to min-width: auto, which refuses to shrink below
       the widest unbreakable content (a long name, a cost string) — with a
       fixed-column grid parent that forces the whole row wider than the
       viewport instead of wrapping. min-width: 0 lets the track actually
       shrink to the column's share of available space; overflow-wrap below
       then wraps any long word within it instead of overflowing sideways. */
    min-width: 0;
    min-height: 86px;
    padding: 7px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 8px;
    color: var(--ink);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .empty-tile {
    background: transparent;
    border: 1px dashed #322820;
    color: #5f564a;
    justify-content: center;
    cursor: default;
  }

  .portrait {
    width: 40px;
    height: 40px;
    object-fit: contain;
    image-rendering: auto;
    pointer-events: none;
  }

  .tile-name {
    font-size: 11.5px;
    line-height: 1.15;
    overflow-wrap: break-word;
  }

  .tile-stats {
    font-size: 14px;
    font-weight: bold;
    color: #f0e6d2;
  }

  .tile-sub {
    font-size: 10px;
    color: var(--ink-dim);
    line-height: 1.2;
  }

  .tile-cost {
    font-size: 11px;
    color: #d4af37;
  }

  .unit-tile.selected {
    border-color: var(--accent);
    background: #2c1e15;
  }

  .unit-tile.pin-target {
    border-color: #d4af37;
  }

  .relic-tile .tile-name {
    color: #d4af37;
  }

  .relic-tile.arming,
  .bench-tile.arming {
    border-color: #d4af37;
    background: #2c2415;
  }

  .shop-tile.frozen {
    background: #16202a;
    border-color: #3d5a75;
  }

  .freeze {
    position: absolute;
    top: 3px;
    right: 6px;
    font-size: 12px;
    color: #7ba7cc;
    opacity: 0.65;
  }

  .shop-tile.frozen .freeze {
    opacity: 1;
  }

  .market-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }

  .market-actions button {
    padding: 6px 14px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .market-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .slot-actions {
    margin-top: 6px;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 50;
  }

  .sheet {
    width: 100%;
    max-width: 480px;
    background: #1a140f;
    border: 1px solid #4a3520;
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    padding: 18px 18px 26px;
    text-align: left;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .card-portrait {
    width: 72px;
    height: 72px;
    object-fit: contain;
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 10px;
  }

  .card-relic-icon {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 34px;
    color: #d4af37;
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 10px;
  }

  .card-name {
    font-size: 19px;
    color: var(--ink);
  }

  .card-stats {
    margin-top: 3px;
    font-size: 17px;
    font-weight: bold;
    color: #f0e6d2;
  }

  .card-tier {
    font-size: 11px;
    font-weight: normal;
    color: var(--ink-dim);
    margin-left: 6px;
  }

  .card-sub {
    margin-top: 3px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .card-ability {
    margin: 14px 0 4px;
    font-size: 14px;
    line-height: 1.45;
    color: #c9b891;
  }

  .card-relics {
    margin: 2px 0 0;
    font-size: 13px;
    color: #d4af37;
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  .card-actions button {
    padding: 9px 16px;
    font-family: inherit;
    font-size: 14px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .card-actions button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #f7ede0;
  }

  .card-actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .card-warn {
    margin-top: 8px;
    font-size: 12px;
    color: #d8452e;
  }

  .card-hint {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .card-note {
    margin-top: 8px;
    font-size: 12px;
    color: #d4af37;
  }

  .team-relics {
    margin-top: 8px;
    font-size: 12px;
    color: #c9b891;
  }

  .ride-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 0;
  }

  .ride-controls button {
    padding: 3px 10px;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .ride-controls button.active {
    border-color: var(--accent);
    color: #f0e6d2;
  }

  .stage :global(canvas) {
    max-width: 100%;
    border: 1px solid #2a221a;
    border-radius: 6px;
  }

  .stage.hidden {
    display: none;
  }

  .idle {
    text-align: center;
    padding: 6px 0 2px;
  }

  .muster-line {
    margin: 0 0 14px;
    font-size: 15px;
    color: var(--ink);
  }

  .idle-stats {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin-bottom: 10px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    min-width: 96px;
    padding: 10px 6px;
    background: #1d1713;
    border: 1px solid #322820;
    border-radius: 8px;
  }

  .stat-big {
    font-size: 24px;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .stat-lbl {
    font-size: 12px;
    color: var(--ink-dim);
    margin-top: 2px;
  }

  .idle-note {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .season-best {
    margin: 12px 0 0;
    font-size: 14px;
    color: #d4af37;
  }

  .season-kills {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--ink-dim);
  }

  .season-hint {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .onboarding-hint {
    margin: 14px 0 0;
    padding: 8px 12px;
    border-radius: 6px;
    background: #1d1713;
    border: 1px solid #2a221a;
    font-size: 12px;
    color: var(--ink-dim);
    text-align: center;
  }

  .ride-log {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid #2a221a;
    text-align: left;
  }

  .rl-head {
    margin-bottom: 6px;
  }

  .rl-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
  }

  .rl-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 8px;
    border-radius: 5px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .rl-row:nth-child(odd) {
    background: #17110d;
  }

  .rl-row.deepest {
    color: #d4af37;
  }

  .rl-time {
    min-width: 42px;
    white-space: nowrap;
    color: var(--ink-dim);
  }

  .rl-row.deepest .rl-time {
    color: #d4af37;
  }

  .rl-depth {
    min-width: 64px;
    white-space: nowrap;
  }

  .rl-kills {
    min-width: 58px;
    white-space: nowrap;
    color: var(--ink-dim);
  }

  .rl-scrap {
    min-width: 48px;
    white-space: nowrap;
    color: #c9b891;
  }

  .rl-surv {
    flex: 1;
    text-align: right;
    color: #d4af37;
  }

  .away {
    margin: 14px 0 0;
    padding-top: 12px;
    border-top: 1px solid #2a221a;
    font-size: 14px;
    color: #c9b891;
  }

  .watch {
    padding: 8px 18px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: var(--accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .ride {
    margin-top: 16px;
    padding: 10px 28px;
    font-family: inherit;
    font-size: 16px;
    letter-spacing: 2px;
    color: var(--ink);
    background: var(--accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .ride:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .result {
    margin-top: 14px;
    font-size: 15px;
  }

  .ride-caption {
    margin: 0 0 10px;
    font-size: 12px;
    letter-spacing: 1px;
    color: var(--ink-dim);
  }

  .result-note {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .telemetry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 18px;
    font-size: 12px;
    color: var(--ink-dim);
    cursor: pointer;
  }

  .leaderboard {
    max-width: 620px;
    margin: 18px auto 0;
    padding: 12px 14px 14px;
    border: 1px solid #322820;
    border-radius: 10px;
    background: #14100c;
    text-align: left;
  }

  .lb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .lb-refresh {
    padding: 2px 10px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .lb-refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .lb-empty {
    margin: 10px 0 4px;
    font-size: 13px;
    color: var(--ink-dim);
  }

  .lb-rows {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }

  .lb-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 14px;
  }

  .lb-row:nth-child(odd) {
    background: #1a140f;
  }

  .lb-row.me {
    background: #2c2415;
    color: #f0e6d2;
  }

  .lb-rank {
    min-width: 24px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .lb-row.me .lb-rank {
    color: #d4af37;
  }

  .lb-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-kills {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .lb-depth {
    flex: 0 0 auto;
    white-space: nowrap;
    color: #d4af37;
    font-variant-numeric: tabular-nums;
  }

  .lb-myrank {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid #2a221a;
    font-size: 13px;
    color: #c9b891;
  }

  .lb-you {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .lb-rename {
    margin-left: 8px;
    padding: 2px 8px;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  /* Boss Trial panel (issue #107) — deliberately the same box/row shapes as
     .leaderboard/.lb-* just above, with a bt- prefix so the two boards'
     columns (damage/phase vs. depth/kills) stay easy to tell apart in the
     markup despite looking identical on screen. */
  .boss-trial {
    max-width: 620px;
    margin: 14px auto 0;
    padding: 12px 14px 14px;
    border: 1px solid #322820;
    border-radius: 10px;
    background: #14100c;
    text-align: left;
  }

  .bt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .bt-blurb {
    margin: 8px 0 10px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .bt-run {
    margin: 0 0 4px;
  }

  .bt-result {
    margin: 4px 0 10px;
    font-size: 14px;
    color: #d4af37;
  }

  .bt-hint {
    margin: 2px 0 10px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .bt-rows {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }

  .bt-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 14px;
  }

  .bt-row:nth-child(odd) {
    background: #1a140f;
  }

  .bt-row.me {
    background: #2c2415;
    color: #f0e6d2;
  }

  .bt-rank {
    min-width: 24px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .bt-row.me .bt-rank {
    color: #d4af37;
  }

  .bt-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bt-phases {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .bt-damage {
    flex: 0 0 auto;
    white-space: nowrap;
    color: #d4af37;
    font-variant-numeric: tabular-nums;
  }

  .bt-myrank {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid #2a221a;
    font-size: 13px;
    color: #c9b891;
  }

  .name-sheet {
    align-self: center;
  }

  .name-input {
    width: 100%;
    box-sizing: border-box;
    margin-top: 14px;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 16px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 8px;
  }

  .name-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  @media (max-width: 480px) {
    .lb-row {
      gap: 6px;
      padding: 4px 6px;
      font-size: 13px;
    }

    .rl-row {
      gap: 8px;
      padding: 2px 6px;
      font-size: 12px;
    }

    .bt-row {
      gap: 6px;
      padding: 4px 6px;
      font-size: 13px;
    }
  }
</style>
