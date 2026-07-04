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
    buyUnit,
    canRecruit,
    buyRelic,
    sellUnit,
    sellRefund,
    rerollShop,
    toggleFreeze,
    moveUnit,
    lineupFromBuild,
    unitStats,
    REROLL_COST,
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
    type LastRide,
  } from './persistence';
  import {
    submitRun,
    telemetryConfigured,
    telemetryEnabled,
    setTelemetryEnabled,
  } from './telemetry';

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

  function secondsUntilDawn(now: Date): number {
    const d = 6 * 3600 - copenhagenSeconds(now);
    return d <= 0 ? d + 86_400 : d;
  }

  function formatCountdown(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  // build.date is the target ride date — the next dawn this horde rides.
  let build = $state<BuildState>(loadPending() ?? newBuild(addDay(currentRideDate())));
  let lastRide = $state<LastRide | null>(loadLastRide());
  let nowTick = $state(Date.now());
  let practiceMode = $state(false);
  let speed = $state(1);

  const targetDate = $derived(build.date);
  const report = $derived(scoutReport(generateGauntlet(targetDate)));
  const theme = $derived(generateGauntlet(targetDate).theme);
  const countdownSec = $derived(secondsUntilDawn(new Date(nowTick)));
  let telemetry = $state(telemetryEnabled());
  let pendingRelic = $state<number | null>(null);
  let inspect = $state<{ area: 'shop' | 'board'; index: number } | null>(null);
  let notice = $state('');

  const TRIGGER_WHEN: Record<string, string> = {
    startOfBattle: 'At the start of battle,',
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

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  onMount(() => {
    const id = setInterval(() => (nowTick = Date.now()), 1000);
    void (async () => {
      player = new ReplayPlayer();
      await player.init(stageEl);
    })();
    return () => clearInterval(id);
  });

  // When a dawn passes, the pending horde locks and rides its target
  // gauntlet; the result is stored and a fresh horde is started for the
  // next dawn. Runs on load and each tick, but only acts on a boundary.
  $effect(() => {
    void nowTick;
    const today = currentRideDate(new Date(nowTick));
    if (build.date <= today) {
      const lineup = lineupFromBuild(build);
      if (lineup.units.length > 0) {
        const outcome = simulate(lineup, generateGauntlet(build.date));
        const ride: LastRide = { date: build.date, lineup, result: outcome.result };
        saveLastRide(ride);
        lastRide = ride;
        submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: CHANNEL === 'dev' });
      }
      build = newBuild(addDay(today));
      saveBuild(build);
    }
  });

  function freshBuild() {
    build = newBuild(build.date);
    saveBuild(build);
    inspect = null;
    pendingRelic = null;
    notice = '';
  }

  function addScrap() {
    build = { ...build, scrap: build.scrap + 10 };
    saveBuild(build);
  }

  // Dev: pretend the next dawn arrived — resolve the current horde now.
  function simulateDawn() {
    const lineup = lineupFromBuild(build);
    if (lineup.units.length === 0) {
      notice = 'recruit some rats first';
      return;
    }
    const outcome = simulate(lineup, generateGauntlet(build.date));
    const ride: LastRide = { date: build.date, lineup, result: outcome.result };
    saveLastRide(ride);
    lastRide = ride;
    submitRun({ rideDate: build.date, lineup, result: outcome.result, dev: true });
    build = newBuild(addDay(build.date));
    saveBuild(build);
    inspect = null;
    pendingRelic = null;
    notice = '';
  }

  function setSpeed(s: number) {
    speed = s;
    if (player) player.speed = s;
  }

  function skipReplay() {
    if (player) player.speed = 1e9;
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
    inspect = { area: 'board', index: boardIndex };
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

  function freeze(i: number, e: Event) {
    e.stopPropagation();
    apply(toggleFreeze(build, i));
  }

  // Practice against today's already-revealed gauntlet — never tomorrow's
  // (that stays a surprise until dawn). Doesn't count, isn't submitted.
  async function practiceRide() {
    if (!player || phase === 'riding') return;
    if (build.board.length === 0) {
      notice = 'recruit some rats first';
      return;
    }
    inspect = null;
    pendingRelic = null;
    practiceMode = true;
    phase = 'riding';
    result = null;
    player.speed = speed;
    const today = currentRideDate(new Date(nowTick));
    const outcome = simulate(lineupFromBuild(build), generateGauntlet(today));
    await player.play(outcome.events);
    result = outcome.result;
    phase = 'done';
  }

  async function watchLastDawn() {
    if (!player || phase === 'riding' || !lastRide) return;
    inspect = null;
    practiceMode = false;
    phase = 'riding';
    result = null;
    player.speed = speed;
    const outcome = simulate(lastRide.lineup, generateGauntlet(lastRide.date));
    await player.play(outcome.events);
    result = outcome.result;
    phase = 'done';
  }

  function backToWarren() {
    phase = 'idle';
    result = null;
  }
</script>

<main>
  <h1>WE RIDE AT DAWN</h1>
  <p class="sub">
    building for the dawn of {targetDate}{CHANNEL === 'dev' ? ' · dev build' : ''}
  </p>

  {#if CHANNEL === 'dev'}
  <div class="dev">
    <span class="panel-label">testing</span>
    <button onclick={simulateDawn}>⏭ simulate dawn</button>
    <button onclick={freshBuild}>fresh build</button>
    <button onclick={addScrap}>+10 scrap</button>
    <span class="dev-theme">tomorrow: {theme.primary} + {theme.secondary} @ wave {theme.pivotWave}</span>
    <span class="dev-sep">·</span>
    {#each [1, 2, 4] as s}
      <button class:active={speed === s} onclick={() => setSpeed(s)}>{s}×</button>
    {/each}
    <button onclick={skipReplay} disabled={phase !== 'riding'}>skip ⏭</button>
  </div>
  {/if}

  <div class="scout">
    <div class="panel-label">scout report — tomorrow's gauntlet</div>
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
      <span>your horde</span>
      <span>front → into the drains</span>
    </div>
    <div class="board horde-board">
      {#each Array.from({ length: 5 - build.board.length }) as _}
        <div class="tile empty-tile">empty</div>
      {/each}
      {#each build.board.slice().reverse() as unit, di}
        {@const bi = build.board.length - 1 - di}
        {@const stats = unitStats(unit)}
        <button
          class="tile unit-tile"
          class:selected={inspect?.area === 'board' && inspect.index === bi}
          class:pin-target={pendingRelic !== null}
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
    </div>
    {#if build.teamRelicIds.length > 0}
      <div class="team-relics">
        team: {build.teamRelicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
      </div>
    {/if}
    </div>

    <div class="shop-panel">
    <div class="panel-label row-label">
      <span>the scrap-market</span>
      <span>❄ keeps a stall for later</span>
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
            <span class="tile-cost">⚙ {relic.cost}</span>
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
  </div>

  <div class="phase-divider"><span>the ride</span></div>

  <div class="battle-panel">
    <div class="stage" class:hidden={phase === 'idle'} bind:this={stageEl}></div>

    {#if phase !== 'idle'}
      {#if result}
        <p class="result">
          {practiceMode ? 'Practice — ' : 'Dawn ride — '}
          depth <strong>wave {result.wavesCleared}</strong>
          &middot; score <strong>{result.score}</strong>
          &middot; {result.survivors.length > 0
            ? `${result.survivors.length} rats crawled home`
            : 'the horde was wiped out'}
        </p>
      {/if}
      <button class="ride" onclick={backToWarren} disabled={phase === 'riding'}>
        {phase === 'riding' ? 'Riding…' : '← back to the warren'}
      </button>
    {:else}
      <div class="muster">
        <p class="muster-line">The horde is mustered. It rides at the next dawn — <strong>06:00 CET</strong>.</p>
        <p class="countdown">next ride in {formatCountdown(countdownSec)}</p>
        <button class="practice" onclick={practiceRide}>practice ride · doesn't count</button>
      </div>

      {#if lastRide}
        <div class="lastdawn">
          <div class="panel-label">last dawn ride · {lastRide.date}</div>
          <p class="lastdawn-line">
            rode to <strong>wave {lastRide.result.wavesCleared}</strong> · score {lastRide.result.score}
          </p>
          <button class="watch" onclick={watchLastDawn}>watch the replay</button>
        </div>
      {/if}
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
      share anonymous run data to help balance the game
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
            <div class="card-actions">
              <button class="primary" disabled={!recruitable} onclick={() => recruitFromCard(ins.index)}>
                Recruit · ⚙ {def.cost}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if !afford}<div class="card-warn">not enough scrap</div>
            {:else if !recruitable}<div class="card-warn">the warren is full</div>
            {:else if build.board.length >= 5}<div class="card-warn">buying will merge three into one</div>{/if}
          {:else if slot.kind === 'relic'}
            {@const relic = RELIC_DEFS[slot.relicId]}
            {@const afford = build.scrap >= relic.cost}
            <div class="card-head">
              <div class="card-relic-icon">✦</div>
              <div>
                <div class="card-name">{relic.name}</div>
                <div class="card-sub">{relic.scope === 'team' ? 'whole team' : 'pin to one rat'}</div>
              </div>
            </div>
            <p class="card-ability">{relic.desc}.</p>
            <div class="card-actions">
              <button class="primary" disabled={!afford} onclick={() => pinRelicFromCard(ins.index)}>
                {relic.scope === 'team' ? 'Add' : 'Pin'} · ⚙ {relic.cost}
              </button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
            {#if !afford}<div class="card-warn">not enough scrap</div>{/if}
          {/if}
        {:else}
          {@const unit = build.board[ins.index]}
          {#if unit}
            {@const def = UNIT_DEFS[unit.defId]}
            {@const stats = unitStats(unit)}
            <div class="card-head">
              {#if ART_URL[unit.defId]}<img class="card-portrait" src={ART_URL[unit.defId]} alt="" />{/if}
              <div>
                <div class="card-name">{def.name}{unit.tier > 1 ? ` ★${unit.tier}` : ''}</div>
                <div class="card-stats">{stats.attack}/{stats.health}</div>
              </div>
            </div>
            <p class="card-ability">{abilitySentence(unit.defId)}</p>
            {#if unit.relicIds.length > 0}
              <p class="card-relics">✦ {unit.relicIds.map((r) => RELIC_DEFS[r].name).join(', ')}</p>
            {/if}
            <div class="card-actions">
              <button disabled={ins.index === 0} onclick={() => moveFromCard(-1)}>front ▶</button>
              <button disabled={ins.index >= build.board.length - 1} onclick={() => moveFromCard(1)}>◀ back</button>
              <button onclick={sellFromCard}>sell · +{sellRefund(unit)}</button>
              <button onclick={() => (inspect = null)}>close</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 940px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    text-align: center;
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

  .relic-tile.arming {
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

  .team-relics {
    margin-top: 8px;
    font-size: 12px;
    color: #c9b891;
  }

  .stage :global(canvas) {
    max-width: 100%;
    border: 1px solid #2a221a;
    border-radius: 6px;
  }

  .stage.hidden {
    display: none;
  }

  .muster {
    text-align: center;
    padding: 6px 0 2px;
  }

  .muster-line {
    margin: 0 0 6px;
    font-size: 15px;
    color: var(--ink);
  }

  .countdown {
    margin: 0 0 14px;
    font-size: 22px;
    letter-spacing: 1px;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .practice {
    padding: 8px 18px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    background: #241a14;
    border: 1px solid #4a3520;
    border-radius: 6px;
    cursor: pointer;
  }

  .lastdawn {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #2a221a;
    text-align: center;
  }

  .lastdawn-line {
    margin: 5px 0 10px;
    font-size: 15px;
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

  .telemetry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 18px;
    font-size: 12px;
    color: var(--ink-dim);
    cursor: pointer;
  }
</style>
