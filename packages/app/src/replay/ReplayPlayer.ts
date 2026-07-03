import { Application, Container, Graphics, Text } from 'pixi.js';
import type { BattleEvent, Side, UnitView } from '@wrad/core';

const W = 900;
const H = 420;
const GROUND_Y = 250;
const FRONT_GAP = 72;
const SPACING = 84;
const UNIT_SIZE = 64;

const SIDE_COLOR: Record<Side, number> = { horde: 0x8a4b2f, gauntlet: 0x46586e };

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Driven by rAF with a timer fallback: rAF stops in hidden tabs, and an
// awaited tween that never resolves would freeze the replay forever.
function tween(
  target: Container,
  to: { x?: number; y?: number; alpha?: number },
  ms: number
): Promise<void> {
  const from = { x: target.x, y: target.y, alpha: target.alpha };
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

  constructor(view: UnitView) {
    const body = new Graphics()
      .roundRect(-UNIT_SIZE / 2, -UNIT_SIZE / 2, UNIT_SIZE, UNIT_SIZE, 8)
      .fill(SIDE_COLOR[view.side])
      .stroke({ color: 0x000000, width: 2 });
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
  private app!: Application;
  private sprites = new Map<number, UnitSprite>();
  private stats = new Map<number, { attack: number; health: number }>();
  private order: Record<Side, number[]> = { horde: [], gauntlet: [] };
  private banner?: Text;

  async init(el: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({ width: W, height: H, background: 0x120f0c, antialias: true });
    el.appendChild(this.app.canvas);
  }

  async play(events: BattleEvent[]): Promise<void> {
    this.reset();
    for (const event of events) await this.handle(event);
  }

  private reset(): void {
    this.app.stage.removeChildren();
    this.sprites.clear();
    this.stats.clear();
    this.order = { horde: [], gauntlet: [] };
    this.banner = undefined;
  }

  private async handle(event: BattleEvent): Promise<void> {
    switch (event.type) {
      case 'battleStart': {
        for (const unit of event.horde) this.spawn(unit, this.order.horde.length, -80);
        await this.layout(280);
        break;
      }
      case 'waveStart': {
        for (const unit of event.enemies) this.spawn(unit, this.order.gauntlet.length, W + 80);
        this.showBanner(`WAVE ${event.wave}`);
        await this.layout(320);
        await wait(300);
        break;
      }
      case 'clash': {
        const a = this.sprites.get(event.hordeId);
        const b = this.sprites.get(event.enemyId);
        if (!a || !b) break;
        await Promise.all([
          tween(a.root, { x: a.root.x + 18 }, 110),
          tween(b.root, { x: b.root.x - 18 }, 110),
        ]);
        await this.layout(110);
        break;
      }
      case 'damage': {
        const sprite = this.sprites.get(event.targetId);
        const s = this.stats.get(event.targetId);
        if (!sprite || !s) break;
        s.health = event.remainingHealth;
        sprite.setStats(s.attack, s.health);
        await this.floatText(sprite.root.x, sprite.root.y - 44, `-${event.amount}`, 0xd8452e);
        break;
      }
      case 'poisonTick': {
        const sprite = this.sprites.get(event.targetId);
        const s = this.stats.get(event.targetId);
        if (!sprite || !s) break;
        s.health = event.remainingHealth;
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
        await this.layout(200);
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
      case 'death': {
        const sprite = this.sprites.get(event.unitId);
        if (!sprite) break;
        await tween(sprite.root, { alpha: 0, y: GROUND_Y + 24 }, 240);
        this.app.stage.removeChild(sprite.root);
        this.sprites.delete(event.unitId);
        this.stats.delete(event.unitId);
        this.order.horde = this.order.horde.filter((id) => id !== event.unitId);
        this.order.gauntlet = this.order.gauntlet.filter((id) => id !== event.unitId);
        await this.layout(140);
        break;
      }
      case 'summon': {
        this.spawn(event.unit, event.index, event.unit.side === 'horde' ? -80 : W + 80);
        await this.layout(200);
        break;
      }
      case 'waveClear': {
        this.showBanner(`WAVE ${event.wave} CLEARED — deeper into the city`);
        await wait(650);
        break;
      }
      case 'battleEnd': {
        this.showBanner(
          `THE RIDE ENDS — DEPTH ${event.wavesCleared} · SCORE ${event.score}`,
          true
        );
        await wait(400);
        break;
      }
    }
  }

  private spawn(view: UnitView, index: number, fromX: number): void {
    const sprite = new UnitSprite(view);
    sprite.root.x = fromX;
    sprite.root.y = GROUND_Y;
    this.app.stage.addChild(sprite.root);
    this.sprites.set(view.instanceId, sprite);
    this.stats.set(view.instanceId, { attack: view.attack, health: view.health });
    this.order[view.side].splice(index, 0, view.instanceId);
  }

  private layout(ms: number): Promise<unknown> {
    const moves: Promise<void>[] = [];
    this.order.horde.forEach((id, i) => {
      const sprite = this.sprites.get(id);
      if (sprite) moves.push(tween(sprite.root, { x: W / 2 - FRONT_GAP - i * SPACING, y: GROUND_Y }, ms));
    });
    this.order.gauntlet.forEach((id, i) => {
      const sprite = this.sprites.get(id);
      if (sprite) moves.push(tween(sprite.root, { x: W / 2 + FRONT_GAP + i * SPACING, y: GROUND_Y }, ms));
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
      setTimeout(() => tween(banner, { alpha: 0 }, 400), 900);
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
    await tween(label, { y: y - 26, alpha: 0 }, 380);
    this.app.stage.removeChild(label);
  }
}
