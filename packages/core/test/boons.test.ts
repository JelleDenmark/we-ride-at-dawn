import { describe, expect, it } from 'vitest';
import { boonsFor, isBoonOffered, BOON_DEFS, BOONS_PER_DAY, BOON_FIRST_DATE } from '../src/boons';
import { weekdayFor } from '../src/shop';

/** Consecutive ride-dates walking forward from a given one. */
const daysFrom = (start: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

// Anchored on BOON_FIRST_DATE rather than a literal, so these stay valid when
// the launch switch moves off its dormant sentinel.
const DAYS = daysFrom(BOON_FIRST_DATE, 120);

describe('boonsFor', () => {
  it('is a pure function of the ride-date', () => {
    for (const d of DAYS.slice(0, 10)) {
      expect(boonsFor(d)).toEqual(boonsFor(d));
    }
  });

  it('offers nothing before BOON_FIRST_DATE', () => {
    // The feature is dormant by construction, not by a flag someone can
    // forget: phase 1 ships the pool with no effects wired, so a day that
    // offered cards would be offering three no-ops.
    for (const d of ['2026-08-10', '2026-08-17', '2027-01-01']) {
      if (d >= BOON_FIRST_DATE) continue;
      expect(boonsFor(d)).toEqual([]);
    }
    expect(boonsFor(BOON_FIRST_DATE)).toHaveLength(BOONS_PER_DAY);
  });

  it('offers exactly three distinct boons', () => {
    for (const d of DAYS) {
      const offer = boonsFor(d);
      expect(offer).toHaveLength(BOONS_PER_DAY);
      expect(new Set(offer.map((b) => b.id)).size).toBe(BOONS_PER_DAY);
    }
  });

  it('offers only real pool entries', () => {
    const ids = new Set(Object.keys(BOON_DEFS));
    for (const d of DAYS) {
      for (const b of boonsFor(d)) expect(ids.has(b.id)).toBe(true);
    }
  });

  it('draws every boon in the pool over a run of days', () => {
    // Guards a dead entry: a boon that never rolls is content that silently
    // does not exist. Same guard anomaly.test.ts runs over seasons.
    const drawn = new Set(DAYS.flatMap((d) => boonsFor(d).map((b) => b.id)));
    expect(drawn).toEqual(new Set(Object.keys(BOON_DEFS)));
  });

  it('never repeats a boon on consecutive days within a season', () => {
    // An independent daily draw clusters harder than it reads: the launch week
    // as first derived put Silence — the strongest entry, and the one with no
    // magnitude knob — on three consecutive dawns. Same card three days
    // running is not a rotation.
    for (let i = 1; i < DAYS.length; i++) {
      if (weekdayFor(DAYS[i]) === 1) continue; // the chain is cut at each season boundary
      const today = boonsFor(DAYS[i]).map((b) => b.id);
      const yesterday = new Set(boonsFor(DAYS[i - 1]).map((b) => b.id));
      const repeated = today.filter((id) => yesterday.has(id));
      expect(repeated, `${DAYS[i - 1]} -> ${DAYS[i]}`).toEqual([]);
    }
  });

  it('cuts the no-repeat chain at the season boundary', () => {
    // The cut is what bounds the recursion: if a Monday excluded Sunday's
    // offer too, the chain would walk back to BOON_FIRST_DATE and grow a level
    // longer every day the calendar advances. Observable as Sunday->Monday
    // being the one adjacent pair allowed to repeat — so at least one boundary
    // in a long run must actually do it.
    const year = daysFrom(BOON_FIRST_DATE, 365);
    const boundaryRepeats = year.filter((d, i) => {
      if (i === 0 || weekdayFor(d) !== 1) return false;
      const yesterday = new Set(boonsFor(year[i - 1]).map((b) => b.id));
      return boonsFor(d).some((b) => yesterday.has(b.id));
    });
    expect(boundaryRepeats.length).toBeGreaterThan(0);
  });

  it('stays bounded however far out the date is', () => {
    // A guard on the recursion depth rather than on the offer: the chain is
    // cut weekly, so a date decades out costs the same six levels as day 7 of
    // launch week. An unbounded version would overflow the stack here.
    expect(boonsFor('2099-12-31')).toHaveLength(BOONS_PER_DAY);
  });

  it('does not lean hard on any one boon', () => {
    // Not a uniformity proof — just a canary for a derivation bug that
    // starves or floods an entry. An even split is BOONS_PER_DAY / pool size
    // of days (currently ~21% at 14 entries, was 33% at 9); the 15-50% band
    // is loose on purpose so this doesn't need re-tuning every time the pool
    // grows — it just needs to catch the shuffle being actually wrong, not
    // the rng being unlucky.
    const days = DAYS.length;
    for (const id of Object.keys(BOON_DEFS)) {
      const share = DAYS.filter((d) => boonsFor(d).some((b) => b.id === id)).length / days;
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.5);
    }
  });
});

describe('BOON_DEFS', () => {
  it('keys every entry by its own id', () => {
    for (const [key, def] of Object.entries(BOON_DEFS)) expect(def.id).toBe(key);
  });

  it('gives every boon a blurb that states its mechanic', () => {
    for (const def of Object.values(BOON_DEFS)) {
      expect(def.name.length).toBeGreaterThan(0);
      // The blurb is the only player-facing explanation a boon ever gets, so
      // it has to be a real sentence rather than a label.
      expect(def.blurb.trim().endsWith('.')).toBe(true);
      expect(def.blurb.split(' ').length).toBeGreaterThan(5);
    }
  });

  it('keeps magnitudes out of the copy', () => {
    // Every number in this module is a placeholder until the pvp:boons pass.
    // Copy that hardcodes one goes stale silently when the number moves.
    for (const def of Object.values(BOON_DEFS)) {
      expect(def.blurb).not.toMatch(/\d/);
    }
  });
});

describe('isBoonOffered', () => {
  it('accepts a boon that is on the day menu', () => {
    for (const d of DAYS.slice(0, 20)) {
      for (const b of boonsFor(d)) expect(isBoonOffered(d, b.id)).toBe(true);
    }
  });

  it('rejects a real boon that is not on the day menu', () => {
    // The whole server-side authority over a submitted pick: an edited client
    // must not be able to field a boon it was never offered.
    for (const d of DAYS.slice(0, 20)) {
      const offered = new Set(boonsFor(d).map((b) => b.id));
      const absent = Object.keys(BOON_DEFS).filter((id) => !offered.has(id));
      expect(absent.length).toBeGreaterThan(0);
      for (const id of absent) expect(isBoonOffered(d, id)).toBe(false);
    }
  });

  it('rejects an id that is not a boon at all', () => {
    expect(isBoonOffered(BOON_FIRST_DATE, 'not-a-boon')).toBe(false);
    expect(isBoonOffered(BOON_FIRST_DATE, '')).toBe(false);
  });

  it('treats no pick as legal', () => {
    // Not picking is a valid state and means no boon, never an auto-pick.
    expect(isBoonOffered(BOON_FIRST_DATE, null)).toBe(true);
    expect(isBoonOffered(BOON_FIRST_DATE, undefined)).toBe(true);
  });

  it('rejects every boon on a day that offers none', () => {
    const dormant = '2026-08-17';
    if (dormant < BOON_FIRST_DATE) {
      for (const id of Object.keys(BOON_DEFS)) expect(isBoonOffered(dormant, id)).toBe(false);
    }
  });
});
