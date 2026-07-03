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
 */
export function currentRideDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 6 * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}
