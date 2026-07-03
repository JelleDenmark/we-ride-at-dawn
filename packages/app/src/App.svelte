<script lang="ts">
  import { onMount } from 'svelte';
  import {
    currentRideDate,
    dailySeed,
    generateGauntlet,
    scoutReport,
    ARCHETYPE_LABEL,
    simulate,
    TEST_HORDE,
    type BattleResult,
  } from '@wrad/core';
  import { ReplayPlayer } from './replay/ReplayPlayer';

  const date = currentRideDate();
  const seed = dailySeed(date);
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const report = scoutReport(generateGauntlet(tomorrow));

  let stageEl: HTMLDivElement;
  let player: ReplayPlayer | undefined;
  let phase: 'idle' | 'riding' | 'done' = $state('idle');
  let result: BattleResult | null = $state(null);

  onMount(async () => {
    player = new ReplayPlayer();
    await player.init(stageEl);
  });

  async function ride() {
    if (!player || phase === 'riding') return;
    phase = 'riding';
    result = null;
    const gauntlet = generateGauntlet(date);
    const outcome = simulate(TEST_HORDE, gauntlet);
    await player.play(outcome.events);
    result = outcome.result;
    phase = 'done';
  }
</script>

<main>
  <h1>WE RIDE AT DAWN</h1>
  <p class="sub">gauntlet of {date} &middot; seed {seed.toString(16)}</p>
  <div class="scout">
    <div class="scout-label">scout report — tomorrow's gauntlet</div>
    <p class="scout-flavor">&ldquo;{report.flavor}&rdquo;</p>
    <div class="scout-chips">
      {#each report.hints as hint}
        <span class="chip">
          {ARCHETYPE_LABEL[hint.archetype]}{hint.fromWave ? ` · wave ${hint.fromWave}+` : ''}
        </span>
      {/each}
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

  .scout {
    max-width: 560px;
    margin: 0 auto 16px;
    padding: 10px 16px;
    background: var(--panel);
    border: 1px solid #4a3520;
    border-radius: 8px;
    text-align: left;
  }

  .scout-label {
    font-size: 12px;
    color: var(--ink-dim);
  }

  .scout-flavor {
    margin: 5px 0 8px;
    font-size: 14px;
    font-style: italic;
  }

  .scout-chips {
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
