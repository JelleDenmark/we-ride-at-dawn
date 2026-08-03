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
  //   - `refreshLeague` / `fetchLatestStandings` / `fetchGhosts` — nightly
  //     league panel data (standings + scout ghosts), from `pvp-board.ts`.
  //   - the closing script tag below this block — the markup/template
  //     starts right after it; component state above is what drives it.
  import { onMount } from 'svelte';
  import {
    currentRideDate,
    dailySeed,
    generateGauntlet,
    anomalyFor,
    simulate,
    WAVE_COUNT,
    UNIT_DEFS,
    ENEMY_POOL,
    RELIC_DEFS,
    newBuild,
    advanceAfterDawn,
    weekdayFor,
    seasonIdFor,
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
    shopUnitPoolForDay,
    seasonUnitPool,
    seasonRelicPool,
    tierAttackMultiplier,
    tierHealthMultiplier,
    reviveHpForTier,
    poisonStacksForTier,
    cellarCoilChargeCapForTier,
    backlineTargetsForTier,
    wardArmorForTier,
    blockHitsForTier,
    buffSummonedForTier,
    poisonResistForTier,
    POISON_RESIST_CAP,
    consolationScrap,
    LOSS_CONSOLATION_DEFAULT,
    simulateDuel,
    unitKeyword,
    relicKeyword,
    MAX_TIER,
    type KeywordFamily,
    type ActionResult,
    type BattleResult,
    type BuildState,
    type DuelResult,
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
    type BestRideSnapshot,
    saveSeasonKills,
    loadSeasonKills,
    savePlayerName,
    loadPlayerName,
    saveRideLog,
    loadRideLog,
    RIDE_LOG_MAX,
    loadInstallNudgeDismissed,
    saveInstallNudgeDismissed,
    saveConsolationCredited,
    loadConsolationCredited,
    type RideLogEntry,
    type LastRide,
  } from './persistence';
  import {
    submitRun,
    telemetryConfigured,
    telemetryEnabled,
    setTelemetryEnabled,
  } from './telemetry';
  import { submitScore, fetchTop, fetchRank, defaultName, isMe, type BoardRow } from './leaderboard';
  import {
    submitPvpBoard,
    fetchLatestStandings,
    fetchStandingsForRound,
    fetchSeasonStandings,
    fetchRounds,
    fetchGhosts,
    fetchLeagueConfig,
    type StandingRow,
    type SeasonStandingRow,
    type RoundInfo,
    type GhostRow,
    type LeagueConfig,
  } from './pvp-board';
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
  // The ride-date/season boundary: currentRideDate shifts the clock back 6h,
  // so a ride-date runs dawn-to-dawn (06:00–05:59 Copenhagen), not
  // midnight-to-midnight.
  const DAWN_SEC = 6 * 3600;

  /** Whether hour bucket `h` (epoch hours) falls inside the day-1 freeze:
   * its ride-date is the season's Monday and its Copenhagen local time is
   * in [06:00, 10:00). The dawn lower bound matters: Monday's ride-date
   * extends past midnight to Tuesday 05:59, and without it those overnight
   * hours also matched "Monday before 10:00" and were wrongly frozen (the
   * 2026-07-21 no-rides-overnight bug). Compared against the season id's
   * 10-char date prefix so a reissued id (e.g. 2026-07-13.2) still freezes
   * its day 1 instead of silently never matching a plain ride-date. Checked
   * per hour (not just "now") so offline catch-up on day 1 skips only the
   * frozen hours, not the ones after 10:00 — and stays correct even if
   * catch-up crosses into day 2 before it's credited. */
  function isFrozenHour(h: number, seasonId: string): boolean {
    const instant = new Date(h * HOUR_MS);
    const sec = copenhagenSeconds(instant);
    return (
      currentRideDate(instant) === seasonId.slice(0, 10) &&
      sec >= DAWN_SEC &&
      sec < DAY1_CUTOFF_SEC
    );
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
  // Exact (date, day, lineup) of the ride that set seasonBest — what the
  // server re-simulates for anti-cheat (issue #81). Snapshotted here, not at
  // submit time: the build keeps mutating after the best ride.
  let seasonBestSnapshot = $state<BestRideSnapshot | undefined>(storedBest.snapshot);
  // Cumulative season total of enemies felled across every completed ride —
  // only climbs, resets with seasonBest. Leaderboard tiebreak under depth.
  let seasonKills = $state(loadSeasonKills(build.seasonId));
  let rideLog = $state<RideLogEntry[]>(loadRideLog(build.seasonId));
  let lastRide = $state<LastRide | null>(loadLastRide());
  let lastIncomeHour = $state<number>(loadLastIncomeHour() ?? Math.floor(Date.now() / HOUR_MS));
  let awaySummary = $state<{ rides: number; scrap: number } | null>(null);
  let nowTick = $state(Date.now());
  let speed = $state(1);

  /**
   * The ONLY way this app builds a gauntlet (issue #141).
   *
   * The weekly anomaly is an explicit parameter in core — deliberately, so
   * golden fixtures and balance baselines stay clean — which means any call
   * site that forgets to pass it silently simulates a DIFFERENT fight than
   * the one the player is being scored on. Funnelling every call through one
   * helper is what makes that impossible: there are no bare
   * `generateGauntlet` calls anywhere else in the app, and the server's
   * re-sim derives the anomaly the same way, from the ride date.
   */
  const gauntletFor = (date: string, day: number) =>
    generateGauntlet(date, day, undefined, anomalyFor(seasonIdFor(date)));

  // The ride shows the daily gauntlet: the same waves all day, every day.
  const currentGauntlet = $derived(gauntletFor(build.date, build.day));
  const theme = $derived(currentGauntlet.theme);
  /** This week's anomaly, or null on a clean week. */
  const anomaly = $derived(anomalyFor(seasonIdFor(build.date)));
  /**
   * Next week's anomaly, revealed on the last day of the season — the return
   * hook that exists before push notifications do (season 6). Computed the
   * same way as everything else: a pure function of a date, no fetch.
   */
  const nextAnomaly = $derived.by(() => {
    const d = new Date(`${build.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (8 - build.day)); // next Monday
    return anomalyFor(seasonIdFor(d.toISOString().slice(0, 10)));
  });
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

  // League identity: a themed default until the player names their warlord
  // (keyed by the anonymous device id, renameable).
  let playerName = $state(loadPlayerName() ?? '');
  let nameEntryOpen = $state(loadPlayerName() === null);
  let nameDraft = $state(playerName || defaultName());

  // Guard so an unchanged best/name/day doesn't re-POST on every rebuild.
  let lastSubmit = '';
  async function submitBest() {
    if (!playerName || seasonBest <= 0) return;
    const sig = `${build.seasonId}|${playerName}|${seasonBest}|${build.day}|${seasonKills}`;
    if (sig === lastSubmit) return;
    lastSubmit = sig;
    // Submit the SNAPSHOT of the best ride, not the live build: the server's
    // re-simulation (issue #81) replays exactly (date, day, lineup, rideHour),
    // and the live board may have changed since the best was set. Pre-snapshot
    // saves fall back to the old live-build behavior (server treats those as
    // unverifiable, not cheating).
    await submitScore({
      seasonId: build.seasonId,
      name: playerName,
      depth: seasonBest,
      day: seasonBestSnapshot?.day ?? build.day,
      lineup: seasonBestSnapshot?.lineup ?? lineupFromBuild(build),
      rideHour: seasonBestHour,
      rideDate: seasonBestSnapshot?.date,
      kills: seasonKills,
    });
  }

  // PvP league board sync (nightly duel). Unlike submitBest (a monotonic
  // best-ride snapshot), this mirrors the player's CURRENT fighting board to
  // pvp_boards as live, last-write-wins state — whatever's deployed now is what
  // the 20:00 job duels and others scout. Debounced so a buy->place->merge
  // burst is one sync, and signature-guarded so an unchanged board never
  // re-POSTs (same shape as submitBest's lastSubmit guard).
  let lastPvpSync = ''; // signature actually written to the server
  let pvpPending = ''; // signature the debounce timer is currently waiting on
  let pvpSyncTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const season = build.seasonId;
    const name = playerName;
    // Read the full lineup SYNCHRONOUSLY so every nested change (tier, relics,
    // order, count) is a tracked dependency — the debounced write below runs
    // outside the effect's tracking scope, so it can't establish them itself.
    const lineupJson = build.board.length > 0 ? JSON.stringify(lineupFromBuild(build)) : '';
    const sig = `${season}|${name}|${lineupJson}`;
    // The idle heartbeat reassigns `build` every second (nowTick), so this
    // effect re-runs constantly. Only (re)arm the debounce when the board
    // signature genuinely changed — otherwise the timer is cleared and reset
    // every second and never fires. This is the fix for the sync silently
    // never happening.
    if (sig === pvpPending) return;
    pvpPending = sig;
    clearTimeout(pvpSyncTimer);
    pvpSyncTimer = setTimeout(() => {
      if (!name || lineupJson === '' || sig === lastPvpSync) return;
      lastPvpSync = sig;
      void submitPvpBoard({ seasonId: season, name, board: JSON.parse(lineupJson) });
    }, 1500);
  });

  // League read side: last night's standings (the season score) and the
  // ghosts to scout for tonight. Both empty-on-failure, same posture as the
  // depth board's refreshBoard. Scouting shows an opponent's currently-synced
  // board — real info, at worst a day stale (see pvp-board.ts's fetchGhosts).
  let standings = $state<StandingRow[]>([]);
  let ghosts = $state<GhostRow[]>([]);
  let leagueBusy = $state(false);
  // The depth board (issue #171): a live-updating ranked read of `scores`,
  // restored as a third tab so the game has a social signal between nightly
  // duels — the PvP standings only change once a day at 20:00.
  let board = $state<BoardRow[]>([]);
  let myRank = $state<number | null>(null);
  // Which rival's board the scout panel is expanded to, by player_id (null =
  // collapsed). One at a time keeps the panel phone-sized.
  let scoutedGhost = $state<string | null>(null);

  // Season-long totals (issue #157) alongside the existing single-night view
  // and the restored depth board (issue #171), shown as tabs so the panel's
  // footprint doesn't grow — see App CSS `.lg-tabs`. "Season" is the default:
  // it's the number that persists.
  let leagueTab = $state<'season' | 'nights' | 'depth'>('season');
  let seasonStandings = $state<SeasonStandingRow[]>([]);
  let rounds = $state<RoundInfo[]>([]);
  // Which past round the "Nights" tab is browsing. null = follow the latest
  // round automatically (kept fresh by refreshLeague's interval); a specific
  // round_id means the player picked an older, already-closed night, which
  // never changes again, so it's fetched once and left alone.
  let selectedRoundId = $state<string | null>(null);
  let nightStandings = $state<StandingRow[]>([]);
  // What the "Nights" table actually renders: the live-refreshed `standings`
  // while following the latest round, or the one-shot fetch for a past pick.
  const displayedNightStandings = $derived(
    selectedRoundId === null || selectedRoundId === rounds[0]?.round_id
      ? standings
      : nightStandings
  );

  async function selectRound(roundId: string) {
    if (roundId === rounds[0]?.round_id) {
      selectedRoundId = null;
      return;
    }
    selectedRoundId = roundId;
    nightStandings = await fetchStandingsForRound(roundId);
  }

  function fmtRoundDate(closesAt: string): string {
    return new Date(closesAt).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  // My board as fielded in the round currently shown by the "Nights" tab —
  // the other half every replay needs alongside an opponent's snapshotted
  // board (issue #158). Rounds scored before the snapshot column shipped
  // have `board: null`, so this (and every opponent's board) can be missing.
  const myNightBoard = $derived(displayedNightStandings.find(isMe)?.board ?? null);

  // Duel replay (issue #158): re-runs `simulateDuel` against the round's
  // SNAPSHOTTED boards (never the live `pvp_boards` — those drift the moment
  // either player edits their horde) so the replay is byte-identical to the
  // fight that actually happened that night, no stored event log needed.
  //
  // `duelStageEl` is bound to an ALWAYS-mounted div (see the `.duel-overlay`
  // markup near the end of the template, outside any `{#if}`) — same
  // approach as the main ride `stageEl`/`player` — so `duelReplayPlayer`'s
  // Pixi app stays attached to a live element across sheet open/close and
  // league-tab switches instead of getting torn down with a conditional block.
  let duelReplayPlayer: ReplayPlayer | undefined;
  let duelStageEl: HTMLDivElement;
  let duelReplay = $state<{ opponentName: string; playing: boolean; result: DuelResult | null } | null>(
    null
  );
  // Playback speed for the duel replay — separate from the ride replay's
  // `speed`/`setSpeed` (a different ReplayPlayer instance, and switching
  // duels shouldn't fight over one shared multiplier). Persists across duels
  // in one sitting, same as the ride replay's `speed` persists across rides.
  let duelSpeed = $state(1);

  function setDuelSpeed(s: number) {
    duelSpeed = s;
    if (duelReplayPlayer) duelReplayPlayer.speed = s;
  }

  async function watchDuelReplay(opponent: StandingRow) {
    const mine = myNightBoard;
    if (!mine || !opponent.board) return;
    duelReplay = { opponentName: opponent.name, playing: true, result: null };
    if (!duelReplayPlayer) {
      duelReplayPlayer = new ReplayPlayer();
      await duelReplayPlayer.init(duelStageEl);
    }
    duelReplayPlayer.speed = duelSpeed;
    const { events, result } = simulateDuel(mine, opponent.board);
    await duelReplayPlayer.play(events);
    // The sheet may have been closed (or another duel started) mid-play —
    // don't resurrect it with a stale result.
    if (!duelReplay || duelReplay.opponentName !== opponent.name) return;
    duelReplay = { ...duelReplay, playing: false, result };
  }

  function closeDuelReplay() {
    duelReplay = null;
  }

  function duelResultText(name: string, result: DuelResult): string {
    if (result.winner === 'draw') return 'draw';
    const won = result.winner === 'a';
    return won ? `you beat ${name}` : `${name} beat you`;
  }
  // Live league tuning (server-configured). Starts at the shipped fallback so
  // the derived consolation figure reads sensibly before the first fetch lands.
  let leagueConfig = $state<LeagueConfig>({ lossConsolation: LOSS_CONSOLATION_DEFAULT });
  // The round_id whose loss-consolation scrap we've already banked, so a payout
  // credits exactly once no matter how often refreshLeague runs. Season-keyed.
  let creditedRound = $state(loadConsolationCredited(build.seasonId));

  // My row in last night's standings, if any — the source for both the payout
  // and the "what you got" note under the table.
  const myStanding = $derived(standings.find(isMe) ?? null);
  const myConsolation = $derived(
    myStanding ? consolationScrap(myStanding.losses, leagueConfig.lossConsolation) : 0
  );

  async function refreshLeague() {
    leagueBusy = true;
    try {
      const [rows, season, roundList, gh, cfg, depthBoard, rank] = await Promise.all([
        fetchLatestStandings(build.seasonId),
        fetchSeasonStandings(build.seasonId),
        fetchRounds(build.seasonId),
        fetchGhosts(build.seasonId),
        fetchLeagueConfig(),
        fetchTop(build.seasonId, 20),
        fetchRank(build.seasonId, seasonBest, seasonKills),
      ]);
      standings = rows;
      seasonStandings = season;
      rounds = roundList;
      ghosts = gh;
      leagueConfig = cfg;
      board = depthBoard;
      myRank = rank;
      creditConsolationIfDue(rows, cfg.lossConsolation);
    } finally {
      leagueBusy = false;
    }
  }

  // Bank the flat loss-consolation scrap for the latest scored round, exactly
  // once. Losing pays; income is the board's strength, so this keeps whoever's
  // behind funded enough to stay in the race (build order §6). Idempotent via
  // the persisted `creditedRound` marker — refreshLeague runs on an interval,
  // so this MUST no-op on every call after the first for a given round.
  function creditConsolationIfDue(rows: StandingRow[], payoutPerLoss: number) {
    if (rows.length === 0) return;
    const mine = rows.find(isMe);
    if (!mine || mine.round_id === creditedRound) return;
    // Mark the round credited BEFORE mutating scrap (and even when the payout
    // is 0, e.g. a clean sweep or a disabled lever) so we never re-pay it.
    creditedRound = mine.round_id;
    saveConsolationCredited(build.seasonId, mine.round_id);
    const payout = consolationScrap(mine.losses, payoutPerLoss);
    if (payout > 0) {
      build = { ...build, scrap: build.scrap + payout };
      saveBuild(build);
    }
  }

  // A scouted board's units as "Name ★tier" chips, in placement order.
  function ghostUnits(g: GhostRow): { key: string; label: string }[] {
    return g.board.units.map((u, i) => {
      const name = UNIT_DEFS[u.defId]?.name ?? u.defId;
      const tier = u.tier ?? 1;
      return { key: `${g.player_id}-${i}`, label: tier > 1 ? `${name} ★${tier}` : name };
    });
  }

  function confirmName() {
    const n = nameDraft.trim().slice(0, 24) || defaultName();
    playerName = n;
    savePlayerName(n);
    nameEntryOpen = false;
    lastSubmit = ''; // force a resubmit so the board shows the new name
    lastPvpSync = ''; // and re-sync the PvP board under the new name
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
  // Armed "tap sell again to confirm" mode. Selling is instant and
  // irreversible, and its button sits directly beside `bench` in the same
  // `.card-actions` row — a thumb-width apart on a phone — so a misfire cost
  // players a rat with no undo (2026-08-02 playtest). Holds the identity of
  // the card whose sell is armed rather than a bare boolean: `inspect`ing a
  // different card, or reordering this one (which changes its index), then
  // disarms on its own, so this needs no reset at the many sites that assign
  // `inspect`. Deliberately NOT the pendingRelic/pendingSwap armed-selection
  // pattern — those await a second, different target; this one just wants the
  // same button pressed twice.
  let sellArmed = $state<{ area: 'board' | 'bench'; index: number } | null>(null);

  function isSellArmed(area: 'board' | 'bench', index: number): boolean {
    return sellArmed?.area === area && sellArmed.index === index;
  }
  // Compendium/bestiary (issue #136): browse full stats/abilities for every
  // UnitDef, own-horde or enemy, without needing an owned copy on the
  // board/bench/shop. `selected` holds a def id within the active tab's
  // list; null shows the tab's list, non-null shows that entry's detail.
  let compendium = $state<{ tab: 'units' | 'enemies' | 'relics'; selected: string | null } | null>(null);
  let notice = $state('');

  // Enemy summon targets (e.g. Watch-Sergeant -> Watch-Whelp) live in
  // ENEMY_POOL, not UNIT_DEFS — abilitySentence's summon case needs both.
  const ENEMY_DEFS: Record<string, UnitDef> = Object.fromEntries(ENEMY_POOL.map((e) => [e.id, e]));

  const TRIGGER_WHEN: Record<string, string> = {
    startOfBattle: 'At the start of the ride,',
    startOfWave: 'At the start of every wave,',
    faint: 'When it faints,',
    afterAttack: 'After it attacks,',
    allyFaint: 'Whenever a friendly rat faints,',
    allySummoned: 'Whenever a friendly rat is summoned,',
    onHurt: 'When a blow lands on it,',
  };

  const TIME_OF_DAY_LABEL: Record<string, string> = {
    beforeNoon: ' (before noon)',
    afterNoon: ' (after noon)',
  };

  // --- Inspect-sheet ability text (Jesper, pre-launch): the tile shows only
  // a keyword tag, so THIS is where a player learns what a unit really does —
  // including exactly how much it scales per star. Numbers come from the same
  // core tables the sim uses (never hand-copied), so they can't drift.
  //
  // This is also the ONLY place a unit's ability is ever explained to a
  // player. `UnitDef` in core used to carry its own hand-written `desc`
  // string too — a second, separately-maintained explanation of the exact
  // same ability that nothing ever rendered (only RelicDef.desc is actually
  // shown; see the two `relic.desc` usages elsewhere in this file). It went
  // stale more than once (silently — nothing broke, it just quietly stopped
  // matching the mechanic) before being removed entirely. If a unit ever
  // needs a description again, extend this function, not `UnitDef` — one
  // generator, one place to keep in sync with sim.ts.

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

  /**
   * "+1/+1 (★2 +3/+3 · ★3 +5/+5)" for Squeak-Sensei's `buffSummoned` curve —
   * `buffSummonedForTier`'s `[1, 3, 5]` table (2026-07-25 bump), not the
   * flat `(t) => t` gainStats uses. Reads the same core table sim.ts scales
   * by, so display can't drift from the mechanic (see the display bug this
   * pattern was created to prevent: [[wrad-copy-vs-engine-audit]]).
   */
  function buffSummonedScale(attack: number, health: number): string {
    return buffScaleWith(attack, health, buffSummonedForTier);
  }

  function abilitySentence(def: UnitDef | undefined, side: 'horde' | 'enemy' = 'horde'): string {
    // Takes the def directly (not an id + UNIT_DEFS lookup) so it works for
    // both rats and enemies — enemies live in ENEMY_POOL, a separate array
    // not keyed by id (issue #136), and every caller already has the def
    // object in hand.
    //
    // `side` flips the sentence's perspective (issue #146): the copy is
    // authored horde-side, but the compendium renders it for enemies too, so
    // words like "horde"/"the frontmost enemy" would be backwards on an enemy
    // card. `own` = a member of the caster's own team, `foe` = a member of the
    // opposing team, `team` = the caster's whole side.
    const isEnemy = side === 'enemy';
    const own = isEnemy ? 'enemy' : 'rat';
    const foe = isEnemy ? 'rat' : 'enemy';
    const foes = isEnemy ? 'rats' : 'enemies';
    const team = isEnemy ? 'enemy line' : 'horde';
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
    if (e.kind === 'reflectDamage' && armor > 0) {
      // Bespoke sentence (not the generic trigger/template + appended
      // armorSentence below): Steel-Whisker (only reflectDamage user, issue
      // #134) reads as two glued-together full sentences otherwise. Merged
      // to one, per Jesper's review of the season-4 patch notes (2026-07-25)
      // — the standalone `armorSentence` template stays untouched since
      // Dire-Rat (its only other user) has no ability to merge it with.
      return `Shrugs off ${armor} damage a hit (★2 ${armor * 2} · ★3 ${armor * 3}) and bites back for ${e.damage} (★2 ${e.damage * 2} · ★3 ${e.damage * 3}) — poison slips past the armor, and the bite is blunted by the attacker’s own.`;
    }
    if (e.kind === 'blockFrontHits') {
      // Rewritten 2026-08-02 against sim.ts's `blockFrontHits` case. Three
      // corrections: it is a per-SIDE pool, not a per-unit flag — the charges
      // follow whoever is currently front and drain 1 per hit that would
      // otherwise land, so "the front one's first hit" understated it; the
      // counts are `blockHitsForTier`, read from core rather than the
      // hand-copied "2"/"3" literals that were here (the drift risk this
      // whole generator exists to prevent); and the pool is sized by
      // `Math.max` across casters, never summed, which every other capped
      // effect's sentence states and this one didn't. Since the Ward-Weaver
      // block→armor rework this effect has exactly one user left, the
      // armored rearguard enemy — so `${own}`/`${team}` render enemy-side.
      return `Each wave, the ${team} shrugs off the next ${blockHitsForTier(1)} hit outright (★2 ${blockHitsForTier(2)}, ★3 ${blockHitsForTier(3)}) — whichever ${own} is at the front takes the save. Never stacks across multiple casters, and the pool resets every wave.`;
    }
    if (e.kind === 'grantArmor') {
      const who = e.all ? 'every ' + own : 'itself';
      return `At the dawn of battle, wards ${who} with +${wardArmorForTier(1)} armor (★2 +${wardArmorForTier(2)}, ★3 +${wardArmorForTier(3)}) — every hit they take lands for that much less, all ride long, but a hit always lands for at least 1.`;
    }
    if (e.kind === 'chargeWhileBenched') {
      // Bespoke sentence (not the generic trigger/condition template below):
      // this effect has TWO separate "nothing happens" cases — at the front,
      // and once the cap is banked — that read as a confusing bolt-on
      // ("hard-capped... after which it's a no-op... but only on waves...")
      // when forced through the generic `${TRIGGER_WHEN} it ${what}${when}`
      // shape. Leading with the condition, then the gain, then the cap
      // framed as a ceiling reads as one plain sentence instead.
      const cap = (t: number) => cellarCoilChargeCapForTier(t);
      return `Each wave off the front, permanently gains +${e.attackPerWave} attack (★2 +${e.attackPerWave * 2} · ★3 +${e.attackPerWave * 3}) — up to ${cap(1)} total (★2 ${cap(2)} · ★3 ${cap(3)}). No gain at the front, or once capped.`;
    }
    if (e.kind === 'distributeStatsOnFaint') {
      // Bespoke sentence (not the generic template below): the shared-budget
      // caveat (issue #131) doesn't fit the `${TRIGGER_WHEN} it ${what}` shape
      // without an awkward bolt-on clause, same reasoning as chargeWhileBenched.
      return `When it faints, splits its current attack and max health evenly across the surviving horde (any remainder goes to the frontmost survivors first). All your Pack-Callers draw from one shared pool for this, spent across the ride.`;
    }
    if (e.kind === 'poisonResist') {
      // Bespoke sentence (not the generic trigger template below): it's a
      // per-wave-banked passive ward, not a one-off proc — "at the start of
      // every wave" is mechanically true but reads as noise for something
      // that's simplest understood as just "always up." Trimmed the
      // "ward, not antidote" caveat too (Jesper, 2026-08-01) — the cap
      // number already says it's partial.
      return `Wards the whole ${team} against poison, blunting every tick by ${poisonResistForTier(1)} (★2 ${poisonResistForTier(2)} · ★3 ${poisonResistForTier(3)}), capped at ${POISON_RESIST_CAP} across multiple casters.`;
    }
    if (e.kind === 'backlineDamage') {
      // Merge scaling grows target count, not per-hit damage (issue #86
      // follow-up) — see `backlineTargetsForTier`'s doc comment in
      // data/units.ts for why the exponential attack curve is deliberately
      // left out here. Per-hit damage is the unit's CURRENT attack (base +
      // relics + team-attack pool + any runtime buffs — see the
      // `backlineDamage` case in sim.ts's `applyEffect`), not a flat number:
      // a buffed Slink-Rat/MBP Rat hits harder here too, so the copy must
      // say "current attack," never bake in the def's base stat.
      const targets = (t: number) => backlineTargetsForTier(t);
      return `At the start of every wave, if not at the front, strikes the first ${foe} for its current attack (★2 hits the first ${targets(2)} ${foes} for its current attack each · ★3 hits the first ${targets(3)} ${foes} for its current attack each) — separate hits, landed before that wave's clashing even begins, with no retaliation. At the front, it just fights normally.`;
    }
    let what = '';
    switch (e.kind) {
      case 'summon': {
        const name = UNIT_DEFS[e.unitId]?.name ?? ENEMY_DEFS[e.unitId]?.name ?? e.unitId;
        // Brood-Mother's summon (issue #105) births Brood-Broodlings that
        // themselves birth Brood-Runts on faint — call out the cascade so the
        // matryoshka reads, rather than looking like a flat litter.
        const cascades = UNIT_DEFS[e.unitId]?.ability?.effect.kind === 'summon';
        const litter = `summons ${e.count} ${name}${e.count > 1 ? 's' : ''} (★2 ${e.count * 2} · ★3 ${e.count * 3}) in front`;
        what = cascades ? `${litter} — and each births smaller young of its own when it falls` : litter;
        break;
      }
      case 'maintainSummons': {
        const name = UNIT_DEFS[e.unitId]?.name ?? ENEMY_DEFS[e.unitId]?.name ?? e.unitId;
        // Rat-Piper (issue #105): maintenance, not a fresh litter every wave.
        what = `keeps ${e.count} ${name}${e.count > 1 ? 's' : ''} (★2 ${e.count * 2} · ★3 ${e.count * 3}) at its side, piping in a fresh one whenever one falls`;
        break;
      }
      case 'summonScaledPup': {
        // Rat-Piper's issue #161 rework: fixed count, tier scales the
        // summoned body's OWN stats (via `tierAttackMultiplier`/
        // `tierHealthMultiplier`, same curve every recruited unit gets)
        // rather than how many spawn — the inverse of `maintainSummons`
        // above. One-time (`startOfBattle`), so the sentence says so
        // explicitly rather than reading like a per-wave litter. Also calls
        // out the relic-inheritance follow-up (issue #161) so equipping a
        // relic on Piper reads as "affects two bodies," not a mystery buff
        // on the newcomer.
        const name = UNIT_DEFS[e.unitId]?.name ?? ENEMY_DEFS[e.unitId]?.name ?? e.unitId;
        const base = UNIT_DEFS[e.unitId] ?? ENEMY_DEFS[e.unitId];
        const stats = (t: number) => `${(base?.attack ?? 0) * tierAttackMultiplier(t)}/${(base?.health ?? 0) * tierHealthMultiplier(t)}`;
        what = `summons ${e.count} ${name}${e.count > 1 ? 's' : ''} in front at ${stats(1)} strength (★2 ${stats(2)} · ★3 ${stats(3)}) — once, not a fresh litter every wave — and hands it a copy of any relic it's wearing`;
        break;
      }
      case 'buffBehind':
        what = `grants ${buffScale(e.attack, e.health)} to ${e.all ? `every ${own} behind it` : `the ${own} behind it`}`;
        break;
      case 'bequeathAttack':
        // The last-slot whiff is deliberate — sim.ts's `bequeathAttack` case
        // takes `board[index]` after the splice and bails if nobody's there,
        // which its comment calls "the intended 'wasted' placement case the
        // issue's placement puzzle calls out." That puzzle is the whole card,
        // so the copy has to state it (2026-08-02); silently paying nothing
        // is exactly what a player needs to know BEFORE choosing the slot.
        what = `passes its OWN current attack to the ${own} behind it, plus a bonus for how deep into the ride it fell (capped at ${e.waveBonusCapMultiplier}× its own attack) — from the last slot there is no one behind, and the whole payout is lost`;
        break;
      case 'poisonFrontEnemy':
        what = `applies ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) to the frontmost ${foe} — clears when the wave falls`;
        break;
      case 'poisonLastEnemy':
        what = `applies ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) to the ${foe} at the back of the line — clears when the wave falls, capped across multiple casters`;
        break;
      case 'poisonTarget':
        // Flat `stacks * tier`, NOT poisonStacksForTier — mirrors sim.ts's
        // (flagged-but-live) exemption for this one effect, so the numbers
        // shown match what the sim actually applies.
        what = `applies ${e.stacks} poison (★2 ${e.stacks * 2} · ★3 ${e.stacks * 3}) to whatever it just struck`;
        break;
      case 'gainStats':
        what = `gains ${gainStatsScale(e.attack, e.health)}`;
        break;
      case 'revive':
        // Three engine conditions the old sentence left out (2026-08-02), all
        // from sim.ts's `revive` case: the corpse search is
        // `(c) => c !== source && !c.raised`, so it NEVER raises the caster
        // (the two guards that killed the 0.6.2 immortal-Priest and the
        // immortal-pair exploits — a player who fields one Bone-Priest and
        // watches it fall needs to know nothing happens); it bails outright
        // when `board.length >= capOf(side)`, so a full board silently wastes
        // the trigger; and it sets `corpse.poison = 0`, so the raised rat
        // comes back clean of rot. "capped at its own max" also read as the
        // CASTER's max — it's the revived corpse's.
        what = `raises the first ${own} to fall — never itself — at ${reviveHpForTier(1)} health (★2 ${reviveHpForTier(2)} · ★3 ${reviveHpForTier(3)}), clean of rot but never past that ${own}’s own max. Once per corpse, and only with room on the board`;
        break;
      case 'buffAdjacent':
        what = `grants ${buffScale(e.attack, e.health)} to the ${own}(s) beside it — a middle seat buffs both neighbours`;
        break;
      case 'teamBuff':
        what = `grants ${buffScale(e.attack, e.health)} to the whole ${team}, itself included`;
        break;
      case 'poisonAllEnemies':
        what = `rots every ${foe} in the wave with ${poisonStacksForTier(1)} poison (★2 ${poisonStacksForTier(2)} · ★3 ${poisonStacksForTier(3)}) — ignores armor, clears when the wave falls, capped across multiple casters`;
        break;
      case 'teamBuffByWave':
        what = `grants the whole ${team} ${buffScale(e.early.attack, e.early.health)} on its first wave, plus ${buffScale(e.late.attack, e.late.health)} more from wave ${e.switchWave} onward — both permanent for the rest of the ride`;
        break;
      case 'buffSummoned':
        // [1, 3, 5] per-star curve (2026-07-25 bump) — the trigger repeats
        // every summon, so sim.ts scales it via buffSummonedForTier, not
        // 3^(tier-1).
        what = `trains the newcomer: it arrives with ${buffSummonedScale(e.attack, e.health)} — capped across multiple casters`;
        break;
      case 'reflectDamage':
        // Linear per-star curve — repeats every hit taken (see sim.ts).
        // The reflect goes through `applyDamage(..., 'attack')`, so the
        // ATTACKER's own armor blunts it (down to the MIN_ATTACK_DAMAGE
        // floor) — say so, since Dire-Rat/Steel-Whisker/Ward-Weaver put real
        // armor on the board. Dropped the old "a blocked hit draws no blood"
        // clause (2026-08-02): it described `blockCharges`, and since the
        // Ward-Weaver block→armor rework no rat or relic grants block at all,
        // so horde-side block is permanently 0 and the caveat was unreachable.
        what = `cuts back, dealing ${e.damage} damage (★2 ${e.damage * 2} · ★3 ${e.damage * 3}) to its attacker, blunted by that attacker’s own armor`;
        break;
      case 'healSelf':
        // Linear per-star curve — repeats every clash survived (see sim.ts).
        what = `drains ${e.amount} health back (★2 ${e.amount * 2} · ★3 ${e.amount * 3}) if it survived the clash — never past its own max`;
        break;
    }
    const when = def.ability.condition?.timeOfDay
      ? `${TIME_OF_DAY_LABEL[def.ability.condition.timeOfDay] ?? ''}`
      : '';
    // startOfBattle reads "at the start of the ride" for the persistent horde
    // (fires once), but enemies are re-instantiated every wave, so for them it
    // fires each wave — say so (issue #146 finding #2).
    const triggerText =
      isEnemy && def.ability.trigger === 'startOfBattle'
        ? 'At the start of each wave,'
        : TRIGGER_WHEN[def.ability.trigger];
    const abilityPart = `${triggerText} it ${what}${when}.`;
    return armorSentence ? `${abilityPart} ${armorSentence}` : abilityPart;
  }

  function isSummoner(def: UnitDef | undefined): boolean {
    const kind = def?.ability?.effect.kind;
    return kind === 'summon' || kind === 'maintainSummons' || kind === 'summonScaledPup';
  }

  // Compendium (issue #136) lists every rat regardless of day-gating (a
  // bestiary, not just the shop pool), so this tells the player when a
  // browsed-but-not-yet-owned rat actually shows up — same day-gate rule
  // the shop rolls use (shopUnitPoolForDay), not a second copy of it.
  function unitAvailabilityNote(def: UnitDef, day: number): string {
    if (shopUnitPoolForDay(day).some((u) => u.id === def.id)) return 'available in the shop today';
    if (def.unlockDay !== undefined && day < def.unlockDay) return `unlocks day ${def.unlockDay}`;
    if (def.retireDay !== undefined && day >= def.retireDay) return 'retired — no longer offered this season';
    return 'not currently offered this season';
  }

  // Compact tile tag (issue: mobile shop overflow) — the tile shows only a
  // symbol + 1-2 word keyword; the full sentence lives in the inspect sheet
  // (abilitySentence, above) which already exists as the tap-to-detail
  // destination, so the tile no longer needs to repeat it.
  //
  // The classification itself moved into core in #166 (`unitKeyword`, in
  // data/keyword-family.ts) — this file is now a thin consumer, not the
  // source of truth. That is what makes it testable and what makes the
  // compiler refuse a new `Effect` kind until it has been classified and
  // coloured. Per ADR-0005, any NEW surface that lists units takes its
  // colour from `UnitKeyword.color` rather than inventing its own encoding.
  function keywordTag(def: UnitDef): string | null {
    return unitKeyword(def)?.text ?? null;
  }

  /**
   * Inline family colours for a tile. Two variables, not one, because the
   * two jobs have different contrast floors (ADR-0006):
   *   `--family`       the 3px top edge — a graphical mark, sprite-true hex.
   *   `--family-text`  the keyword line (10px) and relic glyph (13px), lifted
   *                    to clear 4.5:1 on `--surface`.
   * `transparent` rather than an omitted variable so a plain body with no
   * keyword renders a clean tile instead of inheriting an ancestor's family.
   */
  function familyStyle(def: UnitDef): string {
    const kw = unitKeyword(def);
    return `--family: ${kw?.color ?? 'transparent'}; --family-text: ${kw?.textColor ?? 'transparent'}`;
  }

  /** Same two variables for a relic, which always has a family. */
  function relicFamilyStyle(relic: { family: KeywordFamily }): string {
    const kw = relicKeyword(relic);
    return `--family: ${kw.color}; --family-text: ${kw.textColor}`;
  }

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  // Stale-tab fix (PWA-SCOPE.md Phase 1): a deployed build never reaches an
  // already-open tab on its own. `updateAvailable` flips true when the
  // poller notices `./version.txt` now differs from the build this tab
  // booted with (see updateCheck.ts); `updateDismissed` hides the banner
  // until the next detection re-shows it (simple by design). Phase 2
  // (pwaUpdate.ts) feeds the same flag from a waiting service worker, so
  // there's still only ever one banner regardless of which signal fires.
  let updateAvailable = $state(false);
  let updateDismissed = $state(false);
  // Set once pwaUpdate.ts has a waiting SW ready to activate; null means
  // "no SW involved this session" (unsupported browser, or Phase 1's poll
  // fired instead) and reloadForUpdate falls back to a plain reload.
  let applyPwaUpdate: ((reload?: boolean) => Promise<void>) | null = null;
  // Stops pwaUpdate.ts's periodic registration.update() poll — set once
  // startPwaUpdate resolves, called from onMount's cleanup below.
  let stopPwaUpdate: (() => void) | null = null;

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
    // Load the league now, then keep it loosely fresh while the tab is open.
    // Standings only change once a day (at 20:00), but the ghosts to scout
    // update as rivals rebuild.
    void refreshLeague();
    const leagueId = setInterval(() => void refreshLeague(), 60_000);
    const stopUpdateCheck = startUpdateCheck(() => {
      updateDismissed = false;
      updateAvailable = true;
    });
    void startPwaUpdate(() => {
      updateDismissed = false;
      updateAvailable = true;
    }).then(({ updateSW, stop }) => {
      applyPwaUpdate = updateSW;
      stopPwaUpdate = stop;
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
      clearInterval(leagueId);
      stopUpdateCheck();
      stopInstallCapture();
      stopPwaUpdate?.();
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
          const outcome = simulate(timedLineup, gauntletFor(build.date, build.day));
          const ride: LastRide = { date: build.date, day: build.day, lineup, result: outcome.result };
          saveLastRide(ride);
          lastRide = ride;
          submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: CHANNEL === 'dev' });
        }
        build = advanceAfterDawn(build, addDay(build.date));
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
          const { result } = simulate(timedLineup, gauntletFor(build.date, build.day));
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
          seasonBestSnapshot = { date: build.date, day: build.day, lineup };
          saveSeasonBest(build.seasonId, seasonBest, deepest.hour, seasonBestSnapshot);
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
      seasonBestSnapshot = undefined;
      seasonKills = 0;
      rideLog = [];
      saveSeasonBest(build.seasonId, 0);
      saveSeasonKills(build.seasonId, 0);
      saveRideLog(build.seasonId, []);
      // Re-key the consolation marker to the new season (empty until the new
      // week's first round pays out).
      creditedRound = loadConsolationCredited(build.seasonId);
      selectedRoundId = null; // last season's round_id means nothing this season
      void refreshLeague(); // new week → pull the fresh (empty) league + ghosts
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

  // Dev: repeated `simulateDawn`/`devSkipHours` use can push `build.date`
  // arbitrarily far ahead of real time (each jump is unbounded, there's no
  // ceiling tying it back to `currentRideDate()`). `freshBuild` does NOT fix
  // this (it deliberately preserves `build.date`/`build.day`, only clearing
  // shop/board). This button re-anchors date/day/seasonId to what a genuinely
  // fresh build would have right now, while keeping the roster/scrap/relics
  // intact (unlike `freshBuild`, which wipes the board) — the same
  // carry-forward `advanceAfterDawn` uses, just targeting today instead of
  // build.date's "next day".
  function resetTestDate() {
    stopReplay();
    const today = currentRideDate();
    const rebuilt = newBuild(today, weekdayFor(today), build.teamRelicIds);
    build = {
      ...rebuilt,
      scrap: build.scrap,
      board: build.board,
      bench: build.bench,
      teamRelicIds: build.teamRelicIds,
      purchasedSlots: build.purchasedSlots,
    };
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
      const outcome = simulate(timedLineup, gauntletFor(build.date, build.day));
      const ride: LastRide = { date: build.date, day: build.day, lineup, result: outcome.result };
      saveLastRide(ride);
      lastRide = ride;
      submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: true });
    }
    stopReplay();
    build = advanceAfterDawn(build, addDay(build.date));
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
      const { result } = simulate(timedLineup, gauntletFor(build.date, build.day));
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
      seasonBestSnapshot = { date: build.date, day: build.day, lineup };
      saveSeasonBest(build.seasonId, seasonBest, deepest.hour, seasonBestSnapshot);
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
    if (!isSellArmed('board', inspect.index)) {
      sellArmed = { area: 'board', index: inspect.index };
      return;
    }
    sellArmed = null;
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
    if (!isSellArmed('bench', inspect.index)) {
      sellArmed = { area: 'bench', index: inspect.index };
      return;
    }
    sellArmed = null;
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
    stageEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
          ⚔ an update rode in — tap to reload
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

  {#if anomaly}
    <p class="anomaly">
      <span class="anomaly-name">{anomaly.name}</span>
      <span class="anomaly-blurb">{anomaly.blurb}</span>
    </p>
  {/if}

  {#if build.day === SEASON_DAYS && nextAnomaly}
    <p class="anomaly anomaly-next">
      <span class="anomaly-name">Next week</span>
      <span class="anomaly-blurb">{nextAnomaly.name} — {nextAnomaly.blurb}</span>
    </p>
  {/if}

  <div class="compendium-nav">
    <button onclick={() => (compendium = { tab: 'units', selected: null })}>📖 Rats</button>
    <button onclick={() => (compendium = { tab: 'enemies', selected: null })}>📖 Enemies</button>
    <button onclick={() => (compendium = { tab: 'relics', selected: null })}>📖 Relics</button>
  </div>

  {#if CHANNEL === 'dev'}
  <div class="dev">
    <span class="panel-label">testing</span>
    <button onclick={() => devSkipHours(6)}>⏩ +6h income</button>
    <button onclick={simulateDawn}>⏭ next day</button>
    <button onclick={freshBuild}>fresh build</button>
    <button onclick={resetTestDate}>↺ reset test date</button>
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
        {@const def = UNIT_DEFS[unit.defId]}
        <button
          class="tile unit-tile"
          class:selected={inspect?.area === 'board' && inspect.index === bi}
          class:pin-target={pendingRelic !== null || pendingSwap !== null}
          class:maxed={unit.tier >= MAX_TIER}
          class:front={bi === 0}
          style={familyStyle(def)}
          onclick={() => clickBoardUnit(bi)}
        >
          {#if ART_URL[unit.defId]}
            <img class="portrait" src={ART_URL[unit.defId]} alt="" />
          {/if}
          <span class="tile-name">{def.name}</span>
          <span class="tile-stats">{stats.attack}/{stats.health}</span>
          <span
            class="tile-sub"
            class:keyword={unit.relicIds.length === 0}
            class:relic-text={unit.relicIds.length > 0}
          >
            {#if unit.relicIds.length > 0}
              ✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
            {:else}
              {keywordTag(def) ?? ''}
            {/if}
          </span>
          {#if unit.tier > 1}
            <span class="tier-pips" aria-label="tier {unit.tier}">
              {#each Array.from({ length: unit.tier }) as _}<i class="pip"></i>{/each}
            </span>
          {/if}
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
        {@const def = UNIT_DEFS[unit.defId]}
        <button
          class="tile unit-tile bench-tile"
          class:selected={inspect?.area === 'bench' && inspect.index === bi}
          class:arming={pendingSwap === bi}
          class:maxed={unit.tier >= MAX_TIER}
          style={familyStyle(def)}
          onclick={() => clickBenchUnit(bi)}
        >
          {#if ART_URL[unit.defId]}
            <img class="portrait" src={ART_URL[unit.defId]} alt="" />
          {/if}
          <span class="tile-name">{def.name}</span>
          <span class="tile-stats">{stats.attack}/{stats.health}</span>
          <span
            class="tile-sub"
            class:keyword={unit.relicIds.length === 0}
            class:relic-text={unit.relicIds.length > 0}
          >
            {#if unit.relicIds.length > 0}
              ✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
            {:else}
              {keywordTag(def) ?? ''}
            {/if}
          </span>
          {#if unit.tier > 1}
            <span class="tier-pips" aria-label="tier {unit.tier}">
              {#each Array.from({ length: unit.tier }) as _}<i class="pip"></i>{/each}
            </span>
          {/if}
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
    <div class="board shop-board">
      {#each build.shop.slots as slot, i}
        {#if slot.kind === 'unit'}
          {@const def = UNIT_DEFS[slot.defId]}
          <button
            class="tile shop-tile"
            class:frozen={build.shop.frozen[i]}
            style={familyStyle(def)}
            onclick={() => clickShopSlot(i)}
          >
            {#if ART_URL[def.id]}
              <img class="portrait" src={ART_URL[def.id]} alt="" />
            {/if}
            <span class="tile-name">{def.name}</span>
            <span class="tile-stats">{def.attack}/{def.health}</span>
            <span class="tile-sub keyword">{keywordTag(def) ?? ''}</span>
            <span class="tile-cost">⚙ {def.cost}</span>
            <span
              class="freeze"
              role="button"
              tabindex="0"
              onclick={(e) => freeze(i, e)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  freeze(i, e);
                }
              }}>❄</span>
          </button>
        {:else if slot.kind === 'relic'}
          {@const relic = RELIC_DEFS[slot.relicId]}
          <button
            class="tile shop-tile relic-tile"
            class:frozen={build.shop.frozen[i]}
            class:arming={pendingRelic === i}
            style={relicFamilyStyle(relic)}
            onclick={() => clickShopSlot(i)}
          >
            <span class="relic-mark" aria-hidden="true">✦<span class="relic-family" aria-hidden="true">{relicKeyword(relic).glyph}</span></span>
            <span class="tile-name">{relic.name}</span>
            <span class="tile-sub">{relic.desc}</span>
            <span class="tile-cost">⚙ {relic.cost} · {relic.scope === 'team' ? 'whole team' : 'one rat'}</span>
            <span
              class="freeze"
              role="button"
              tabindex="0"
              onclick={(e) => freeze(i, e)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  freeze(i, e);
                }
              }}>❄</span>
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

    {#if build.board.length === 0 && build.bench.length === 0 && build.scrap > 0}
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
          Your horde rides to <strong>depth {result.wavesCleared}</strong>
          &middot; {result.wavesCleared >= WAVE_COUNT
            ? `⚑ the drains cleared — ${result.survivors.length} rats ride home`
            : result.survivors.length > 0
              ? `${result.survivors.length} rats ride home`
              : 'until the last rat falls'}
        </p>
        <p class="result-note">the drains hold steady all week — resets Monday</p>
      {/if}
      <button class="ride" onclick={backToWarren} disabled={phase === 'riding'}>
        {phase === 'riding' ? 'Riding…' : '← back to the warren'}
      </button>
    {:else}
      <div class="idle">
        <p class="muster-line">Your horde rides the drains <strong>every hour</strong>, hauling back scrap by how deep it pushes. The drains hold steady all week — a new gauntlet awaits each Monday.</p>
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
            scrap per depth cleared, every hour (deeper waves pay less) · gets tougher deeper
          {/if}
        </p>
        <button class="watch" onclick={watchRide}>▶ watch the next ride</button>
        <!-- `watchRide` replays a live simulation of the CURRENT build (see the
             `stopReplay`/`skipReplay` anchor at the top of this file) — it banks
             no scrap, logs no ride, and moves neither stat below. A playtester
             took it for a committed ride (2026-08-02); nothing on screen said
             otherwise, so say it here. -->
        <p class="season-hint">a look ahead, not a real ride — nothing is hauled and no depth is banked</p>
        <p class="season-best">Deepest ride this week: <strong>depth {seasonBest}</strong> · resets Monday</p>
        <p class="season-kills">Enemies felled this week: <strong>{seasonKills}</strong></p>
        {#if currentDepth > seasonBest}
          <p class="season-hint">the next ride will reach depth {currentDepth}</p>
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
                  <span class="rl-depth">depth {r.depth}{r.depth === seasonBest && r.depth > 0 ? ' ★' : ''}</span>
                  <span class="rl-kills">{r.enemiesDefeated ?? 0} felled</span>
                  <span class="rl-scrap">+{r.scrap} ⚙</span>
                  <!-- Riding until the last rat falls is the normal end of a ride;
                       only a true full clear (all WAVE_COUNT waves) earns the
                       badge — survivors alone can mean a stalemate short of the
                       end (issue #146 finding #1). -->
                  <span class="rl-surv">{r.depth >= WAVE_COUNT ? '⚑ cleared the drains!' : ''}</span>
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
      <span class="panel-label">Nightly league · week of {build.seasonId.slice(0, 10)}</span>
      <button class="lb-refresh" onclick={() => void refreshLeague()} disabled={leagueBusy}>
        {leagueBusy ? '…' : '↻'}
      </button>
    </div>
    <p class="lg-blurb">
      Your horde duels every rival's at <strong>20:00 CET</strong> — one board does both jobs, riding the drains for scrap by day and fighting the duel at night. Points: <strong>win 3 · draw 1 · loss 0</strong> against each rival, summed. Monday wipes the table.
    </p>

    <div class="lg-tabs" role="tablist">
      <button
        class="lg-tab"
        class:active={leagueTab === 'season'}
        role="tab"
        aria-selected={leagueTab === 'season'}
        onclick={() => (leagueTab = 'season')}
      >
        Season
      </button>
      <button
        class="lg-tab"
        class:active={leagueTab === 'nights'}
        role="tab"
        aria-selected={leagueTab === 'nights'}
        onclick={() => (leagueTab = 'nights')}
      >
        Nights
      </button>
      <button
        class="lg-tab"
        class:active={leagueTab === 'depth'}
        role="tab"
        aria-selected={leagueTab === 'depth'}
        onclick={() => (leagueTab = 'depth')}
      >
        Depth
      </button>
    </div>

    {#if leagueTab === 'season'}
      {#if seasonStandings.length === 0}
        <p class="lb-empty">{leagueBusy ? 'reading the war-drums…' : 'no duel yet — the first table posts after tonight\'s 20:00 CET'}</p>
      {:else}
        <p class="lg-caption">season total · week of {build.seasonId.slice(0, 10)}</p>
        <ol class="lb-rows">
          {#each seasonStandings as row, i}
            <li class="lb-row" class:me={isMe(row)}>
              <span class="lb-rank">{i === 0 ? '👑' : i + 1}</span>
              <span class="lb-name">{row.name}{isMe(row) ? ' · you' : ''}</span>
              <span class="lg-record" title="wins–draws–losses">{row.wins}–{row.draws}–{row.losses}</span>
              <span class="lg-points">{row.points} pts</span>
            </li>
          {/each}
        </ol>
      {/if}
    {:else if leagueTab === 'nights'}
      {#if rounds.length > 1}
        <select
          class="lg-round-picker"
          value={selectedRoundId ?? rounds[0]?.round_id}
          onchange={(e) => void selectRound(e.currentTarget.value)}
        >
          {#each rounds as r (r.round_id)}
            <option value={r.round_id}>{fmtRoundDate(r.closes_at)}</option>
          {/each}
        </select>
      {/if}
      {#if displayedNightStandings.length === 0}
        <p class="lb-empty">{leagueBusy ? 'reading the war-drums…' : 'no duel yet — the first table posts after tonight\'s 20:00 CET'}</p>
      {:else}
        <p class="lg-caption">
          {selectedRoundId === null || selectedRoundId === rounds[0]?.round_id
            ? "last night's table"
            : `${fmtRoundDate(rounds.find((r) => r.round_id === selectedRoundId)?.closes_at ?? '')}'s table`}
        </p>
        <ol class="lb-rows">
          {#each displayedNightStandings as row, i}
            <li class="lb-row" class:me={isMe(row)}>
              <span class="lb-rank">{i === 0 ? '👑' : i + 1}</span>
              <span class="lb-name">{row.name}{isMe(row) ? ' · you' : ''}</span>
              <span class="lg-record" title="wins–draws–losses">{row.wins}–{row.draws}–{row.losses}</span>
              <span class="lg-points">{row.points} pts</span>
              {#if !isMe(row) && myNightBoard && row.board}
                <button class="lg-replay" title="watch this duel" onclick={() => void watchDuelReplay(row)}>▶</button>
              {/if}
            </li>
          {/each}
        </ol>
        {#if myNightBoard === null && displayedNightStandings.length > 0}
          <p class="lg-caption">no replay for this night — scored before replays existed</p>
        {/if}
        {#if myStanding && myConsolation > 0 && (selectedRoundId === null || selectedRoundId === rounds[0]?.round_id)}
          <p class="lg-consolation">
            last night's {myStanding.losses}
            {myStanding.losses === 1 ? 'loss' : 'losses'} paid
            <strong>+{myConsolation} scrap</strong> consolation
          </p>
        {/if}
      {/if}
    {:else}
      {#if board.length === 0}
        <p class="lb-empty">{leagueBusy ? 'reading the war-drums…' : 'no riders yet this week — be the first'}</p>
      {:else}
        <p class="lg-caption">deepest riders · week of {build.seasonId.slice(0, 10)}</p>
        <ol class="lb-rows">
          {#each board as row, i}
            <li class="lb-row" class:me={isMe(row)}>
              <span class="lb-rank">{i + 1}</span>
              <span class="lb-name">{row.name}{isMe(row) ? ' · you' : ''}</span>
              <span class="lb-depth">depth {row.depth}</span>
            </li>
          {/each}
        </ol>
        {#if myRank !== null && myRank > board.length}
          <p class="lb-myrank">your rank: <strong>#{myRank}</strong> · depth {seasonBest}</p>
        {/if}
      {/if}
    {/if}

    <div class="scout">
      <p class="lg-caption">scout tonight's rivals · last synced boards</p>
      {#if ghosts.length === 0}
        <p class="lb-empty">{leagueBusy ? 'scouting the drains…' : 'no rivals synced yet this week'}</p>
      {:else}
        <ul class="scout-list">
          {#each ghosts as g (g.player_id)}
            {@const open = scoutedGhost === g.player_id}
            <li class="scout-item">
              <button
                class="scout-row"
                aria-expanded={open}
                onclick={() => (scoutedGhost = open ? null : g.player_id)}
              >
                <span class="scout-name">{g.name}</span>
                <span class="scout-count">{g.board.units.length} rats {open ? '▾' : '▸'}</span>
              </button>
              {#if open}
                {#if g.board.units.length === 0}
                  <p class="scout-empty">empty board — no horde synced</p>
                {:else}
                  <div class="scout-board">
                    {#each ghostUnits(g) as u (u.key)}
                      <span class="scout-chip">{u.label}</span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <p class="lb-you">
      riding as <strong>{playerName || '—'}</strong>
      <button class="lb-rename" onclick={openRename}>rename</button>
    </p>
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
            {@const copies = [...build.board, ...build.bench].filter((u) => u.defId === def.id && u.tier === 1).length}
            {@const t2 = unitStats({ defId: def.id, tier: 2, relicIds: [] })}
            {@const t3 = unitStats({ defId: def.id, tier: 3, relicIds: [] })}
            <div class="card-head">
              {#if ART_URL[def.id]}<img class="card-portrait" src={ART_URL[def.id]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}</div>
                <div class="card-stats">
                  {def.attack}/{def.health} <span class="card-tier">atk/hp</span>
                  <span class="card-tier">★2 {t2.attack}/{t2.health} · ★3 {t3.attack}/{t3.health}</span>
                </div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(def)}</p>
            {#if isSummoner(def)}
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
              <div class="card-relic-icon" aria-hidden="true" style={relicFamilyStyle(relic)}>
                ✦<span class="relic-family" aria-hidden="true">{relicKeyword(relic).glyph}</span>
              </div>
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
                <div class="card-stats">{stats.attack}/{stats.health} <span class="card-tier">atk/hp</span></div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(def)}</p>
            {#if isSummoner(def)}
              <p class="card-hint">summoned rats fight beyond your warren's size (up to {combatCapForBuild(build)} in the drains)</p>
            {/if}
            {#if unit.relicIds.length > 0}
              <p class="card-relics">✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}</p>
            {/if}
            <div class="card-actions">
              <button disabled={ins.index === 0} onclick={() => moveFromCard(-1)}>front ▶</button>
              <button disabled={ins.index >= build.board.length - 1} onclick={() => moveFromCard(1)}>◀ back</button>
              <button disabled={benchFull} onclick={benchFromCard}>bench</button>
              <button class:armed={isSellArmed('board', ins.index)} onclick={sellFromCard}>
                {isSellArmed('board', ins.index) ? 'sure?' : 'sell'} · +{sellRefund(unit, build.day)}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if isSellArmed('board', ins.index)}
              <div class="card-warn">tap again — the rat is gone for good</div>
            {:else if benchFull}<div class="card-warn">the bench is full</div>{/if}
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
                <div class="card-stats">{stats.attack}/{stats.health} <span class="card-tier">atk/hp</span></div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(def)}</p>
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
              <button class:armed={isSellArmed('bench', ins.index)} onclick={sellBenchFromCard}>
                {isSellArmed('bench', ins.index) ? 'sure?' : 'sell'} · +{sellRefund(unit, build.day)}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if isSellArmed('bench', ins.index)}
              <div class="card-warn">tap again — the rat is gone for good</div>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if compendium}
    {@const comp = compendium}
    {@const unitList = seasonUnitPool().sort((a, b) => a.cost - b.cost)}
    {@const relicList = seasonRelicPool().sort((a, b) => a.cost - b.cost)}
    {@const enemyList = [...ENEMY_POOL]}
    {@const selectedUnit =
      comp.tab === 'units' && comp.selected
        ? UNIT_DEFS[comp.selected]
        : comp.tab === 'enemies' && comp.selected
          ? enemyList.find((e) => e.id === comp.selected)
          : undefined}
    {@const selectedRelic = comp.tab === 'relics' && comp.selected ? RELIC_DEFS[comp.selected] : undefined}
    <div class="sheet-backdrop" role="presentation" onclick={() => (compendium = null)}>
      <div class="sheet compendium-sheet" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
        {#if selectedUnit}
          {@const armor = selectedUnit.damageReduction ?? 0}
          <div class="card-head">
            {#if ART_URL[selectedUnit.id]}<img class="card-portrait" src={ART_URL[selectedUnit.id]} alt="" />{/if}
            <div>
              <div class="card-name">{selectedUnit.name}</div>
              <div class="card-stats">
                {selectedUnit.attack}/{selectedUnit.health}
                <span class="card-tier">atk/hp</span>{comp.tab === 'units' ? ` · ⚙ ${selectedUnit.cost}` : ''}
              </div>
              {#if selectedUnit.archetype || armor > 0}
                <div class="card-sub">
                  {[selectedUnit.archetype, armor > 0 ? `${armor} armor` : null].filter(Boolean).join(' · ')}
                </div>
              {/if}
              {#if comp.tab === 'units'}
                <div class="card-sub">{unitAvailabilityNote(selectedUnit, build.day)}</div>
              {/if}
            </div>
          </div>
          <p class="card-ability">{abilitySentence(selectedUnit, comp.tab === 'enemies' ? 'enemy' : 'horde')}</p>
          {#if comp.tab === 'units' && isSummoner(selectedUnit)}
            <p class="card-hint">summoned rats fight beyond your warren's size (up to {combatCapForBuild(build)} in the drains)</p>
          {/if}
          {#if comp.tab === 'enemies'}
            <p class="card-hint">shown at ★1 — enemies never star up; the gauntlet may scale their stats by depth</p>
          {/if}
          <div class="card-actions">
            <button onclick={() => (compendium = { tab: comp.tab, selected: null })}>◀ back</button>
            <button onclick={() => (compendium = null)}>close</button>
          </div>
        {:else if selectedRelic}
          <div class="card-head">
            <div class="card-relic-icon" aria-hidden="true" style={relicFamilyStyle(selectedRelic)}>
              ✦<span class="relic-family" aria-hidden="true">{relicKeyword(selectedRelic).glyph}</span>
            </div>
            <div>
              <div class="card-name">{selectedRelic.name}</div>
              <div class="card-stats">⚙ {selectedRelic.cost}</div>
              <div class="card-sub">{selectedRelic.scope === 'team' ? 'whole team' : 'pin to one rat'}</div>
            </div>
          </div>
          <p class="card-ability">{selectedRelic.desc}.</p>
          <div class="card-actions">
            <button onclick={() => (compendium = { tab: 'relics', selected: null })}>◀ back</button>
            <button onclick={() => (compendium = null)}>close</button>
          </div>
        {:else}
          <div class="compendium-header">
            <div class="compendium-tabs">
              <button class:active={comp.tab === 'units'} onclick={() => (compendium = { tab: 'units', selected: null })}>Rats</button>
              <button class:active={comp.tab === 'enemies'} onclick={() => (compendium = { tab: 'enemies', selected: null })}>Enemies</button>
              <button class:active={comp.tab === 'relics'} onclick={() => (compendium = { tab: 'relics', selected: null })}>Relics</button>
            </div>
            <button class="compendium-close" onclick={() => (compendium = null)} aria-label="close compendium">✕</button>
          </div>
          <div class="compendium-list">
            {#if comp.tab === 'units'}
              {#each unitList as def (def.id)}
                <button class="compendium-row" onclick={() => (compendium = { tab: 'units', selected: def.id })}>
                  {#if ART_URL[def.id]}<img class="compendium-row-portrait" src={ART_URL[def.id]} alt="" />{/if}
                  <span class="compendium-row-name">{def.name}</span>
                  <span class="compendium-row-cost">⚙ {def.cost}</span>
                  <span class="compendium-row-stats">{def.attack}/{def.health}</span>
                </button>
              {/each}
            {:else if comp.tab === 'enemies'}
              {#each enemyList as def (def.id)}
                <button class="compendium-row" onclick={() => (compendium = { tab: 'enemies', selected: def.id })}>
                  {#if ART_URL[def.id]}<img class="compendium-row-portrait" src={ART_URL[def.id]} alt="" />{/if}
                  <span class="compendium-row-name">{def.name}</span>
                  <span class="compendium-row-stats">{def.attack}/{def.health}</span>
                </button>
              {/each}
            {:else}
              {#each relicList as relic (relic.id)}
                <button class="compendium-row" onclick={() => (compendium = { tab: 'relics', selected: relic.id })}>
                  <div class="compendium-row-icon" aria-hidden="true" style={relicFamilyStyle(relic)}>
                    ✦<span class="relic-family" aria-hidden="true">{relicKeyword(relic).glyph}</span>
                  </div>
                  <span class="compendium-row-name">{relic.name}</span>
                  <span class="compendium-row-cost">⚙ {relic.cost}</span>
                </button>
              {/each}
            {/if}
          </div>
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
          <button class="primary" onclick={confirmName}>{playerName ? 'save name' : 'ride out'}</button>
          <button onclick={() => (nameDraft = defaultName())}>↻ new name</button>
          {#if playerName}
            <button onclick={() => (nameEntryOpen = false)}>cancel</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Duel replay (issue #158). This wrapper and the stage inside it are
       ALWAYS mounted (not `{#if duelReplay}`) so `duelReplayPlayer`'s Pixi
       app stays attached to a live element — same reasoning as the main ride
       `stage`/`player`. Only visibility and the surrounding text react to
       `duelReplay`. -->
  <div class="duel-overlay" class:hidden={!duelReplay} role="presentation" onclick={closeDuelReplay}>
    <div class="duel-sheet" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="duel-head">
        <span>{duelReplay ? `vs ${duelReplay.opponentName}` : ''}</span>
        <button class="duel-close" onclick={closeDuelReplay} aria-label="close replay">✕</button>
      </div>
      <div class="stage duel-stage" bind:this={duelStageEl}></div>
      {#if duelReplay?.playing}
        <div class="ride-controls">
          {#each [1, 2, 4] as s}
            <button class:active={duelSpeed === s} onclick={() => setDuelSpeed(s)}>{s}×</button>
          {/each}
        </div>
      {/if}
      {#if duelReplay && !duelReplay.playing && duelReplay.result}
        <p class="duel-result">{duelResultText(duelReplay.opponentName, duelReplay.result)}</p>
      {/if}
    </div>
  </div>
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
    border-bottom: 1px solid var(--accent-deep);
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
    color: var(--ink-bright);
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
    color: var(--ink-bright);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.85;
  }

  .update-banner-dismiss {
    border-left: 1px solid var(--accent-deep);
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

  /* Weekly anomaly banner (issue #141). Phone-first: it has to read at a
     glance above the fold without stealing a tap, so it's a static two-part
     line — name, then the flavor — not a card or a dismissible notice. */
  .anomaly {
    margin: -8px 0 16px;
    padding: 8px 10px;
    border-left: 3px solid var(--accent);
    background: rgba(255, 255, 255, 0.03);
    font-size: 13px;
    line-height: 1.35;
  }

  .anomaly-name {
    display: block;
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 12px;
  }

  .anomaly-blurb {
    color: var(--ink-dim);
  }

  /* Sunday's look-ahead reads as a quieter echo of this week's banner —
     it's a teaser, not the rule you're playing under right now. */
  .anomaly-next {
    border-left-color: var(--ink-dim);
  }

  .anomaly-next .anomaly-name {
    color: var(--ink-dim);
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
    border: 1px dashed var(--edge-dim);
    border-radius: 8px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .dev input[type='date'] {
    background: var(--surface);
    border: 1px solid var(--edge);
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
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .dev button.active {
    border-color: var(--accent);
    color: var(--ink-bright);
  }

  .dev button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .dev-theme {
    color: var(--ink-soft);
  }

  .dev-sep {
    color: var(--edge);
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

  /* Wet metal on the panels (issue #167), same recipe as `.tile`: a light
     catch along the top edge, a shadow along the bottom, `--sheen` instead
     of a flat fill, and an off-square radius so the frame reads as a
     stamped plate rather than a rounded rectangle. Each panel gets its OWN
     radius rotation — three stacked panels with identical corners is the
     laser-cut look this is trying to leave behind. */
  .horde-panel,
  .bench-panel,
  .shop-panel,
  .battle-panel,
  .leaderboard {
    background-image: var(--sheen);
    box-shadow:
      inset 0 1px 0 var(--inset-light),
      inset 0 -1px 0 var(--inset-shadow);
  }

  .horde-panel {
    padding: 10px 12px 12px;
    border: 1.5px solid var(--edge-warm);
    border-radius: 12px 9px 11px 8px;
    background-color: var(--surface-sunk);
  }

  .bench-panel {
    margin-top: 8px;
    padding: 8px 12px 10px;
    border: 1px dashed var(--edge);
    border-radius: 9px 12px 8px 11px;
    background-color: var(--surface-sunk);
  }

  .shop-panel {
    margin-top: 14px;
    padding: 10px 12px 12px;
    border: 1px solid var(--edge-dim);
    border-radius: 11px 8px 12px 9px;
  }

  .arriving {
    margin-top: 10px;
    padding: 8px 12px;
    border: 1px dashed var(--edge);
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
    background: var(--surface-raised);
    color: var(--ink-soft);
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
    background: var(--edge);
  }

  .battle-panel {
    max-width: 620px;
    margin: 0 auto;
    padding: 14px;
    border: 1px solid var(--edge-dim);
    border-radius: 8px 11px 9px 12px;
    background-color: var(--well);
  }

  /* Tarnished brass (issue #167): every gold number in the app carries the
     same 1px verdigris cast where it meets its own shadow. Brass in a wet
     drain does not stay clean, and it is one text-shadow — see `--tarnish`.
     Applied at each `color: var(--brass)` site rather than as one utility
     rule, because the brass selectors have nothing else in common. */
  .scrap {
    font-size: 16px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .status-notice {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .notice {
    font-size: 13px;
    color: var(--danger);
  }

  .cancel-pending {
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--edge-warm);
    border-radius: 6px;
    background: transparent;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
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
    grid-template-columns: repeat(5, 1fr);
  }

  .shop-board {
    /* SHOP_UNIT_SLOTS(4) + SHOP_RELIC_SLOTS(1) = 5 (issue #156's relic-slot
       cut, 2026-08-01) — was the shared 6-column `.board` default, which
       left a dead 6th track and squeezed every tile a column narrower than
       it needed to be. A dedicated column count lets tiles actually use the
       freed-up width instead of wrapping names/costs onto extra lines. */
    grid-template-columns: repeat(5, 1fr);
  }

  /* Scoped to .shop-tile, not the shared .tile — the horde/bench boards
     already sit at 5 columns and weren't part of this resize; only the shop
     gained width from the relic-slot cut above. */
  .shop-tile {
    min-height: 104px;
    padding: 9px 5px;
  }

  .shop-tile .portrait {
    width: 48px;
    height: 48px;
  }

  .shop-tile .tile-name {
    font-size: 12.5px;
  }

  .shop-tile .tile-stats {
    font-size: 15px;
  }

  .shop-tile .tile-sub {
    font-size: 10.5px;
  }

  .shop-tile .tile-cost {
    font-size: 11.5px;
  }

  .bench-tile {
    opacity: 0.92;
  }

  /* Keyword-family edge (issue #166): a full board used to be five identical
     brown boxes — the sprite is 40px of an 86px tile and everything else was
     10-12px text on the same ground, so nothing distinguished a poison rat
     from an armor rat at a glance. The colour comes from the inline
     `--family` each tile sets (see `familyStyle`), never from a per-surface
     palette invented here — ADR-0005. Drawn as an absolute bar rather than a
     `border-top` so it costs no layout height on an already-tight tile;
     `transparent` for a plain body makes it a no-op instead of a rule that
     has to be conditionally applied. */
  .tile::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: var(--family, transparent);
    pointer-events: none;
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
    /* Wet metal, not a fill (issue #167). `background-color` + `--sheen` as
       a separate background-IMAGE, deliberately not the `background`
       shorthand: every state rule below (front/selected/frozen/arming) swaps
       only the colour, and a shorthand there would silently wipe the sheen.
       Same reason the inset light/shadow live here rather than per state. */
    background-color: var(--surface);
    background-image: var(--sheen);
    box-shadow:
      inset 0 1px 0 var(--inset-light),
      inset 0 -1px 0 var(--inset-shadow);
    border: 1px solid var(--edge);
    /* Stamped, not laser-cut: four different radii read as a struck object,
       a uniform 8px reads as a div. Varied per tile by position below. */
    border-radius: 9px 6px 8px 7px;
    color: var(--ink);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  /* Three radius rotations across a row so no two neighbours are identical.
     `.tile::before` (the family edge) has to track the TOP two corners of
     whichever rotation applies, hence the paired rules — the bar sits inside
     the 1px border, so each value is 1px tighter than the tile's. */
  .board .tile:nth-child(3n + 1) {
    border-radius: 7px 9px 6px 8px;
  }

  .board .tile:nth-child(3n + 2) {
    border-radius: 8px 7px 9px 6px;
  }

  .tile::before {
    border-radius: 8px 5px 0 0;
  }

  .board .tile:nth-child(3n + 1)::before {
    border-radius: 6px 8px 0 0;
  }

  .board .tile:nth-child(3n + 2)::before {
    border-radius: 7px 6px 0 0;
  }

  .empty-tile {
    background-color: transparent;
    background-image: none;
    box-shadow: none;
    border: 1px dashed var(--edge-dim);
    color: var(--ink-faint);
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
    color: var(--ink-bright);
  }

  .tile-sub {
    font-size: 10px;
    color: var(--ink-dim);
    line-height: 1.2;
    overflow-wrap: break-word;
  }

  /* Only when `.tile-sub` is actually showing a keyword — a relic list (the
     other thing that span renders) belongs to the relic's gold register, not
     to the unit's family. */
  /* `--family-text`, not `--family`: this line is 10px, and three of the six
     sprite-true family hexes sit below `--ink-dim` on `--surface` (ADR-0006's
     floor for anything under 12px). The lift is enforced in
     `keyword-family.test.ts`. The edge stripe above keeps the true hex. */
  .tile-sub.keyword {
    color: var(--family-text, var(--ink-dim));
  }

  /* ...and that gold register, stated. Before this the relic list simply
     inherited `--ink-dim`, so pinning a relic read as the rat's family
     QUIETLY DRAINING AWAY rather than as a deliberate switch of subject.
     Brass is the app-wide relic colour (costs, the ✦ marks, `.relic-tile`
     names) and clears 8:1 on `--surface`, where the family reds do not — so
     this is also the contrast-safe choice for 10px text. The rat's own
     family is never actually lost: the 3px tile edge still carries it. */
  .tile-sub.relic-text {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  /* Relic marks (issue #166 follow-up). A relic had no visual identity at
     all: the same brass ✦ in four places while every unit beside it carried
     a portrait, a family colour and a light source. Until the sprites land
     this is the interim — the ✦ stays as the "this is an item, not a rat"
     marker, with the relic's keyword-family glyph badged onto it in the
     family colour, so a relic answers "what does this do" the same way a
     rat's tile does. Two marks rather than one recoloured mark, because
     they say different things. */
  .relic-mark {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    line-height: 1;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    pointer-events: none;
  }

  .card-relic-icon,
  .compendium-row-icon {
    position: relative;
  }

  .relic-family {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 13px;
    line-height: 1;
    /* 13px is still small text for AA purposes — see `.tile-sub.keyword`. */
    color: var(--family-text, var(--ink-dim));
    text-shadow: none;
  }

  .card-relic-icon .relic-family {
    right: 6px;
    bottom: 6px;
    font-size: 18px;
  }

  .compendium-row-icon .relic-family {
    font-size: 11px;
  }

  .tile-cost {
    font-size: 11px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    overflow-wrap: break-word;
  }

  /* Tier as pips, not text (issue #166). `★2` was two characters of 11.5px
     name suffix for what is the single biggest power spike in the game;
     tier 1 shows nothing at all, so the marker only ever means "this one is
     merged". The `aria-label` carries the tier for screen readers, and the
     inspect sheet still spells out `★N` on tap. Shop tiles never render
     these — everything on offer is tier 1 — which is also why they don't
     collide with the ❄ freeze control in the same corner. */
  .tier-pips {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    pointer-events: none;
  }

  .pip {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--brass);
  }

  /* Keeps the tile's own wet-metal insets and adds the merge glow on top —
     a bare `box-shadow` here would replace them, flattening the ★3 tile back
     to a fill at exactly the moment it should look struck. */
  .unit-tile.maxed {
    border-color: var(--brass);
    box-shadow:
      inset 0 1px 0 var(--inset-light),
      inset 0 -1px 0 var(--inset-shadow),
      inset 0 0 9px var(--brass-glow);
  }

  /* Only the frontmost unit ever clashes (see CONTEXT.md, "Clash"), and
     nothing on the board said so. Horde-only — the `front` class is set at
     board index 0 and nowhere else, since the bench never fights and the shop
     has no ordering. Brighter ground plus a rust chevron pointing the way the
     board reads, matching the `front → into the drains` label above it.
     Deliberately kept at two-class specificity and placed ABOVE
     `.unit-tile.selected`, so selecting the front rat still repaints its
     ground rather than losing that feedback to this rule. */
  .unit-tile.front {
    background-color: var(--surface-lit);
  }

  .unit-tile.front::after {
    content: '›';
    position: absolute;
    bottom: 1px;
    right: 5px;
    font-size: 13px;
    line-height: 1;
    color: var(--accent);
    pointer-events: none;
  }

  .unit-tile.selected {
    border-color: var(--accent);
    background-color: var(--surface-raised);
  }

  .unit-tile.pin-target {
    border-color: var(--brass);
  }

  .relic-tile .tile-name {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .relic-tile.arming,
  .bench-tile.arming {
    border-color: var(--brass);
    background-color: var(--surface-brass);
  }

  .shop-tile.frozen {
    background-color: var(--frost-surface);
    border-color: var(--frost-edge);
  }

  .freeze {
    position: absolute;
    top: 0;
    right: 0;
    padding: 6px;
    min-width: 22px;
    min-height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--frost);
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
    background: var(--surface);
    border: 1px solid var(--edge);
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
    background: var(--surface-sunk);
    border: 1px solid var(--edge);
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
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 10px;
  }

  .card-relic-icon {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 34px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    background: var(--surface);
    border: 1px solid var(--edge);
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
    color: var(--ink-bright);
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
    color: var(--ink-soft);
  }

  .card-relics {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
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
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .card-actions button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--ink-bright);
  }

  .card-actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Armed sell (see `sellArmed`): borrows .card-warn's red so the "one more
     tap destroys this" state reads at a glance, without the filled-in weight
     of .primary — this is a warning, not the sheet's recommended action. */
  .card-actions button.armed {
    color: var(--danger);
    border-color: var(--danger);
  }

  .card-warn {
    margin-top: 8px;
    font-size: 12px;
    color: var(--danger);
  }

  .card-hint {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .card-note {
    margin-top: 8px;
    font-size: 12px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .compendium-nav {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin: 0 0 16px;
  }

  .compendium-nav button {
    padding: 6px 14px;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .compendium-sheet {
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .compendium-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .compendium-tabs {
    display: flex;
    gap: 6px;
  }

  .compendium-tabs button {
    padding: 6px 14px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink-dim);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .compendium-tabs button.active {
    color: var(--ink-bright);
    border-color: var(--accent);
  }

  .compendium-close {
    padding: 6px 10px;
    font-family: inherit;
    font-size: 14px;
    color: var(--ink-dim);
    background: none;
    border: none;
    cursor: pointer;
  }

  .compendium-list {
    margin-top: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .compendium-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    font-family: inherit;
    text-align: left;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 8px;
    cursor: pointer;
  }

  .compendium-row-portrait {
    width: 36px;
    height: 36px;
    object-fit: contain;
    background: var(--surface-sunk);
    border: 1px solid var(--edge);
    border-radius: 6px;
    flex-shrink: 0;
  }

  .compendium-row-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    background: var(--surface-sunk);
    border: 1px solid var(--edge);
    border-radius: 6px;
    flex-shrink: 0;
  }

  .compendium-row-name {
    flex: 1;
    font-size: 14px;
  }

  .compendium-row-cost {
    font-size: 12px;
    color: var(--ink-dim);
    flex-shrink: 0;
  }

  .compendium-row-stats {
    font-size: 13px;
    font-weight: bold;
    color: var(--ink-bright);
    flex-shrink: 0;
  }

  .team-relics {
    margin-top: 8px;
    font-size: 12px;
    color: var(--ink-soft);
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
    padding: 10px 16px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .ride-controls button.active {
    border-color: var(--accent);
    color: var(--ink-bright);
  }

  .stage :global(canvas) {
    max-width: 100%;
    border: 1px solid var(--edge-faint);
    border-radius: 6px;
  }

  .stage.hidden {
    display: none;
  }

  .duel-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.7);
  }

  .duel-overlay.hidden {
    display: none;
  }

  .duel-sheet {
    width: 100%;
    max-width: 620px;
    background: var(--surface-sunk);
    border: 1px solid var(--edge);
    border-radius: 12px;
    padding: 14px;
  }

  .duel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--ink-dim);
  }

  .duel-close {
    min-width: 32px;
    min-height: 32px;
    font-family: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .duel-result {
    margin: 10px 0 0;
    font-size: 14px;
    text-align: center;
    color: var(--ink-bright);
  }

  .lg-replay {
    min-width: 32px;
    min-height: 32px;
    padding: 2px 8px;
    font-family: inherit;
    font-size: 12px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
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
    background: var(--surface-sunk);
    border: 1px solid var(--edge-dim);
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
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
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
    background: var(--surface-sunk);
    border: 1px solid var(--edge-faint);
    font-size: 12px;
    color: var(--ink-dim);
    text-align: center;
  }

  .ride-log {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid var(--edge-faint);
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
    background: var(--panel);
  }

  .rl-row.deepest {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .rl-time {
    min-width: 42px;
    white-space: nowrap;
    color: var(--ink-dim);
  }

  .rl-row.deepest .rl-time {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
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
    color: var(--ink-soft);
  }

  .rl-surv {
    flex: 1;
    text-align: right;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .away {
    margin: 14px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--edge-faint);
    font-size: 14px;
    color: var(--ink-soft);
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
    border: 1px solid var(--edge-dim);
    border-radius: 12px 8px 11px 9px;
    background-color: var(--well);
    text-align: left;
  }

  .lb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .lb-refresh {
    min-width: 40px;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
  }

  .lb-refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .lg-tabs {
    display: flex;
    gap: 6px;
    margin: 10px 0 0;
  }

  .lg-tab {
    flex: 1;
    min-height: 36px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
    background: var(--surface-sunk);
    border: 1px solid var(--edge-dim);
    border-radius: 6px;
    cursor: pointer;
  }

  .lg-tab.active {
    color: var(--ink);
    background: var(--surface);
    border-color: var(--edge);
  }

  .lg-round-picker {
    display: block;
    width: 100%;
    margin: 10px 0 0;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: var(--surface-sunk);
    border: 1px solid var(--edge-dim);
    border-radius: 6px;
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
    background: var(--surface-sunk);
  }

  .lb-row.me {
    background: var(--surface-brass);
    color: var(--ink-bright);
  }

  .lb-rank {
    min-width: 24px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .lb-row.me .lb-rank {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .lb-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lg-blurb {
    margin: 8px 0 4px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .lg-caption {
    margin: 12px 0 2px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-dim);
  }

  .lg-consolation {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .lg-consolation strong {
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
  }

  .lg-record {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .lg-points {
    flex: 0 0 auto;
    white-space: nowrap;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    font-variant-numeric: tabular-nums;
  }

  .lb-depth {
    flex: 0 0 auto;
    white-space: nowrap;
    color: var(--brass);
    text-shadow: 0 1px 0 var(--tarnish);
    font-variant-numeric: tabular-nums;
  }

  .lb-myrank {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid #2a221a;
    font-size: 13px;
    color: #c9b891;
  }

  .scout {
    margin-top: 4px;
  }

  .scout-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }

  .scout-item {
    border-radius: 6px;
  }

  .scout-item:nth-child(odd) {
    background: var(--surface-sunk);
  }

  .scout-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 10px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 14px;
    color: var(--ink);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .scout-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scout-count {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .scout-empty {
    margin: 0;
    padding: 0 8px 8px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .scout-board {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 8px 10px;
  }

  .scout-chip {
    padding: 3px 8px;
    font-size: 12px;
    color: var(--ink-bright);
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 999px;
    white-space: nowrap;
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
    background: var(--surface);
    border: 1px solid var(--edge);
    border-radius: 6px;
    cursor: pointer;
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
    background: var(--surface);
    border: 1px solid var(--edge);
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
  }
</style>
