export type CityTimePreference = 'auto' | 'day' | 'night';
export type CityTheme = 'day' | 'night';
export type SeasonOverlayId = 'winter' | 'lantern-festival';

export interface SeasonWindow {
  readonly id: SeasonOverlayId;
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface RainWindow {
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface LivingWorldState {
  readonly theme: CityTheme;
  readonly seasons: readonly SeasonOverlayId[];
  readonly weather: 'clear' | 'rain';
}

export const RAIN_DURATION_MS = 5 * 60 * 1000;

export const CITY_PALETTES = {
  day: {
    paper: '#FBFCFE',
    ink: '#3E2FB8',
    inkSoft: '#6C5FD6',
    grid: '#A6D8EE',
    window: '#D58C24',
  },
  night: {
    paper: '#12345B',
    ink: '#F4F8FF',
    inkSoft: '#BBDDF5',
    grid: '#74A9CF',
    window: '#FFD36A',
  },
} as const;

export function cityThemeAt(localHour: number, preference: CityTimePreference): CityTheme {
  if (preference !== 'auto') return preference;
  const hour = Math.max(0, Math.min(23, Math.floor(localHour)));
  return hour >= 19 || hour < 6 ? 'night' : 'day';
}

export function activeSeasons(
  windows: readonly SeasonWindow[],
  now: number,
): readonly SeasonOverlayId[] {
  return windows
    .filter((window) => window.endsAt > window.startsAt && now >= window.startsAt && now < window.endsAt)
    .map((window) => window.id);
}

/** Mulberry32: deterministic and import-free, for decoration only. */
function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zero, one or two non-overlapping five-minute passes in a local day. */
export function rainWindowsForDay(dayStart: number, seed: number): readonly RainWindow[] {
  const next = random(seed);
  const count = Math.floor(next() * 3);
  const usable = 24 * 60 * 60 * 1000 - RAIN_DURATION_MS;
  const starts = Array.from({ length: count }, () => dayStart + Math.floor(next() * usable)).sort(
    (a, b) => a - b,
  );
  if (starts.length === 2 && starts[1]! - starts[0]! < RAIN_DURATION_MS) {
    starts[1] = Math.min(dayStart + usable, starts[0]! + RAIN_DURATION_MS);
  }
  return starts.map((startsAt) => ({ startsAt, endsAt: startsAt + RAIN_DURATION_MS }));
}

export function weatherAt(windows: readonly RainWindow[], now: number): 'clear' | 'rain' {
  return windows.some((window) => now >= window.startsAt && now < window.endsAt)
    ? 'rain'
    : 'clear';
}

export function livingWorldState(input: {
  readonly localHour: number;
  readonly preference: CityTimePreference;
  readonly seasons: readonly SeasonWindow[];
  readonly rain: readonly RainWindow[];
  readonly now: number;
}): LivingWorldState {
  return {
    theme: cityThemeAt(input.localHour, input.preference),
    seasons: activeSeasons(input.seasons, input.now),
    weather: weatherAt(input.rain, input.now),
  };
}

/**
 * Decorations are a projection only. Keeping this identity function typed
 * proves no living-world input can manufacture or mutate gameplay fields.
 */
export function gameplayUnaffected<T>(gameplay: T, _decoration: LivingWorldState): T {
  return gameplay;
}

