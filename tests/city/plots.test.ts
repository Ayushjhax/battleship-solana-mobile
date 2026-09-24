/**
 * Plot coordinates and the plot state machine — part-02 §11.1, §11.2, §11.3.
 */
import { describe, expect, it } from 'vitest';

import { BUILDING_IDS, CITY_CATALOGUE, newCity, type BuildingId } from '@engine/city';
import {
  HARBOUR_NORMALISED,
  MAP_H,
  MAP_W,
  PLOTS,
  boxesOverlap,
  normalisedBox,
  plotFor,
  plotOrigin,
} from '@/city/ui/plots';
import { plotLabel, plotStateFor, tierForLevel } from '@/city/ui/plotState';
import type { CitySnapshot } from '@/city/types';

const NOW = 1_700_000_000_000;
const DAY = '2023-11-14';

function snapshot(patch: Partial<CitySnapshot['city']> = {}): CitySnapshot {
  return {
    city: { ...newCity(NOW, DAY), ...patch },
    wallet: { coins: 0, steel: 0, gems: 0 },
    freeWorkers: 2,
    collectable: { total: 0, ids: [] },
    features: [],
    unlocks: [],
  };
}

// ---------------------------------------------------------------------------
// §11.1
// ---------------------------------------------------------------------------

describe('the plot table (§11.1)', () => {
  it('has exactly one plot per catalogue building', () => {
    expect(PLOTS).toHaveLength(BUILDING_IDS.length);
    expect(new Set(PLOTS.map((p) => p.id))).toEqual(new Set(BUILDING_IDS));
    for (const id of BUILDING_IDS) expect(plotFor(id), id).toBeDefined();
  });

  it('keeps every coordinate inside the image', () => {
    for (const plot of PLOTS) {
      expect(plot.x, `${plot.id} x`).toBeGreaterThan(0);
      expect(plot.x, `${plot.id} x`).toBeLessThan(1);
      expect(plot.y, `${plot.id} y`).toBeGreaterThan(0);
      expect(plot.y, `${plot.id} y`).toBeLessThan(1);
    }
  });

  it('keeps every BOX inside the image too, not just its anchor', () => {
    for (const plot of PLOTS) {
      const box = normalisedBox(plot);
      expect(box.left, `${plot.id} left`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${plot.id} right`).toBeLessThanOrEqual(1);
      expect(box.top, `${plot.id} top`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${plot.id} bottom`).toBeLessThanOrEqual(1);
    }
  });

  it('has no two tap boxes overlapping at 1x', () => {
    const clashes: string[] = [];
    for (let i = 0; i < PLOTS.length; i++) {
      for (let j = i + 1; j < PLOTS.length; j++) {
        const a = PLOTS[i];
        const b = PLOTS[j];
        if (!a || !b) continue;
        if (boxesOverlap(normalisedBox(a), normalisedBox(b))) {
          clashes.push(`${a.id} x ${b.id}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('leaves the player own harbour clear', () => {
    const clashes = PLOTS.filter((p) => boxesOverlap(normalisedBox(p), HARBOUR_NORMALISED)).map(
      (p) => p.id,
    );
    expect(clashes).toEqual([]);
  });

  it('maps to sensible map-unit origins', () => {
    const fish = plotFor('fish_market');
    expect(fish).toBeDefined();
    if (!fish) return;
    const origin = plotOrigin(fish);
    expect(origin.left).toBeGreaterThan(0);
    expect(origin.top).toBeGreaterThan(0);
    expect(origin.left).toBeLessThan(MAP_W);
    expect(origin.top).toBeLessThan(MAP_H);
  });

  it('pins the three coordinates the design doc got wrong', () => {
    // Admiralty and Shipyard are pinned to the dashed slots that already
    // shipped in app/city.tsx; the Lighthouse to the drawn tower. See
    // progress/part-02-report.md §1.
    expect(plotFor('admiralty')).toMatchObject({ x: 0.22, y: 0.55 });
    expect(plotFor('shipyard')).toMatchObject({ x: 0.83, y: 0.54 });
    expect(plotFor('lighthouse')).toMatchObject({ x: 0.59, y: 0.79 });
  });

  it('says what each plot sits on, so a future nudge has context', () => {
    for (const plot of PLOTS) {
      expect(plot.sitsOn.length, plot.id).toBeGreaterThan(8);
    }
  });
});

// ---------------------------------------------------------------------------
// §11.2 — the six states
// ---------------------------------------------------------------------------

describe('the plot state machine (§11.2)', () => {
  const withBuilding = (id: BuildingId, patch: Record<string, unknown>) => {
    const base = newCity(NOW, DAY);
    return snapshot({
      buildings: {
        ...base.buildings,
        [id]: { ...base.buildings[id], ...patch },
      },
    });
  };

  it('locked: level 0 behind an Admiralty gate', () => {
    // The Foundry needs Admiralty 2; a fresh city is at 1.
    const view = plotStateFor(snapshot(), 'foundry', NOW);
    expect(view.state).toBe('locked');
    expect(view.requiredAdmiralty).toBe(2);
    expect(plotLabel(view)).toContain('needs Admiralty 2');
  });

  it('empty: level 0 and the gate is satisfied', () => {
    const view = plotStateFor(snapshot(), 'fish_market', NOW);
    expect(view.state).toBe('empty');
    expect(view.level).toBe(0);
  });

  it('building: level 0 with a job running', () => {
    const s = withBuilding('fish_market', {
      upgrading: { toLevel: 1, startedAt: NOW, endsAt: NOW + 60_000 },
    });
    const view = plotStateFor(s, 'fish_market', NOW + 30_000);
    expect(view.state).toBe('building');
    expect(view.toLevel).toBe(1);
    expect(view.progress).toBeCloseTo(0.5, 5);
    expect(view.secondsLeft).toBe(30);
  });

  it('built: a level and nothing to collect', () => {
    const view = plotStateFor(withBuilding('fish_market', { level: 2 }), 'fish_market', NOW);
    expect(view.state).toBe('built');
    expect(view.level).toBe(2);
  });

  it('upgrading: a level AND a job', () => {
    const s = withBuilding('fish_market', {
      level: 1,
      upgrading: { toLevel: 2, startedAt: NOW, endsAt: NOW + 900_000 },
    });
    const view = plotStateFor(s, 'fish_market', NOW);
    expect(view.state).toBe('upgrading');
    expect(view.level).toBe(1);
    expect(view.toLevel).toBe(2);
  });

  it('ready: a collector with something in it, and it outranks built', () => {
    const view = plotStateFor(
      withBuilding('fish_market', { level: 1, stored: 148 }),
      'fish_market',
      NOW,
    );
    expect(view.state).toBe('ready');
    expect(view.collectAmount).toBe(148);
    expect(view.collectResource).toBe('coins');
    expect(plotLabel(view)).toBe('Fish Market, level 1, collect 148 coins');
  });

  it('ready: the Scrapyard reads its pile, not a stored field', () => {
    const view = plotStateFor(snapshot({ scrapPile: 90 }), 'scrapyard', NOW);
    expect(view.state).toBe('ready');
    expect(view.collectAmount).toBe(90);
    expect(view.collectResource).toBe('steel');
  });

  it('is safe with no snapshot at all', () => {
    const view = plotStateFor(null, 'fish_market', NOW);
    expect(view.state).toBe('locked');
    expect(view.collectAmount).toBe(0);
  });

  it('flags max level so the sheet can hide the button', () => {
    const top = CITY_CATALOGUE.admiralty.levels.length;
    const view = plotStateFor(withBuilding('admiralty', { level: top }), 'admiralty', NOW);
    expect(view.atMaxLevel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11.3 — progress maths
// ---------------------------------------------------------------------------

describe('progress maths (§11.3)', () => {
  const job = (startedAt: number, endsAt: number) => {
    const base = newCity(NOW, DAY);
    return snapshot({
      buildings: {
        ...base.buildings,
        fish_market: { ...base.buildings.fish_market, upgrading: { toLevel: 1, startedAt, endsAt } },
      },
    });
  };

  it('clamps p to 0..1 at both ends', () => {
    const s = job(NOW, NOW + 1_000);
    expect(plotStateFor(s, 'fish_market', NOW - 10_000).progress).toBe(0);
    expect(plotStateFor(s, 'fish_market', NOW + 10_000).progress).toBe(1);
  });

  it('never reports a negative timer when the client clock runs ahead', () => {
    const s = job(NOW, NOW + 1_000);
    const view = plotStateFor(s, 'fish_market', NOW + 500_000);
    expect(view.secondsLeft).toBe(0);
    expect(view.secondsLeft).toBeGreaterThanOrEqual(0);
  });

  it('shows Finishing rather than a completed building until the server settles', () => {
    // endsAt has passed but the server still says level 0 with a job: the
    // plot must NOT claim to be built — only the server decides that.
    const s = job(NOW, NOW + 1_000);
    const view = plotStateFor(s, 'fish_market', NOW + 2_000);
    expect(view.finishing).toBe(true);
    expect(view.state).toBe('building');
    expect(view.level).toBe(0);
  });

  it('is not finishing while there is time left', () => {
    const view = plotStateFor(job(NOW, NOW + 60_000), 'fish_market', NOW);
    expect(view.finishing).toBe(false);
  });

  it('handles a zero-length job without dividing by zero', () => {
    const view = plotStateFor(job(NOW, NOW), 'fish_market', NOW);
    expect(view.progress).toBe(1);
  });
});

describe('tiers (§4)', () => {
  it('maps levels 1-8 onto four tiers', () => {
    expect([1, 2].map(tierForLevel)).toEqual([1, 1]);
    expect([3, 4].map(tierForLevel)).toEqual([2, 2]);
    expect([5, 6].map(tierForLevel)).toEqual([3, 3]);
    expect([7, 8].map(tierForLevel)).toEqual([4, 4]);
  });
});
