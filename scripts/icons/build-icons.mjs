// Renders packages/app/public/icons/*.png from scripts/icons/icon.svg.
// Run from the repo root: node scripts/icons/build-icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'icon.svg'), 'utf8');
const outDir = join(here, '..', '..', 'packages', 'app', 'public', 'icons');

// Maskable variant: Android's shape mask only guarantees the center ~80% of
// the canvas, so shrink the sun and the rider into that safe zone. The sky
// and ground are full-bleed and survive any crop.
const s = 0.84;
const maskable = svg
  .replace('<g id="sky-art">', `<g id="sky-art" transform="translate(3.73 8.48) scale(${s})">`)
  .replace('<g id="fig-art"', `<g id="fig-art" transform="translate(3.73 8.48) scale(${s})"`);
if (maskable === svg) throw new Error('sky-art/fig-art markers not found in icon.svg');

const targets = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon-180.png', 180, svg],
];

for (const [name, size, source] of targets) {
  const png = new Resvg(source, {
    fitTo: { mode: 'width', value: size },
  }).render().asPng();
  writeFileSync(join(outDir, name), png);
  console.log(`${name} ${size}x${size} ${png.length} bytes`);
}
