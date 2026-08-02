// Art guard for ADR-0006 (issue #167) — the "new art" half of the token
// rule. See `docs/design/sprite-ramps.md` for the ramps themselves and for
// what each assertion here is protecting.
//
// Side-reads-as-colour (warm brown rats, cool blue-grey enemies) is the one
// part of the current visual identity that already works, and it exists by
// convention rather than by rule — which is the kind of thing that holds
// right up until the first new sprite quietly breaks it. At 40px on a phone,
// mid-replay, hue is what tells a player which line is theirs.
//
// Lives in @wrad/core for the same reason as ui-tokens.test.ts: the app
// package has no test setup, core already reads files off disk, and core
// owns the id lists this checks against. See that file's header for the
// boundary note.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { UNIT_DEFS } from '../src/data/units';
import { ENEMY_POOL } from '../src/data/enemies';

const ART_DIR = path.resolve(process.cwd(), '../app/src/replay/art');

/**
 * Sprites that deliberately fail the majority test below. The escape hatch is
 * "declare the exception", not "forbid it" — hand-drawn art needs room, and a
 * hard allowlist would have rejected Blight-Witch (mostly purple),
 * Plague-Bearer (mostly green) and Steel-Whisker (half steel) too.
 *
 * Checked in BOTH directions: an entry whose sprite has stopped needing it
 * fails the test as loudly as an undeclared outlier, so this list cannot rot
 * into a permanent mute button.
 */
const DECLARED_OUTLIERS: Record<string, string> = {
  'dusk-runt':
    'Cold moonlight is the entire unit; its twin dawn-runt carries the warm half of the pair.',
  'draughtsman-moe':
    'Prestige reskin of Blight-Witch (issue #115) with an owner-specced blue coat — the inherited purple/green blight palette leaves no warm majority.',
};

const RAT_IDS = Object.keys(UNIT_DEFS);
const ENEMY_IDS = ENEMY_POOL.map((e) => e.id);

const hexesIn = (svg: string) => [...new Set(svg.match(/#[0-9a-fA-F]{6}\b/g) ?? [])];

function hsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
}

// Colours too desaturated to read as a hue at all (outlines, greys, the
// near-whites) are neither warm nor cool and count for neither side.
const CHROMA_FLOOR = 0.12;

type Bucket = 'warm' | 'cool' | null;

function bucket(hex: string): Bucket {
  const { h, s } = hsl(hex);
  if (s < CHROMA_FLOOR) return null;
  if (h <= 60 || h >= 330) return 'warm';
  if (h >= 180 && h <= 260) return 'cool';
  return null; // greens, purples — deliberately unbucketed, see the doc
}

function tally(svg: string) {
  let warm = 0;
  let cool = 0;
  for (const hex of hexesIn(svg)) {
    const b = bucket(hex);
    if (b === 'warm') warm++;
    else if (b === 'cool') cool++;
  }
  return { warm, cool };
}

const read = (id: string) => fs.readFileSync(path.join(ART_DIR, `${id}.svg`), 'utf8');

describe('sprite ramps', () => {
  it('has a sprite for every rat and every enemy', () => {
    const files = new Set(fs.readdirSync(ART_DIR).map((f) => f.replace(/\.svg$/, '')));
    const missing = [...RAT_IDS, ...ENEMY_IDS].filter((id) => !files.has(id));
    expect(missing).toEqual([]);
  });

  it('uses no pure black or pure white', () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(ART_DIR)) {
      const pure = hexesIn(fs.readFileSync(path.join(ART_DIR, file), 'utf8')).filter((h) =>
        /^#(000000|ffffff)$/i.test(h),
      );
      // The 3-digit forms are just as flat and just as easy to reach for.
      const short = fs
        .readFileSync(path.join(ART_DIR, file), 'utf8')
        .match(/#(000|fff)\b/gi);
      if (pure.length || short) offenders.push(`${file}: ${[...pure, ...(short ?? [])].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps rats on the warm ramp', () => {
    const offenders = RAT_IDS.filter((id) => {
      if (id in DECLARED_OUTLIERS) return false;
      const { warm, cool } = tally(read(id));
      return warm < cool;
    });
    expect(offenders).toEqual([]);
  });

  it('keeps enemies on the cool ramp', () => {
    const offenders = ENEMY_IDS.filter((id) => {
      if (id in DECLARED_OUTLIERS) return false;
      const { cool, warm } = tally(read(id));
      return cool < warm;
    });
    expect(offenders).toEqual([]);
  });

  // The other half of the escape hatch. Without this an outlier entry outlives
  // the art that justified it, and the next person reads the list as gospel.
  it('has no stale entry in the declared-outlier list', () => {
    const stale = Object.keys(DECLARED_OUTLIERS).filter((id) => {
      const { warm, cool } = tally(read(id));
      return ENEMY_IDS.includes(id) ? cool >= warm : warm >= cool;
    });
    expect(stale).toEqual([]);
  });

  it('gives every declared outlier a reason', () => {
    for (const [id, why] of Object.entries(DECLARED_OUTLIERS)) {
      expect(fs.existsSync(path.join(ART_DIR, `${id}.svg`)), `${id} has no sprite`).toBe(true);
      expect(why.length, `${id} needs a real reason`).toBeGreaterThan(30);
    }
  });
});
