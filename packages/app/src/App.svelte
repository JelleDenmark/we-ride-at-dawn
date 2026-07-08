<script lang="ts">
  import { onMount } from 'svelte';
  import {
    currentRideDate,
    dailySeed,
    generateGauntlet,
    scoutReport,
    ARCHETYPE_LABEL,
    simulate,
    UNIT_DEFS,
    RELIC_DEFS,
    newBuild,
    advanceAfterDawn,
    boardCapForDay,
    weekdayFor,
    seasonIdFor,
    interestFor,
    SCRAP_PER_DEPTH,
    SEASON_DAYS,
    buyUnit,
    canRecruit,
    buyRelic,
    sellUnit,
    sellBenchUnit,
    sellRefund,
    rerollShop,
    toggleFreeze,
    moveUnit,
    benchUnit,
    deployUnit,
    swapWithBench,
    lineupFromBuild,
    unitStats,
    REROLL_COST,
    BOARD_CAP,
    BENCH_SIZE,
    type ActionResult,
    type BattleResult,
    type BuildState,
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
    type RideLogEntry,
    type LastRide,
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
  import { startUpdateCheck } from './updateCheck';

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
  let rideLog = $state<RideLogEntry[]>(loadRideLog());
  let lastRide = $state<LastRide | null>(loadLastRide());
  let lastIncomeHour = $state<number>(loadLastIncomeHour() ?? Math.floor(Date.now() / HOUR_MS));
  let awaySummary = $state<{ rides: number; scrap: number } | null>(null);
  let nowTick = $state(Date.now());
  let speed = $state(1);

  // The ride at the top of hour H uses gauntlet(date, day, H): waves
  // reshuffle hourly under a fixed daily theme. The preview always shows the
  // NEXT ride — the one the countdown points at.
  const nextRideHour = $derived(Math.floor(nowTick / HOUR_MS) + 1);
  const currentGauntlet = $derived(generateGauntlet(build.date, build.day, nextRideHour));
  const report = $derived(scoutReport(currentGauntlet));
  const theme = $derived(currentGauntlet.theme);
  // Live outcome of the current horde on the next ride — updates as you
  // build (and as the hour flips), so you see your depth change in real time.
  const currentOutcome = $derived(
    build.board.length > 0 ? simulate(lineupFromBuild(build), currentGauntlet) : null
  );
  const currentDepth = $derived(currentOutcome ? currentOutcome.result.wavesCleared : 0);
  const scrapPerHour = $derived(currentDepth * SCRAP_PER_DEPTH);
  const secondsToNextHour = $derived(3600 - (Math.floor(nowTick / 1000) % 3600));
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

  function abilitySentence(defId: string): string {
    const def = UNIT_DEFS[defId];
    if (!def?.ability) return 'No special trick — just a body to swell the ranks.';
    const e = def.ability.effect;
    let what = '';
    switch (e.kind) {
      case 'summon': {
        const name = UNIT_DEFS[e.unitId]?.name ?? e.unitId;
        what = `summons ${e.count} ${name}${e.count > 1 ? 's' : ''} in front`;
        break;
      }
      case 'buffBehind':
        what = `grants +${e.attack}/+${e.health} to ${e.all ? 'every rat behind it' : 'the rat behind it'}`;
        break;
      case 'poisonFrontEnemy':
        what = `applies ${e.stacks} poison to the frontmost enemy`;
        break;
      case 'poisonTarget':
        what = `applies ${e.stacks} poison to whatever it just struck`;
        break;
      case 'gainStats':
        what = `gains +${e.attack}/+${e.health}`;
        break;
      case 'revive':
        what = `revives your first fallen rat at ${e.health} health`;
        break;
    }
    return `${TRIGGER_WHEN[def.ability.trigger]} it ${what}. Effects scale with tier.`;
  }

  function isSummoner(defId: string): boolean {
    return UNIT_DEFS[defId]?.ability?.effect.kind === 'summon';
  }

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  // Stale-tab fix (PWA-SCOPE.md Phase 1): a deployed build never reaches an
  // already-open tab on its own. `updateAvailable` flips true when the
  // poller notices `./index.html` now points at a different entry bundle
  // than the one this tab booted with; `updateDismissed` hides the banner
  // until the next detection re-shows it (simple by design).
  let updateAvailable = $state(false);
  let updateDismissed = $state(false);

  function dismissUpdateBanner() {
    updateDismissed = true;
  }

  function reloadForUpdate() {
    location.reload();
  }

  onMount(() => {
    // Persist the income clock on first ever load so offline hours accrue
    // from here on (without this, each reload would reset the baseline).
    if (loadLastIncomeHour() === null) saveLastIncomeHour(lastIncomeHour);
    const id = setInterval(() => (nowTick = Date.now()), 1000);
    // Load the board now, then keep it loosely fresh while the tab is open.
    void refreshBoard();
    const boardId = setInterval(() => void refreshBoard(), 60_000);
    const stopUpdateCheck = startUpdateCheck(() => {
      updateDismissed = false;
      updateAvailable = true;
    });
    void (async () => {
      player = new ReplayPlayer();
      await player.init(stageEl);
    })();
    return () => {
      clearInterval(id);
      clearInterval(boardId);
      stopUpdateCheck();
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
          const outcome = simulate(lineup, generateGauntlet(build.date, build.day));
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

    // Credit each elapsed hour as its own ride: the horde fights that hour's
    // reshuffled gauntlet, earns that ride's depth, and the ride is logged.
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
          const { result } = simulate(lineup, generateGauntlet(build.date, build.day, h));
          const scrap = result.wavesCleared * SCRAP_PER_DEPTH;
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
        saveRideLog(rideLog);
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
        awaySummary = { rides: elapsed, scrap: earned };
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
      saveSeasonBest(build.seasonId, 0);
      saveSeasonKills(build.seasonId, 0);
      void refreshBoard(); // new week → pull the fresh (empty) board
    }
    // Auto-submit the season-best on any improvement (guarded so an
    // unchanged score never re-POSTs).
    void submitBest();
  });

  function freshBuild() {
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
      const outcome = simulate(lineup, generateGauntlet(build.date, build.day));
      const ride: LastRide = { date: build.date, day: build.day, lineup, result: outcome.result };
      saveLastRide(ride);
      lastRide = ride;
      submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: true });
    }
    const dawnInterest = build.day >= SEASON_DAYS ? 0 : interestFor(build.scrap);
    build = advanceAfterDawn(build, addDay(build.date));
    if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
    saveBuild(build);
    inspect = null;
    pendingRelic = null;
    pendingSwap = null;
    notice = '';
  }

  // Dev: credit some hours of idle income without waiting — simulates the
  // next h hourly gauntlets so the log shows real variance. (A scrap cheat:
  // the wall clock will ride those hours again for real.)
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
      const { result } = simulate(lineup, generateGauntlet(build.date, build.day, nowHour + i));
      const scrap = result.wavesCleared * SCRAP_PER_DEPTH;
      earned += scrap;
      rides.push({
        hour: nowHour + i,
        depth: result.wavesCleared,
        scrap,
        survivors: result.survivors.length,
        enemiesDefeated: result.enemiesDefeated,
      });
    }
    rideLog = [...rides.reverse(), ...rideLog].slice(0, RIDE_LOG_MAX);
    saveRideLog(rideLog);
    const deepest = rides.reduce((a, r) => (r.depth > a.depth ? r : a));
    if (deepest.depth > seasonBest) {
      seasonBest = deepest.depth;
      seasonBestHour = deepest.hour;
      saveSeasonBest(build.seasonId, seasonBest, deepest.hour);
    }
    seasonKills += rides.reduce((sum, r) => sum + r.enemiesDefeated, 0);
    saveSeasonKills(build.seasonId, seasonKills);
    build = { ...build, scrap: build.scrap + earned };
    awaySummary = { rides: h, scrap: earned };
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

  // Tapping a stall opens its inspect card; the card houses the buy/pin
  // action, so nothing is spent by accident.
  function clickShopSlot(i: number) {
    if (build.shop.slots[i].kind === 'empty') return;
    inspect = { area: 'shop', index: i };
  }

  function clickBoardUnit(boardIndex: number) {
    if (pendingRelic !== null) {
      if (apply(buyRelic(build, pendingRelic, boardIndex))) pendingRelic = null;
      return;
    }
    if (pendingSwap !== null) {
      if (apply(swapWithBench(build, boardIndex, pendingSwap))) pendingSwap = null;
      return;
    }
    inspect = { area: 'board', index: boardIndex };
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
    if (apply(buyUnit(build, i))) inspect = null;
  }

  function pinRelicFromCard(i: number) {
    const slot = build.shop.slots[i];
    if (slot.kind !== 'relic') return;
    if (RELIC_DEFS[slot.relicId].scope === 'team') {
      if (apply(buyRelic(build, i))) inspect = null;
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
    await player.play(outcome.events);
    result = outcome.result;
    phase = 'done';
  }

  function backToWarren() {
    phase = 'idle';
    result = null;
  }
</script>

{#if updateAvailable && !updateDismissed}
  <div class="update-banner" role="status">
    <button class="update-banner-reload" onclick={reloadForUpdate}>
      ⚔ a fresh build rode in — tap to reload
    </button>
    <button class="update-banner-dismiss" onclick={dismissUpdateBanner} aria-label="dismiss">✕</button>
  </div>
{/if}

<main class:update-banner-open={updateAvailable && !updateDismissed}>
  <h1>WE RIDE AT DAWN</h1>
  <p class="sub">
    Week of {build.seasonId} · day {build.day}/{SEASON_DAYS} · rides hourly{CHANNEL === 'dev'
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

  <div class="scout">
    <div class="panel-label">the drains right now — what your horde fights</div>
    <p class="scout-flavor">&ldquo;{report.flavor}&rdquo;</p>
    <div class="chips">
      {#each report.hints as hint}
        <span class="chip">
          {ARCHETYPE_LABEL[hint.archetype]}{hint.fromWave ? ` · wave ${hint.fromWave}+` : ''}
        </span>
      {/each}
    </div>
  </div>

  <div class="build">
    <div class="status-row">
      <span class="scrap">⚙ {build.scrap} scrap</span>
      {#if notice}<span class="notice">{notice}</span>{/if}
    </div>

    <div class="horde-panel">
    <div class="panel-label row-label">
      <span>your horde · {build.board.length}/{boardCapForDay(build.day)}</span>
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
              {UNIT_DEFS[unit.defId].desc ?? ''}
            {/if}
          </span>
        </button>
      {/each}
      {#each Array.from({ length: Math.max(0, boardCapForDay(build.day) - build.board.length) }) as _}
        <div class="tile empty-tile">empty</div>
      {/each}
    </div>
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
              {UNIT_DEFS[unit.defId].desc ?? ''}
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
      <span>the scrap-market</span>
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
            <span class="tile-sub">{def.desc ?? ''}</span>
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
      <button onclick={() => apply(rerollShop(build))}>↻ reroll · {REROLL_COST} scrap</button>
    </div>
    </div>

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
        <p class="result-note">each hourly ride reshuffles the drains — same threats, new arrangement</p>
      {/if}
      <button class="ride" onclick={backToWarren} disabled={phase === 'riding'}>
        {phase === 'riding' ? 'Riding…' : '← back to the warren'}
      </button>
    {:else}
      <div class="idle">
        <p class="muster-line">Your horde rides the drains <strong>every hour</strong>, hauling back scrap by how deep it pushes. Each ride the drains reshuffle — same threats, new arrangement.</p>
        <div class="idle-stats">
          <div class="stat"><span class="stat-big">{currentDepth}</span><span class="stat-lbl">next depth</span></div>
          <div class="stat"><span class="stat-big">+{scrapPerHour}</span><span class="stat-lbl">next haul</span></div>
          <div class="stat"><span class="stat-big">{formatCountdown(secondsToNextHour)}</span><span class="stat-lbl">rides in</span></div>
        </div>
        <p class="idle-note">
          +{SCRAP_PER_DEPTH} scrap per depth cleared, every hour · +{interestFor(build.scrap)} interest banked each dawn · gets tougher deeper
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
      <span class="panel-label">Deepest riders · week of {build.seasonId}</span>
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
            <div class="card-head">
              {#if ART_URL[def.id]}<img class="card-portrait" src={ART_URL[def.id]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}</div>
                <div class="card-stats">
                  {def.attack}/{def.health}
                  <span class="card-tier">★2 {def.attack * 2}/{def.health * 2} · ★3 {def.attack * 3}/{def.health * 3}</span>
                </div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(def.id)}</p>
            {#if isSummoner(def.id)}
              <p class="card-hint">summons pause when your warren is full ({BOARD_CAP})</p>
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
              <button class="primary" disabled={!afford || owned} onclick={() => pinRelicFromCard(ins.index)}>
                {relic.scope === 'team' ? 'Add' : 'Pin'} · ⚙ {relic.cost}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if owned}<div class="card-warn">the horde already carries one</div>
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
              <p class="card-hint">summons pause when your warren is full ({BOARD_CAP})</p>
            {/if}
            {#if unit.relicIds.length > 0}
              <p class="card-relics">✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}</p>
            {/if}
            <div class="card-actions">
              <button disabled={ins.index === 0} onclick={() => moveFromCard(-1)}>front ▶</button>
              <button disabled={ins.index >= build.board.length - 1} onclick={() => moveFromCard(1)}>◀ back</button>
              <button disabled={benchFull} onclick={benchFromCard}>bench</button>
              <button onclick={sellFromCard}>sell · +{sellRefund(unit)}</button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if benchFull}<div class="card-warn">the bench is full</div>{/if}
          {/if}
        {:else}
          {@const unit = build.bench[ins.index]}
          {#if unit}
            {@const def = UNIT_DEFS[unit.defId]}
            {@const stats = unitStats(unit)}
            {@const boardFull = build.board.length >= boardCapForDay(build.day)}
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
              <button onclick={sellBenchFromCard}>sell · +{sellRefund(unit)}</button>
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
  .update-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: stretch;
    justify-content: center;
    background: var(--accent);
    border-bottom: 1px solid #7a3018;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .update-banner-reload {
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

  .update-banner-dismiss {
    padding: 8px 14px;
    font-family: inherit;
    font-size: 13px;
    color: #f5ead2;
    background: transparent;
    border: none;
    border-left: 1px solid #7a3018;
    cursor: pointer;
    opacity: 0.85;
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

  .scout {
    max-width: 620px;
    margin: 0 auto 14px;
    padding: 10px 16px;
    background: var(--panel);
    border: 1px solid #4a3520;
    border-radius: 8px;
    text-align: left;
  }

  .scout-flavor {
    margin: 5px 0 8px;
    font-size: 14px;
    font-style: italic;
  }

  .chips {
    display: flex;
    gap: 6px;
  }

  .chip {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 10px;
    background: #2a2118;
    color: #c9b891;
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

  .notice {
    font-size: 13px;
    color: #d8452e;
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
  }
</style>
