export interface Rng {
  /** Next unsigned 32-bit integer. */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/**
 * xorshift128 seeded via splitmix32 so a single 32-bit seed fills the
 * 128-bit state. All sim/gauntlet randomness must come from here —
 * never Math.random or wall-clock.
 *
 * Why this matters beyond "tests should pass": every client must derive the
 * *exact same* Gauntlet and Battle outcomes from the same seed with zero
 * server round-trip — that's what makes a fixed weekly Gauntlet and a
 * client-computed leaderboard score possible at all. `determinism.test.ts`'s
 * golden-log hashes exist to catch any change (intentional or not) to this
 * output. If a golden-log test fails after a code change, treat it as a
 * signal to verify the new behavior is actually correct before regenerating
 * the snapshot — a snapshot update is how a real balance/logic regression
 * would silently become "expected."
 */
export function xorshift128(seed: number): Rng {
  const mix = splitmix32(seed);
  let x = mix();
  let y = mix();
  let z = mix();
  let w = mix();

  const next = (): number => {
    const t = (x ^ (x << 11)) >>> 0;
    x = y;
    y = z;
    z = w;
    w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };

  return {
    next,
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return next() % maxExclusive;
    },
  };
}

function splitmix32(a: number): () => number {
  a |= 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}
