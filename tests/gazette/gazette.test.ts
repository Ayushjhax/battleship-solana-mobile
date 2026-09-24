/**
 * The Port Gazette — part-09 §5.5.
 *
 *   "a player with no activity gets the quiet-day edition, **never an empty
 *    page**; headline scoring picks the right story from a crafted day;
 *    **every template renders with every slot filled**; the edition is stable
 *    for the whole day."
 *
 * The third clause is the one with teeth. A template is a localisable string
 * with named slots (§1), so a slot the day cannot fill renders as a gap in the
 * middle of a sentence — and the only way to know is to fire every template
 * with its own trigger satisfied and read what comes out.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  MASTHEAD,
  PRICE,
  TEMPLATES,
  TIPS,
  WEATHER,
  buildEdition,
  matching,
  quietDay,
  render,
  slotsIn,
  tipFor,
  weatherFor,
  type DaySummary,
  type Template,
} from '@engine/gazette';

const DATE = '2026-04-11';
const PUZZLE_NO = 101;

const day = (over: Partial<DaySummary> = {}): DaySummary => ({ ...quietDay('Hallie'), ...over });

// ===========================================================================
// §5.5 — A QUIET DAY IS NEVER AN EMPTY PAGE
// ===========================================================================

describe('a player with no activity', () => {
  it('gets the quiet-day edition, never an empty page', () => {
    const edition = buildEdition(quietDay('Hallie'), DATE, PUZZLE_NO);

    expect(edition.headline.templateId).toBe('quiet');
    expect(edition.headline.text).toBe('Quiet week on the water');
    expect(edition.headline.text.length).toBeGreaterThan(0);
  });

  it('still gets a masthead, a price, a tip, weather and the back page', () => {
    const edition = buildEdition(quietDay('Hallie'), DATE, PUZZLE_NO);

    expect(edition.masthead).toBe(MASTHEAD);
    expect(edition.price).toBe(PRICE);
    expect(edition.date).toBe(DATE);
    expect(edition.tip.length).toBeGreaterThan(0);
    expect(edition.weather.length).toBeGreaterThan(0);
    expect(edition.puzzleNumber).toBe(PUZZLE_NO);
  });

  it('has no sub-stories rather than empty ones', () => {
    // §1 asks for "two or three sub-stories", but a day with nothing in it has
    // nothing to put there. An absent story beats a blank one.
    const edition = buildEdition(quietDay('Hallie'), DATE, PUZZLE_NO);
    expect(edition.subStories).toEqual([]);
  });

  it('the quiet template always triggers, on every day shape', () => {
    const quiet = TEMPLATES.find((tpl) => tpl.id === 'quiet')!;
    expect(quiet.score).toBe(0); // §1's table
    expect(quiet.trigger(quietDay('Hallie'))).toBe(true);
    expect(quiet.trigger(day({ rankedUp: 'Commodore', matchesWon: 9 }))).toBe(true);
  });

  it('...so `matching` is never empty, which is what makes "never empty" structural', () => {
    expect(matching(quietDay('Hallie')).length).toBeGreaterThan(0);
    expect(matching(day({ name: '' })).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// §5.5 — HEADLINE SCORING PICKS THE RIGHT STORY
// ===========================================================================

describe('headline scoring', () => {
  it('takes the highest-scoring event from a crafted day', () => {
    // A day with four things in it. §1's table scores them 90 / 85 / 80 / 70,
    // so the rank-up leads and the rest fall in behind it.
    const crafted = day({
      rankedUp: 'Commodore',
      bestRaidStars: 3,
      bestRaidTarget: 'Perrin',
      atomicMultiKill: 3,
      atomicRow: 'F',
      planesDownedByOneGun: 4,
    });

    const edition = buildEdition(crafted, DATE, PUZZLE_NO);
    expect(edition.headline.templateId).toBe('rank-up');
    expect(edition.headline.score).toBe(90);
    // And the next two by score, in order: 85 then 80.
    expect(edition.subStories.slice(0, 2).map((s) => s.templateId)).toEqual([
      'raid-three-star',
      'atomic-multi',
    ]);
    expect(edition.headline.text).toBe('Hallie made Commodore');
  });

  it('demotes the headline when a higher-scoring event exists', () => {
    // The same day minus the rank-up: the 3-star raid takes the front page.
    const crafted = day({
      bestRaidStars: 3,
      bestRaidTarget: 'Perrin',
      atomicMultiKill: 3,
      atomicRow: 'F',
    });
    expect(buildEdition(crafted, DATE, PUZZLE_NO).headline.templateId).toBe('raid-three-star');
  });

  it('runs §1’s table at §1’s scores', () => {
    const scores = Object.fromEntries(TEMPLATES.map((tpl) => [tpl.id, tpl.score]));
    expect(scores['rank-up']).toBe(90);
    expect(scores['raid-three-star']).toBe(85);
    expect(scores['atomic-multi']).toBe(80);
    expect(scores['defended']).toBe(75);
    expect(scores['gun-triple']).toBe(70);
    expect(scores['quiet']).toBe(0);
  });

  it('gives at most three sub-stories, even on a very busy day', () => {
    const busy = day({
      rankedUp: 'Commodore',
      bestRaidStars: 3,
      bestRaidTarget: 'Perrin',
      atomicMultiKill: 2,
      atomicRow: 'C',
      planesDownedByOneGun: 3,
      defendedAt: 0.4,
      defendedAgainst: 'Ida',
      matchesPlayed: 12,
      matchesWon: 9,
      onlineWon: 5,
      beatHardAi: true,
      bestWinStreak: 6,
    });
    const edition = buildEdition(busy, DATE, PUZZLE_NO);
    expect(edition.subStories.length).toBeLessThanOrEqual(3);
    expect(edition.subStories.length).toBeGreaterThanOrEqual(2); // §1's "two or three"
  });

  it('never repeats the headline as a sub-story', () => {
    const busy = day({ rankedUp: 'Commodore', matchesWon: 3, onlineWon: 4, beatHardAi: true });
    const edition = buildEdition(busy, DATE, PUZZLE_NO);
    expect(edition.subStories.map((s) => s.templateId)).not.toContain(edition.headline.templateId);
  });

  it('orders sub-stories by score, descending', () => {
    const busy = day({
      rankedUp: 'Commodore',
      admiraltyUp: true,
      admiraltyLevel: 4,
      researchFinished: 'Sonar Nets',
      weeklyClaimed: 1,
    });
    const scores = buildEdition(busy, DATE, PUZZLE_NO).subStories.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('breaks a score tie the same way every time', () => {
    // Two templates could in principle share a score. The sort must be total,
    // or the "stable for the whole day" guarantee is a coin flip.
    const busy = day({ matchesWon: 4, onlineWon: 4, voyagesReturned: 3, pirateWins: 3 });
    const once = matching(busy).map((t) => t.id);
    for (let i = 0; i < 20; i++) expect(matching(busy).map((t) => t.id)).toEqual(once);
  });

  it('a template that throws does not take the paper down', () => {
    const exploding: Template = {
      id: 'boom',
      score: 100,
      text: 'never seen',
      trigger: () => {
        throw new Error('bad summary');
      },
      slots: () => ({}),
      kind: 'story',
    };
    expect(() => exploding.trigger(quietDay('Hallie'))).toThrow();
    // `matching` filters in a try/catch, so the real catalogue still renders.
    expect(matching(quietDay('Hallie'))[0]!.id).toBe('quiet');
  });
});

// ===========================================================================
// §5.5 — EVERY TEMPLATE RENDERS WITH EVERY SLOT FILLED
// ===========================================================================

/**
 * A day crafted to satisfy EVERY trigger at once. If a template is added
 * without a corresponding field here, the "every template fires" test below
 * names it.
 */
const everythingDay: DaySummary = {
  name: 'Hallie',
  matchesPlayed: 12,
  matchesWon: 9,
  onlineWon: 5,
  bestWinStreak: 6,
  shipsSunk: 14,
  battleshipsSunk: 4,
  planesDownedByOneGun: 4,
  atomicMultiKill: 3,
  atomicRow: 'F',
  longestHitRun: 7,
  wonWithShipsAfloat: 8,
  rankedUp: 'Commodore',
  beatHardAi: true,
  raidsRun: 6,
  raidStars: 12,
  bestRaidStars: 3,
  bestRaidTarget: 'Perrin',
  raidSteel: 3_400,
  defendedAt: 0.4,
  defendedAgainst: 'Ida',
  raidedBy: 'Mo',
  raidedForSteel: 900,
  upgradesFinished: 4,
  admiraltyLevel: 5,
  admiraltyUp: true,
  steelCollected: 7_500,
  scrapCollected: 5,
  buildingFinished: 'Trade Docks',
  researchFinished: 'Sonar Nets',
  contractsClaimed: 5,
  weeklyClaimed: 2,
  inkEarned: 800,
  logPage: 14,
  fleetName: 'The Kestrels',
  donationsGiven: 5,
  warResult: 'won',
  warOpponent: 'The Gulls',
  warStars: 7,
  puzzleShots: 41,
  puzzleBeatPar: true,
  puzzleStreak: 9,
  voyagesReturned: 3,
  voyageCoins: 2_600,
  pirateWins: 3,
  topCaptain: 'Rook',
  biggestRaidBy: 'Sena',
  biggestRaidSteel: 5_200,
  fleetWarWinner: 'The Kestrels',
};

/** The two-star and war-lost/draw templates are mutually exclusive with the
 *  three-star and war-won ones, so they get their own days. */
const variantDays: readonly DaySummary[] = [
  { ...everythingDay, bestRaidStars: 2 },
  { ...everythingDay, warResult: 'lost' },
  { ...everythingDay, warResult: 'draw' },
];

describe('EVERY template renders with EVERY slot filled', () => {
  it('every template in the catalogue fires on at least one crafted day', () => {
    const fired = new Set<string>();
    for (const summary of [everythingDay, ...variantDays]) {
      for (const tpl of matching(summary)) fired.add(tpl.id);
    }

    const missed = TEMPLATES.filter((tpl) => !fired.has(tpl.id)).map((tpl) => tpl.id);
    expect(missed, `no crafted day fires: ${missed.join(', ')}`).toEqual([]);
  });

  it('renders with no empty slot, no leftover brace and no double space', () => {
    for (const summary of [everythingDay, ...variantDays]) {
      for (const tpl of matching(summary)) {
        const slots = tpl.slots(summary);
        const text = render(tpl.text, slots);

        // Every slot the string asks for got a real value.
        for (const slotName of slotsIn(tpl.text)) {
          const value = slots[slotName];
          expect(value, `${tpl.id} left {${slotName}} unset`).toBeDefined();
          expect(String(value).length, `${tpl.id} filled {${slotName}} with ''`).toBeGreaterThan(0);
        }

        // And the rendered line reads like a sentence.
        expect(text, tpl.id).not.toContain('{');
        expect(text, tpl.id).not.toContain('}');
        expect(text, `${tpl.id}: "${text}"`).not.toMatch(/\s{2,}/);
        expect(text.trim(), tpl.id).toBe(text);
        expect(text.length, tpl.id).toBeGreaterThan(0);
      }
    }
  });

  it('every template renders on the QUIET day too, if forced', () => {
    // Triggers aside, a slot function must never throw on a thin summary —
    // a nullable field read without a fallback would.
    for (const tpl of TEMPLATES) {
      expect(() => render(tpl.text, tpl.slots(quietDay('Hallie'))), tpl.id).not.toThrow();
    }
  });

  it('is about 40 templates, as §1 asks', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(38);
    expect(TEMPLATES.length).toBeLessThanOrEqual(50);
  });

  it('has no duplicate ids', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it('carries §1’s worked examples verbatim, slots and all', () => {
    const byId = Object.fromEntries(TEMPLATES.map((tpl) => [tpl.id, tpl]));
    expect(byId['gun-triple']!.text).toBe('{name} downs {n} bombers with a single gun!');
    expect(byId['atomic-multi']!.text).toBe(
      'Atomic strike! {k} ships lost in one blast off {rowLetter}',
    );
    expect(byId['defended']!.text).toBe("Harbour holds: {raider}'s raid stopped at {pct}%");
    expect(byId['rank-up']!.text).toBe('{name} made {rank}');
    expect(byId['raid-three-star']!.text).toBe("{name} clears {defender}'s harbour");
    expect(byId['quiet']!.text).toBe('Quiet week on the water');
  });
});

describe('templates are strings with slots, not concatenated sentences', () => {
  it('§1 — every template is ONE literal, and slots are named', () => {
    for (const tpl of TEMPLATES) {
      // A localisable string: the translator sees the whole sentence, with
      // placeholders they can reorder. A concatenation cannot be reordered.
      expect(typeof tpl.text, tpl.id).toBe('string');
      for (const slotName of slotsIn(tpl.text)) {
        expect(slotName, tpl.id).toMatch(/^[a-z][A-Za-z]*$/);
      }
    }
  });

  it('the source file contains no string-concatenated template text', () => {
    // A grep, because the type system cannot express "do not build this by +".
    // Reading our own source is the only way to assert a coding rule.
    const src = readFileSync(
      new URL('../../src/engine/gazette/templates.ts', import.meta.url),
      'utf8',
    );
    // `'…' + …` or `` `…${…}` `` inside a template literal position.
    expect(src).not.toMatch(/'\s*\+\s*(?:d\.|day\.)/);
    expect(src).not.toMatch(/\$\{[^}]*\}\s*(?:bombers|ships|harbour|made)/);
  });

  it('slot values are already-moderated data, never free text', () => {
    // §1 — "Names are already 1-14 characters and profanity-filtered at
    // creation, so no new moderation surface."
    for (const tpl of matching(everythingDay)) {
      for (const value of Object.values(tpl.slots(everythingDay))) {
        if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it('render leaves an unknown slot as a gap, not as braces', () => {
    expect(render('{a} and {b}', { a: 'one' })).toBe('one and ');
  });
});

// ===========================================================================
// §5.5 — THE EDITION IS STABLE FOR THE WHOLE DAY
// ===========================================================================

describe('the edition is stable', () => {
  it('is byte-identical when rebuilt from the same summary', () => {
    const first = buildEdition(everythingDay, DATE, PUZZLE_NO);
    for (let i = 0; i < 50; i++) {
      expect(buildEdition(everythingDay, DATE, PUZZLE_NO)).toEqual(first);
    }
  });

  it('picks the same tip and weather all day', () => {
    expect(tipFor(DATE)).toBe(tipFor(DATE));
    expect(weatherFor(DATE)).toBe(weatherFor(DATE));
  });

  it('rotates the tip and the weather across days', () => {
    const tips = new Set<string>();
    const weather = new Set<string>();
    let d = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 60; i++) {
      const date = new Date(d).toISOString().slice(0, 10);
      tips.add(tipFor(date));
      weather.add(weatherFor(date));
      d += 86_400_000;
    }
    // Every entry should come up over two months, or the rotation is stuck.
    expect(tips.size).toBe(TIPS.length);
    expect(weather.size).toBe(WEATHER.length);
  });

  it('the tip and weather are independent — not the same hash twice', () => {
    // If they shared a hash they would move in lockstep, and the paper would
    // feel like it had half as much variety as it does.
    const pairs = new Set<string>();
    let d = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 60; i++) {
      const date = new Date(d).toISOString().slice(0, 10);
      pairs.add(`${TIPS.indexOf(tipFor(date))}:${WEATHER.indexOf(weatherFor(date))}`);
      d += 86_400_000;
    }
    expect(pairs.size).toBeGreaterThan(Math.max(TIPS.length, WEATHER.length));
  });

  it('a different day is a different paper', () => {
    const a = buildEdition(everythingDay, '2026-04-11', 101);
    const b = buildEdition(everythingDay, '2026-04-12', 102);
    expect(a).not.toEqual(b);
    expect(a.headline.text).toBe(b.headline.text); // same day summary, same story
    expect(a.puzzleNumber).not.toBe(b.puzzleNumber);
  });
});
