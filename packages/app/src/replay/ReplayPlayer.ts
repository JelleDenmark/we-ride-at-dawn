import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { BattleEvent, Side, UnitView } from '@wrad/core';
import { ART_URL } from '../art';

const W = 900;
const H = 420;
const GROUND_Y = 250;
const FRONT_GAP = 72;
const SPACING = 84;
const UNIT_SIZE = 64;

const SIDE_COLOR: Record<Side, number> = { horde: 0x8a4b2f, gauntlet: 0x46586e };

// Issue #118: the Boss Trial's boss (defId 'boss-trial', see
// packages/core/src/boss-trial.ts) grows 1.5^phase — the same factor its
// attack grows by, so its size literally reads as "how hard it hits". No
// normal ride gauntlet ever contains this defId, so this constant and the
// scaling it drives are entirely dormant on the ride-replay path.
const BOSS_TRIAL_DEF_ID = 'boss-trial';
const BOSS_TRIAL_SCALE_BASE = 1.5;

// Populated once by ReplayPlayer.init(); unknown ids fall back to a plain rect.
const ART_TEXTURE = new Map<string, Texture>();

function wait(ms: number): Promise<void> {
  // Resolve 0-waits synchronously: hidden tabs throttle setTimeout hard, and
  // a skipped replay must be able to finish timer-free in the background.
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

// Driven by rAF with a timer fallback: rAF stops in hidden tabs, and an
// awaited tween that never resolves would freeze the replay forever.
function tween(
  target: Container,
  to: { x?: number; y?: number; alpha?: number },
  ms: number
): Promise<void> {
  const from = { x: target.x, y: target.y, alpha: target.alpha };
  if (ms <= 0) {
    if (to.x !== undefined) target.x = to.x;
    if (to.y !== undefined) target.y = to.y;
    if (to.alpha !== undefined) target.alpha = to.alpha;
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (done) return;
      const t = Math.min(1, (performance.now() - start) / ms);
      const ease = 1 - (1 - t) ** 2;
      if (to.x !== undefined) target.x = from.x + (to.x - from.x) * ease;
      if (to.y !== undefined) target.y = from.y + (to.y - from.y) * ease;
      if (to.alpha !== undefined) target.alpha = from.alpha + (to.alpha - from.alpha) * ease;
      if (t < 1) {
        requestAnimationFrame(step);
        clearTimeout(timer);
        timer = setTimeout(step, 100);
      } else {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    };
    step();
  });
}

class UnitSprite {
  root = new Container();
  private statsText: Text;

  /**
   * `growth` (default 1) is the Boss Trial's 1.5^phase visual scale (issue
   * #118) — applied to the body only (loaded texture OR the missing-texture
   * fallback rect below, both anchored/drawn centered on `root`'s local
   * origin, so growth scales symmetrically without shifting the sprite off
   * its laid-out position). Name/stats text stay unscaled and readable; the
   * body is left to overflow the fixed-size canvas at deep phases (~1640px
   * at phase 8) by design — Pixi simply doesn't render past the canvas
   * bounds, so this "breaches" without distorting any other sprite's
   * layout. Every non-Boss-Trial caller passes the default 1, so this is a
   * pure no-op for normal ride replays.
   */
  constructor(view: UnitView, growth = 1) {
    const texture = ART_TEXTURE.get(view.defId);
    let body: Container;
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      const scale = (UNIT_SIZE / Math.max(texture.width, texture.height)) * growth;
      // Sprites are drawn facing right; mirror the gauntlet side to face
      // the horde. Text stays a separate, unmirrored child of root.
      sprite.scale.set(view.side === 'gauntlet' ? -scale : scale, scale);
      body = sprite;
    } else {
      body = new Graphics()
        .roundRect(-UNIT_SIZE / 2, -UNIT_SIZE / 2, UNIT_SIZE, UNIT_SIZE, 8)
        .fill(SIDE_COLOR[view.side])
        .stroke({ color: 0x000000, width: 2 });
      if (growth !== 1) body.scale.set(growth);
    }
    const name = new Text({
      text: view.tier > 1 ? `${view.name} ★${view.tier}` : view.name,
      style: { fill: 0xd8cdb8, fontSize: 11, fontFamily: 'Georgia' },
    });
    name.anchor.set(0.5);
    name.y = -UNIT_SIZE / 2 - 12;
    this.statsText = new Text({
      text: '',
      style: { fill: 0xf0e6d2, fontSize: 14, fontWeight: 'bold', fontFamily: 'Georgia' },
    });
    this.statsText.anchor.set(0.5);
    this.statsText.y = UNIT_SIZE / 2 + 12;
    this.root.addChild(body, name, this.statsText);
    this.setStats(view.attack, view.health);
  }

  setStats(attack: number, health: number): void {
    this.statsText.text = `${attack}/${health}`;
  }
}

export class ReplayPlayer {
  /** Playback speed multiplier; set very high (1e9) to skip to the end. */
  speed = 1;
  private app!: Application;
  private sprites = new Map<number, UnitSprite>();
  private stats = new Map<number, { attack: number; health: number }>();
  private order: Record<Side, number[]> = { horde: [], gauntlet: [] };
  private banner?: Text;
  /** Index of the current event within the events array passed to play(). */
  private currentIndex = 0;
  /** Index of the last waveStart event, or -1 if there is none. */
  private lastWaveStartIndex = -1;
  /** While currentIndex < skipUntilIndex, d(ms) fast-forwards to 0. */
  private skipUntilIndex = -1;

  async init(el: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({ width: W, height: H, background: 0x120f0c, antialias: true });
    el.appendChild(this.app.canvas);
    await ReplayPlayer.loadArt();
  }

  // Rasterize every unit SVG to a texture up front so play() never awaits a
  // load mid-replay. Failures leave the id absent, falling back to a rect.
  private static loadArt(): Promise<void> {
    if (ART_TEXTURE.size > 0) return Promise.resolve();
    return Promise.all(
      Object.entries(ART_URL).map(async ([id, url]) => {
        try {
          const texture = await Assets.load<Texture>({ src: url, data: { resolution: 2 } });
          ART_TEXTURE.set(id, texture);
        } catch {
          // Leave unset; UnitSprite draws its fallback rect.
        }
      })
    ).then(() => undefined);
  }

  async play(events: BattleEvent[]): Promise<void> {
    this.reset();
    this.lastWaveStartIndex = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'waveStart') this.lastWaveStartIndex = i;
    }
    for (let i = 0; i < events.length; i++) {
      this.currentIndex = i;
      await this.handle(events[i]);
    }
  }

  /** Jump straight to the final wave: everything before it plays at 0 delay,
   * then normal speed resumes so the last wave is watched, not skipped. */
  jumpToLastWave(): void {
    if (this.lastWaveStartIndex > this.currentIndex) {
      this.skipUntilIndex = this.lastWaveStartIndex;
    }
  }

  private d(ms: number): number {
    if (this.speed >= 1e6) return 0;
    if (this.currentIndex < this.skipUntilIndex) return 0;
    return ms / this.speed;
  }

  private reset(): void {
    this.app.stage.removeChildren();
    this.sprites.clear();
    this.stats.clear();
    this.order = { horde: [], gauntlet: [] };
    this.banner = undefined;
    this.currentIndex = 0;
    this.skipUntilIndex = -1;
  }

  private async handle(event: BattleEvent): Promise<void> {
    switch (event.type) {
      case 'battleStart': {
        for (const unit of event.horde) this.spawn(unit, this.order.horde.length, -80);
        await this.layout(this.d(280));
        break;
      }
      case 'waveStart': {
        // Boss Trial phase = wave (see boss-trial.ts's doc comment), so the
        // 1-based `event.wave` straight off this event is the 0-based phase
        // index the boss's 1.5^phase growth uses — no separate wave-boundary
        // tracking needed beyond what this event already carries. Non-boss
        // enemies (every normal ride gauntlet) always get growth 1.
        const phaseIndex = event.wave - 1;
        for (const unit of event.enemies) {
          const growth =
            unit.defId === BOSS_TRIAL_DEF_ID ? BOSS_TRIAL_SCALE_BASE ** phaseIndex : 1;
          this.spawn(unit, this.order.gauntlet.length, W + 80, growth);
        }
        this.showBanner(`WAVE ${event.wave}`);
        await this.layout(this.d(320));
        await wait(this.d(300));
        break;
      }
      case 'clash': {
        const a = this.sprites.get(event.hordeId);
        const b = this.sprites.get(event.enemyId);
        if (!a || !b) break;
        await Promise.all([
          tween(a.root, { x: a.root.x + 18 }, this.d(110)),
          tween(b.root, { x: b.root.x - 18 }, this.d(110)),
        ]);
        await this.layout(this.d(110));
        break;
      }
      case 'damage': {
        const sprite = this.sprites.get(event.targetId);
        const s = this.stats.get(event.targetId);
        if (!sprite || !s) break;
        // Clamp for display: the sim reports true (possibly negative) health
        // and resolves the death at end of tick, but a rat standing at -9
        // reads as a bug to a player. The death event still removes it.
        s.health = Math.max(0, event.remainingHealth);
        sprite.setStats(s.attack, s.health);
        await this.floatText(sprite.root.x, sprite.root.y - 44, `-${event.amount}`, 0xd8452e);
        break;
      }
      case 'poisonTick': {
        const sprite = this.sprites.get(event.targetId);
        const s = this.stats.get(event.targetId);
        if (!sprite || !s) break;
        // Clamp for display: the sim reports true (possibly negative) health
        // and resolves the death at end of tick, but a rat standing at -9
        // reads as a bug to a player. The death event still removes it.
        s.health = Math.max(0, event.remainingHealth);
        sprite.setStats(s.attack, s.health);
        await this.floatText(sprite.root.x, sprite.root.y - 44, `-${event.amount} ☠`, 0x9b59b6);
        break;
      }
      case 'poisonApplied': {
        const sprite = this.sprites.get(event.targetId);
        if (!sprite) break;
        await this.floatText(sprite.root.x, sprite.root.y - 44, `☠ poison ×${event.totalStacks}`, 0x9b59b6);
        break;
      }
      case 'heal': {
        const sprite = this.sprites.get(event.targetId);
        const s = this.stats.get(event.targetId);
        if (!sprite || !s) break;
        s.health = event.newHealth;
        sprite.setStats(s.attack, s.health);
        await this.floatText(sprite.root.x, sprite.root.y - 44, `+${event.amount}`, 0x7fb069);
        break;
      }
      case 'relicProc': {
        const sprite = this.sprites.get(event.targetId);
        if (!sprite) break;
        await this.floatText(sprite.root.x, sprite.root.y - 58, `✦ ${event.name}`, 0xd4af37);
        break;
      }
      case 'revive': {
        this.spawn(event.unit, event.index, event.unit.side === 'horde' ? -80 : W + 80);
        await this.layout(this.d(200));
        const sprite = this.sprites.get(event.unit.instanceId);
        if (sprite) await this.floatText(sprite.root.x, sprite.root.y - 58, 'RISEN', 0xd4af37);
        break;
      }
      case 'buff': {
        const sprite = this.sprites.get(event.targetId);
        if (!sprite) break;
        this.stats.set(event.targetId, { attack: event.newAttack, health: event.newHealth });
        sprite.setStats(event.newAttack, event.newHealth);
        const label =
          (event.attack ? `+${event.attack} ATK ` : '') + (event.health ? `+${event.health} HP` : '');
        await this.floatText(sprite.root.x, sprite.root.y - 44, label.trim(), 0x7fb069);
        break;
      }
      case 'weaken': {
        // Gutter-Acolyte's attack shred (issue #137) — a debuff, so it must
        // not wear the buff case's green "+N" costume. Health is untouched
        // by this event; read the tracked value through.
        const sprite = this.sprites.get(event.targetId);
        if (!sprite) break;
        const health = this.stats.get(event.targetId)?.health ?? 0;
        this.stats.set(event.targetId, { attack: event.newAttack, health });
        sprite.setStats(event.newAttack, health);
        await this.floatText(sprite.root.x, sprite.root.y - 44, `−${event.attack} ATK`, 0xb08bd0);
        break;
      }
      case 'death': {
        const sprite = this.sprites.get(event.unitId);
        if (!sprite) break;
        await tween(sprite.root, { alpha: 0, y: GROUND_Y + 24 }, this.d(240));
        this.app.stage.removeChild(sprite.root);
        this.sprites.delete(event.unitId);
        this.stats.delete(event.unitId);
        this.order.horde = this.order.horde.filter((id) => id !== event.unitId);
        this.order.gauntlet = this.order.gauntlet.filter((id) => id !== event.unitId);
        await this.layout(this.d(140));
        break;
      }
      case 'summon': {
        this.spawn(event.unit, event.index, event.unit.side === 'horde' ? -80 : W + 80);
        await this.layout(this.d(200));
        break;
      }
      case 'waveClear': {
        this.showBanner(`WAVE ${event.wave} CLEARED — deeper into the city`);
        await wait(this.d(650));
        break;
      }
      case 'battleEnd': {
        this.showBanner(
          `THE RIDE ENDS — DEPTH ${event.wavesCleared} · SCORE ${event.score}`,
          true
        );
        await wait(this.d(400));
        break;
      }
    }
  }

  private spawn(view: UnitView, index: number, fromX: number, growth = 1): void {
    const sprite = new UnitSprite(view, growth);
    sprite.root.x = fromX;
    sprite.root.y = GROUND_Y;
    this.app.stage.addChild(sprite.root);
    this.sprites.set(view.instanceId, sprite);
    this.stats.set(view.instanceId, { attack: view.attack, health: view.health });
    this.order[view.side].splice(index, 0, view.instanceId);
  }

  private layout(ms: number): Promise<unknown> {
    // Spacing compresses when a side outgrows its half of the stage. The
    // fixed 84px SPACING dates from the board-cap-5 era: index 5+ computed
    // to x < 0 and rats silently queued OFF-CANVAS (a 7-rat board looked
    // like only 5 ever fought). Combat can now hold up to 10 a side (8
    // board + 2 summon headroom), so pack them in instead — overlap beats
    // invisible.
    const HALF_WIDTH = W / 2 - FRONT_GAP - 48; // 48px margin to the stage edge
    const spacingFor = (n: number): number =>
      n > 1 ? Math.min(SPACING, HALF_WIDTH / (n - 1)) : SPACING;
    const moves: Promise<void>[] = [];
    const hordeSpacing = spacingFor(this.order.horde.length);
    this.order.horde.forEach((id, i) => {
      const sprite = this.sprites.get(id);
      if (sprite) moves.push(tween(sprite.root, { x: W / 2 - FRONT_GAP - i * hordeSpacing, y: GROUND_Y }, ms));
    });
    const gauntletSpacing = spacingFor(this.order.gauntlet.length);
    this.order.gauntlet.forEach((id, i) => {
      const sprite = this.sprites.get(id);
      if (sprite) moves.push(tween(sprite.root, { x: W / 2 + FRONT_GAP + i * gauntletSpacing, y: GROUND_Y }, ms));
    });
    return Promise.all(moves);
  }

  private showBanner(text: string, persistent = false): void {
    if (this.banner) this.app.stage.removeChild(this.banner);
    this.banner = new Text({
      text,
      style: { fill: 0xd8cdb8, fontSize: 22, letterSpacing: 3, fontFamily: 'Georgia' },
    });
    this.banner.anchor.set(0.5);
    this.banner.x = W / 2;
    this.banner.y = 56;
    this.app.stage.addChild(this.banner);
    if (!persistent) {
      const banner = this.banner;
      setTimeout(() => tween(banner, { alpha: 0 }, this.d(400)), this.d(900));
    }
  }

  private async floatText(x: number, y: number, text: string, color: number): Promise<void> {
    const label = new Text({
      text,
      style: { fill: color, fontSize: 16, fontWeight: 'bold', fontFamily: 'Georgia' },
    });
    label.anchor.set(0.5);
    label.x = x;
    label.y = y;
    this.app.stage.addChild(label);
    await tween(label, { y: y - 26, alpha: 0 }, this.d(380));
    this.app.stage.removeChild(label);
  }
}
