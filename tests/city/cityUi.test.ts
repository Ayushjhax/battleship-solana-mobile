/**
 * The rest of part-02 §11: Captain copy (§11.5), the tour (§11.6), reduced
 * motion (§11.8), the building art, and the performance budgets from §9/§10
 * that can be asserted without a renderer.
 */
import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, CITY_CATALOGUE, type BuildingId } from '@engine/city';

import { BUILDING_FLAVOUR, captainLineFor, effectLabel } from '@/city/ui/captainCopy';
import {
  HATCH_START,
  buildingArt,
  nibAt,
  seedOf,
  strokeReveal,
} from '@/city/ui/buildingArt';
import {
  AMBIENT_NODE_BUDGET,
  AMBIENT_NODE_LIMIT,
  MAX_TICKING_PLOTS,
  runningJobCount,
} from '@/city/ui/budgets';
import { TOUR_BEATS, TOUR_LENGTH, advance, beatSatisfied, isFinished } from '@/city/ui/tourScript';
import type { CityApiErrorCode } from '@/city/types';

// ---------------------------------------------------------------------------
// §11.5 — every typed error maps to a Captain line, no code reaches the player
// ---------------------------------------------------------------------------

const ALL_CODES: CityApiErrorCode[] = [
  'feature-off',
  'unknown-building',
  'max-level',
  'already-upgrading',
  'no-free-worker',
  'needs-admiralty',
  'not-enough-steel',
  'not-enough-coins',
  'not-enough-gems',
  'not-upgrading',
  'nothing-to-collect',
  'rate-limited',
  'version-conflict',
  'no-profile',
  'internal',
  'offline',
  'unauthenticated',
];

describe('Captain copy (§11.5)', () => {
  it('has a line for every code Part 1 can produce', () => {
    for (const code of ALL_CODES) {
      const line = captainLineFor(code);
      expect(line, code).toBeTruthy();
      expect(line.length, code).toBeGreaterThan(8);
    }
  });

  it('never leaks the raw code into the line', () => {
    for (const code of ALL_CODES) {
      expect(captainLineFor(code).toLowerCase(), code).not.toContain(code.toLowerCase());
      // Nor a hyphenated slug of any kind.
      expect(captainLineFor(code)).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    }
  });

  it('reads like a person, ending in punctuation', () => {
    for (const code of ALL_CODES) {
      expect(captainLineFor(code).trim(), code).toMatch(/[.!?]$/);
    }
  });

  it('fills in the numbers it is given', () => {
    expect(captainLineFor('not-enough-steel', { shortSteel: 380 })).toBe('380 steel short.');
    expect(captainLineFor('needs-admiralty', { requiredAdmiralty: 3 })).toBe(
      'Upgrade the Admiralty to 3 first.',
    );
    expect(captainLineFor('no-free-worker', { nextWorkerFreeIn: 720 })).toContain('12 minutes');
  });

  it('degrades gracefully with no context at all', () => {
    expect(captainLineFor('not-enough-steel')).toBe('Not enough steel for that.');
    expect(captainLineFor('no-free-worker')).toContain('shortly');
  });

  it('has flavour for every building', () => {
    for (const id of BUILDING_IDS) {
      expect(BUILDING_FLAVOUR[id], id).toBeTruthy();
    }
  });

  it('labels effects in each building own units', () => {
    expect(effectLabel('fish_market', 1)).toBe('12 coins/h');
    expect(effectLabel('foundry', 1)).toBe('20 steel/h');
    expect(effectLabel('scrapyard', 2)).toBe('salvage +5%');
    expect(effectLabel('coastal_command', 1)).toBe('harbour fuel 50');
    expect(effectLabel('fish_market', 0)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// §4 — the drawing system
// ---------------------------------------------------------------------------

describe('procedural building art (§4)', () => {
  it('is stable: the same building draws identically every call', () => {
    for (const id of BUILDING_IDS) {
      const a = buildingArt(id, 2);
      const b = buildingArt(id, 2);
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b));
    }
  });

  it('seeds from the buildingId, so two buildings differ', () => {
    expect(seedOf('plot-admiralty')).not.toBe(seedOf('plot-foundry'));
    expect(seedOf('plot-admiralty')).toBe(seedOf('plot-admiralty'));
  });

  it('a higher tier is the same silhouette PLUS strokes, never fewer', () => {
    for (const id of BUILDING_IDS) {
      const counts = ([1, 2, 3, 4] as const).map((t) => buildingArt(id, t).strokes.length);
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i], `${id} tier ${i + 1}`).toBeGreaterThanOrEqual(counts[i - 1] ?? 0);
      }
      // The footprint is always the first stroke, at every tier.
      for (const tier of [1, 2, 3, 4] as const) {
        expect(buildingArt(id, tier).strokes[0]?.kind, id).toBe('footprint');
      }
    }
  });

  it('draws in order: footprint, roof, details, hatching last', () => {
    const art = buildingArt('admiralty', 4);
    const kinds = art.strokes.map((s) => s.kind);
    const lastNonHatch = kinds.map((k) => k !== 'hatch').lastIndexOf(true);
    const firstHatch = kinds.indexOf('hatch');
    if (firstHatch !== -1) expect(firstHatch).toBeGreaterThan(lastNonHatch - 1);
    expect(kinds[0]).toBe('footprint');
    expect(kinds[1]).toBe('roof');
  });

  it('reveals nothing at p=0 and everything at p=1', () => {
    const art = buildingArt('fish_market', 1);
    const none = strokeReveal(art, 0);
    const all = strokeReveal(art, 1);
    expect(none.every((n) => n === 0)).toBe(true);
    expect(all.every((n) => n >= 1)).toBe(true);
  });

  it('holds hatching back until p > 0.85 (§4)', () => {
    const art = buildingArt('foundry', 3);
    const hatchIndexes = art.strokes
      .map((s, i) => (s.kind === 'hatch' ? i : -1))
      .filter((i) => i >= 0);
    expect(hatchIndexes.length).toBeGreaterThan(0);

    const justBefore = strokeReveal(art, HATCH_START - 0.01);
    for (const index of hatchIndexes) expect(justBefore[index]).toBe(0);

    const atEnd = strokeReveal(art, 1);
    expect(atEnd[hatchIndexes[0] as number]).toBeGreaterThan(0);
  });

  it('reveals monotonically — the pen never un-draws', () => {
    const art = buildingArt('admiralty', 2);
    let previousSum = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const sum = strokeReveal(art, p).reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(previousSum);
      previousSum = sum;
    }
  });

  it('clamps p outside 0..1 rather than throwing', () => {
    const art = buildingArt('fish_market', 1);
    expect(() => strokeReveal(art, -5)).not.toThrow();
    expect(() => strokeReveal(art, 5)).not.toThrow();
    expect(strokeReveal(art, -5).every((n) => n === 0)).toBe(true);
  });

  it('puts the nib on the drawing while building, and nowhere when idle', () => {
    const art = buildingArt('fish_market', 1);
    expect(nibAt(art, 0)).toBeNull();
    expect(nibAt(art, 1)).toBeNull();
    const at = nibAt(art, 0.4);
    expect(at).not.toBeNull();
    if (at) {
      expect(at.x).toBeGreaterThanOrEqual(-0.2);
      expect(at.x).toBeLessThanOrEqual(1.2);
      expect(at.y).toBeGreaterThanOrEqual(-0.4);
      expect(at.y).toBeLessThanOrEqual(1.2);
    }
  });

  it('covers every building in the catalogue', () => {
    for (const id of BUILDING_IDS) {
      const art = buildingArt(id as BuildingId, 1);
      expect(art.strokes.length, id).toBeGreaterThan(2);
      expect(art.totalLength, id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// §11.6 — the tour
// ---------------------------------------------------------------------------

describe('the Captain tour (§11.6)', () => {
  it('is the six beats the design asks for', () => {
    expect(TOUR_LENGTH).toBe(6);
    expect(TOUR_BEATS[0]?.say).toContain('Welcome to your port');
    expect(TOUR_BEATS[5]?.say).toContain('Raise the Admiralty');
  });

  it('spotlights plots by id, never by coordinate', () => {
    for (const beat of TOUR_BEATS) {
      if (!beat.spotlight) continue;
      expect(BUILDING_IDS, beat.id).toContain(beat.spotlight);
    }
  });

  it('advances only on the action the beat asked for', () => {
    const collect = TOUR_BEATS[1];
    expect(collect).toBeDefined();
    if (!collect) return;
    expect(beatSatisfied(collect, { kind: 'collect', buildingId: 'scrapyard' })).toBe(true);
    expect(beatSatisfied(collect, { kind: 'collect', buildingId: 'fish_market' })).toBe(false);
    expect(beatSatisfied(collect, { kind: 'build', buildingId: 'scrapyard' })).toBe(false);
    expect(beatSatisfied(collect, { kind: 'acknowledge' })).toBe(false);
  });

  it('runs to the end and then reports finished', () => {
    let index = 0;
    for (let i = 0; i < TOUR_LENGTH; i++) index = advance(index);
    expect(isFinished(index)).toBe(true);
  });

  it('never runs past the end, so it cannot block input forever', () => {
    let index = TOUR_LENGTH;
    for (let i = 0; i < 50; i++) index = advance(index);
    expect(index).toBe(TOUR_LENGTH);
    expect(isFinished(index)).toBe(true);
  });

  it('gives every action-beat a nudge, so a wrong tap is never a dead end', () => {
    for (const beat of TOUR_BEATS) {
      if (beat.require.kind === 'acknowledge') continue;
      expect(beat.nudge, beat.id).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// §9 / §10 — budgets
// ---------------------------------------------------------------------------

describe('performance budgets (§9, §10)', () => {
  it('keeps the ambient layer under the 30-node budget', () => {
    expect(AMBIENT_NODE_BUDGET).toBeLessThanOrEqual(AMBIENT_NODE_LIMIT);
  });

  it('ticks only for jobs actually running, never for all fifteen plots', () => {
    const idle = Object.fromEntries(BUILDING_IDS.map((id) => [id, {}]));
    expect(runningJobCount(idle)).toBe(0);

    const twoBusy = {
      ...idle,
      fish_market: { upgrading: { toLevel: 1 } },
      admiralty: { upgrading: { toLevel: 2 } },
    };
    expect(runningJobCount(twoBusy)).toBe(2);

    // Four dock workers is the ceiling (NUMBERS.md), so the 1 s tick can never
    // drive more than four plots however many are built.
    expect(runningJobCount(twoBusy)).toBeLessThanOrEqual(MAX_TICKING_PLOTS);
  });

  it('draws a bounded number of strokes even at the top tier', () => {
    for (const id of BUILDING_IDS) {
      // A plot is ~120x80 units; more than this many strokes would not read.
      expect(buildingArt(id, 4).strokes.length, id).toBeLessThan(60);
    }
  });
});

describe('the catalogue and the plot table agree', () => {
  it('every building the sheet can open has a name and levels', () => {
    for (const id of BUILDING_IDS) {
      expect(CITY_CATALOGUE[id].name, id).toBeTruthy();
      expect(CITY_CATALOGUE[id].levels.length, id).toBeGreaterThan(0);
    }
  });
});
