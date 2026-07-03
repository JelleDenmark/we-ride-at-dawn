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
  import { loadBuild, saveBuild } from './persistence';

  let selectedDate = $state(currentRideDate());
  const seed = $derived(dailySeed(selectedDate));
  const tomorrow = $derived(
    new Date(Date.parse(`${selectedDate}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  );
  const report = $derived(scoutReport(generateGauntlet(tomorrow)));
  const theme = $derived(generateGauntlet(selectedDate).theme);

  let build = $state<BuildState>(loadBuild(currentRideDate()) ?? newBuild(currentRideDate()));
  let speed = $state(1);
  let selected = $state<number | null>(null);
  let pendingRelic = $state<number | null>(null);
  let notice = $state('');

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  onMount(async () => {
    player = new ReplayPlayer();
    await player.init(stageEl);
  });

  function setDate(d: string) {
    if (!d) return;
    selectedDate = d;
    build = loadBuild(d) ?? newBuild(d);
    selected = null;
    pendingRelic = null;
    result = null;
    notice = '';
  }

  function freshBuild() {
    build = newBuild(selectedDate);
    saveBuild(build);
    selected = null;
    pendingRelic = null;
    notice = '';
  }

  function addScrap() {
    build = { ...build, scrap: build.scrap + 10 };
    saveBuild(build);
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

  function clickShopSlot(i: number) {
    const slot = build.shop.slots[i];
    if (slot.kind === 'unit') {
      selected = null;
      pendingRelic = null;
      apply(buyUnit(build, i));
    } else if (slot.kind === 'relic') {
      if (RELIC_DEFS[slot.relicId].scope === 'team') {
        pendingRelic = null;
        apply(buyRelic(build, i));
      } else {
        pendingRelic = pendingRelic === i ? null : i;
        notice = pendingRelic === null ? '' : 'pick a rat to carry it';
      }
    }
  }

  function clickBoardUnit(boardIndex: number) {
    if (pendingRelic !== null) {
      if (apply(buyRelic(build, pendingRelic, boardIndex))) pendingRelic = null;
      return;
    }
    selected = selected === boardIndex ? null : boardIndex;
  }

  function move(delta: number) {
    if (selected === null) return;
    const to = selected + delta;
    if (apply(moveUnit(build, selected, to))) selected = to;
  }

  function sell() {
    if (selected === null) return;
    if (apply(sellUnit(build, selected))) selected = null;
  }

  function freeze(i: number, e: Event) {
    e.stopPropagation();
    apply(toggleFreeze(build, i));
  }

  async function ride() {
    if (!player || phase === 'riding') return;
    if (build.board.length === 0) {
      notice = 'recruit some rats first';
      return;
    }
    selected = null;
    pendingRelic = null;
    phase = 'riding';
    result = null;
    player.speed = speed;
    const outcome = simulate(lineupFromBuild(build), generateGauntlet(selectedDate));
    await player.play(outcome.events);
    result = outcome.result;
    phase = 'done';
  }
</script>

<main>
  <h1>WE RIDE AT DAWN</h1>
  <p class="sub">gauntlet of {selectedDate} &middot; seed {seed.toString(16)}</p>

  <div class="dev">
    <span class="panel-label">testing</span>
    <input
      type="date"
      value={selectedDate}
      onchange={(e) => setDate(e.currentTarget.value)}
    />
    <button onclick={freshBuild}>fresh build</button>
    <button onclick={addScrap}>+10 scrap</button>
    <span class="dev-theme">theme: {theme.primary} + {theme.secondary} @ wave {theme.pivotWave}</span>
    <span class="dev-sep">·</span>
    {#each [1, 2, 4] as s}
      <button class:active={speed === s} onclick={() => setSpeed(s)}>{s}×</button>
    {/each}
    <button onclick={skipReplay} disabled={phase !== 'riding'}>skip ⏭</button>
  </div>

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
          class:selected={selected === bi}
          class:pin-target={pendingRelic !== null}
          onclick={() => clickBoardUnit(bi)}
        >
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
    {#if selected !== null && build.board[selected]}
      <div class="unit-actions">
        <button onclick={() => move(1)} disabled={selected >= build.board.length - 1}>◀ back</button>
        <button onclick={sell}>sell · +{sellRefund(build.board[selected])}</button>
        <button onclick={() => move(-1)} disabled={selected === 0}>front ▶</button>
      </div>
    {/if}
    {#if build.teamRelicIds.length > 0}
      <div class="team-relics">
        team: {build.teamRelicIds.map((r) => RELIC_DEFS[r].name).join(', ')}
      </div>
    {/if}

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

  <div class="stage" bind:this={stageEl}></div>
  <button class="ride" onclick={ride} disabled={phase === 'riding'}>
    {phase === 'idle' ? 'The horde rides' : phase === 'riding' ? 'Riding…' : 'Ride again'}
  </button>
  {#if result}
    <p class="result">
      Depth: <strong>wave {result.wavesCleared}</strong>
      &middot; score <strong>{result.score}</strong>
      &middot; {result.survivors.length > 0
        ? `${result.survivors.length} rats crawled home`
        : 'the horde was wiped out'}
    </p>
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
    margin-bottom: 6px;
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

  .unit-actions,
  .market-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }

  .unit-actions button,
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

  .unit-actions button:disabled {
    opacity: 0.4;
    cursor: default;
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
</style>
