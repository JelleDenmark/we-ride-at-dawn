/** FNV-1a 32-bit — fixed hash so every client derives the same daily seed. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailySeed(date: string): number {
  return fnv1a(date);
}

/**
 * The ride-day for a given instant: days flip at 06:00 in Europe/Copenhagen
 * (the "dawn" boundary), so 05:59 still belongs to yesterday's ride.
 *
 * This string is the seed key for the shop, the gauntlet, and the season, so
 * every client on the same real day MUST derive byte-identical output — a
 * one-character difference hashes (via fnv1a) to a completely different seed
 * and hands two players different games. We therefore do NOT trust a locale's
 * formatted string: `Intl.DateTimeFormat.format()` output is not guaranteed
 * identical across JS engines (V8 on Android Chrome vs JavaScriptCore on iOS
 * Safari / iOS WebViews have differed in separators, digit ordering, and
 * embedded bidi/whitespace marks for the same locale + options). That
 * divergence is exactly the iOS-weak-shop / Android-strong-shop bug.
 *
 * `formatToParts` instead hands back the raw numeric year/month/day, so we
 * control the exact byte layout ourselves. The timezone + DST math still comes
 * from Intl (reliable and the genuinely hard part); only the string assembly
 * is ours. `numberingSystem: 'latn'` pins Western-Arabic digits, and the
 * explicit padStart guards against any engine returning an unpadded field.
 */
export function currentRideDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 6 * 3_600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = part('year').padStart(4, '0');
  const month = part('month').padStart(2, '0');
  const day = part('day').padStart(2, '0');
  return `${year}-${month}-${day}`;
}
