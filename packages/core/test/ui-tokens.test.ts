// Guard for ADR-0006 (issue #167): UI surfaces come from tokens, component
// styles carry no raw hex.
//
// Why this lives in @wrad/core and not in @wrad/app: the app package has no
// test setup at all, and standing up vitest there to run two filesystem
// assertions costs more than it protects. Core already runs under vitest and
// already reads files off disk in `determinism.test.ts` (the golden-log
// fixtures), so this follows that precedent. The tradeoff is a deliberate
// upward reach across the package boundary — core does not IMPORT app code,
// it only reads its text. If @wrad/app ever grows a real test setup, move
// both this file and `sprite-ramps.test.ts` there.
//
// What this catches: a new panel, screen or state that introduces its own
// one-off brown instead of picking from (or deliberately extending) the ramp
// in app.css. That is precisely how the pre-#167 style block ended up with
// ~130 hardcoded hexes across seven near-identical darks.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const APP_SRC = path.resolve(process.cwd(), '../app/src');
const TOKENS_CSS = path.join(APP_SRC, 'app.css');

/** Every `<style>` block in every .svelte file under packages/app/src. */
function componentStyleBlocks(): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.svelte')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
          out.push({ file: path.relative(APP_SRC, full), css: m[1] });
        }
      }
    }
  };
  walk(APP_SRC);
  return out;
}

// Comments are stripped FIRST and deliberately: this codebase writes
// `issue #166` in CSS comments constantly, and `#166` is a syntactically
// valid 3-digit hex. Stripping is what makes the 3-digit form checkable at
// all — without it the guard would either miss short hexes or drown in
// false positives on every issue reference.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe('ADR-0006: UI comes from tokens', () => {
  it('finds the app sources (guards against a silently-passing empty sweep)', () => {
    const blocks = componentStyleBlocks();
    expect(fs.existsSync(TOKENS_CSS)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.css.includes('.tile'))).toBe(true);
  });

  it('has no raw hex in any component style block', () => {
    const offenders: string[] = [];
    for (const { file, css } of componentStyleBlocks()) {
      for (const line of stripComments(css).split('\n')) {
        const hits = line.match(RAW_HEX);
        if (hits) offenders.push(`${file}: ${hits.join(', ')} — in \`${line.trim()}\``);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares every token the component styles reference', () => {
    const tokens = new Set(
      [...fs.readFileSync(TOKENS_CSS, 'utf8').matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map(
        (m) => m[1],
      ),
    );
    // `--family` is the one exception, and a deliberate one: it is set as an
    // inline style per tile from `FAMILY_COLOR` in core (ADR-0005), so the
    // keyword palette has exactly one home and it is not this file.
    const inlineDeclared = new Set(['--family']);
    const missing = new Set<string>();
    for (const { css } of componentStyleBlocks()) {
      for (const m of stripComments(css).matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!tokens.has(m[1]) && !inlineDeclared.has(m[1])) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('keeps the tokens themselves in app.css, where raw hex is the point', () => {
    const css = fs.readFileSync(TOKENS_CSS, 'utf8');
    // Sanity-check the ramp is actually present rather than having been
    // emptied out — this test file is only as good as the thing it points at.
    for (const token of ['--surface', '--inset-light', '--inset-shadow', '--grain', '--vignette']) {
      expect(css, `${token} missing from app.css`).toContain(`${token}:`);
    }
  });
});
