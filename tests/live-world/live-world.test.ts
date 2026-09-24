import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@engine/cosmetics/contrast';
import {
  CITY_PALETTES,
  RAIN_DURATION_MS,
  activeSeasons,
  cityThemeAt,
  gameplayUnaffected,
  rainWindowsForDay,
  weatherAt,
} from '@engine/liveWorld';

describe('11A local time and overrides', () => {
  it.each([
    [5.99, 'night'],
    [6, 'day'],
    [18.99, 'day'],
    [19, 'night'],
  ] as const)('maps hour %s to %s', (hour, theme) => {
    expect(cityThemeAt(hour, 'auto')).toBe(theme);
  });

  it('forces either theme at every hour', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(cityThemeAt(hour, 'day')).toBe('day');
      expect(cityThemeAt(hour, 'night')).toBe('night');
    }
  });
});

describe('11A seasons and rare weather', () => {
  it('uses half-open server-configured season windows', () => {
    const windows = [
      { id: 'winter' as const, startsAt: 10, endsAt: 20 },
      { id: 'lantern-festival' as const, startsAt: 15, endsAt: 30 },
    ];
    expect(activeSeasons(windows, 9)).toEqual([]);
    expect(activeSeasons(windows, 15)).toEqual(['winter', 'lantern-festival']);
    expect(activeSeasons(windows, 20)).toEqual(['lantern-festival']);
  });

  it('creates at most two deterministic, five-minute windows', () => {
    for (let seed = 0; seed < 500; seed++) {
      const a = rainWindowsForDay(0, seed);
      const b = rainWindowsForDay(0, seed);
      expect(a).toEqual(b);
      expect(a.length).toBeLessThanOrEqual(2);
      for (const window of a) expect(window.endsAt - window.startsAt).toBe(RAIN_DURATION_MS);
    }
  });

  it('is rainy only inside a pass', () => {
    const rain = [{ startsAt: 100, endsAt: 100 + RAIN_DURATION_MS }];
    expect(weatherAt(rain, 99)).toBe('clear');
    expect(weatherAt(rain, 100)).toBe('rain');
    expect(weatherAt(rain, 100 + RAIN_DURATION_MS)).toBe('clear');
  });
});

describe('11A integrity and legibility', () => {
  it('cannot change gameplay state', () => {
    const gameplay = Object.freeze({ rank: 12, renown: 44, shots: 5, arsenal: ['radar'] });
    const result = gameplayUnaffected(gameplay, {
      theme: 'night',
      seasons: ['winter', 'lantern-festival'],
      weather: 'rain',
    });
    expect(result).toBe(gameplay);
    expect(result).toEqual({ rank: 12, renown: 44, shots: 5, arsenal: ['radar'] });
  });

  it('night uses the same 3:1 cosmetics-paper legibility floor', () => {
    const night = CITY_PALETTES.night;
    for (const foreground of [night.ink, night.inkSoft, night.grid, night.window]) {
      expect(contrastRatio(foreground, night.paper)).toBeGreaterThanOrEqual(3);
    }
  });
});

