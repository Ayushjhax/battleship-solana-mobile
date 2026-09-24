/**
 * Terrain and the five seas — part-10 §10B.
 *
 * Three cell types sit on top of the 10 x 10:
 *
 *   island  no ship or item may occupy it; public from the start and never
 *           fireable. A torpedo run stops dead on it; a bomb or blast that
 *           covers it does nothing there.
 *   reef    only ships of length <= 2 (destroyers and boats) may sit on it.
 *           Everything else behaves normally.
 *   fog     a ship sunk inside fog does not auto-reveal the halo cells that
 *           are in fog; cells outside the fog still hatch.
 *
 * The seas are FIXED tables, hand-tuned (not generated) so every one of them
 * fits the whole fleet with room to spare. A generator test runs the real
 * autoPlaceFleet 100,000 times per sea and checks every result, so "nobody is
 * ever stuck on Shuffle" is measured rather than asserted.
 *
 * The whole terrain grid is PUBLIC: it is announced before placement, it is
 * drawn on both boards, and it carries no ship or item information by
 * construction. It therefore lives beside the marks in PlayerView, not inside
 * them.
 *
 * PURITY: no clock, no randomness, no imports outside src/engine.
 */
import { GRID_SIZE, type Coord } from './types';

export type TerrainCell = 'water' | 'island' | 'reef' | 'fog';
export type Terrain = readonly (readonly TerrainCell[])[];

export type SeaId = 'open' | 'archipelago' | 'coral' | 'fogbank' | 'strait';

export interface SeaSpec {
  readonly id: SeaId;
  readonly name: string;
  readonly terrain: Terrain;
  readonly blurb: string;
}

/**
 * A sea table, written as ten strings so it reads like a chart:
 *   `.` water   `#` island   `~` reef   `f` fog
 */
function chart(rows: readonly string[]): Terrain {
  if (rows.length !== GRID_SIZE) throw new Error(`a sea needs ${GRID_SIZE} rows`);
  return rows.map((row) => {
    if (row.length !== GRID_SIZE) throw new Error(`a sea row needs ${GRID_SIZE} cells`);
    return [...row].map((char): TerrainCell => {
      switch (char) {
        case '.':
          return 'water';
        case '#':
          return 'island';
        case '~':
          return 'reef';
        case 'f':
          return 'fog';
        default:
          throw new Error(`unknown sea cell "${char}"`);
      }
    });
  });
}

const WATER_ROWS = [
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
] as const;

/** The default: every cell water. Frozen so nobody can mutate the shared table. */
export const WATER: Terrain = Object.freeze(chart(WATER_ROWS));

/**
 * The five fixed seas. Open Sea is the current board and the only Classic
 * board, forever; the other four are the Lighthouse's.
 */
export const SEAS: readonly SeaSpec[] = [
  {
    id: 'open',
    name: 'Open Sea',
    terrain: WATER,
    blurb: 'The open water this game has always played on.',
  },
  {
    id: 'archipelago',
    name: 'Archipelago',
    terrain: chart([
      '..#.......',
      '......#...',
      '..........',
      '#........#',
      '..........',
      '...#......',
      '.......#..',
      '..........',
      '.#........',
      '..........',
    ]),
    blurb: 'Seven islands: torpedoes become much weaker, submarines much better.',
  },
  {
    id: 'coral',
    name: 'Coral Reef',
    terrain: chart([
      '..........',
      '..........',
      '..........',
      '~~~~~~~~~~',
      '~~~~~~~~~~',
      '~~~~~~~~~~',
      '..........',
      '..........',
      '..........',
      '..........',
    ]),
    blurb: 'A reef band across rows D–F: the battleship is squeezed to the top and bottom.',
  },
  {
    id: 'fogbank',
    name: 'Fogbank',
    terrain: chart([
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
      '.....fffff',
    ]),
    blurb: 'Fog over columns 6–10: half the board keeps its secrets after a sink.',
  },
  {
    id: 'strait',
    name: 'The Strait',
    terrain: chart([
      '....#.....',
      '....#.....',
      '~...#....~',
      '~........~',
      '~........~',
      '~........~',
      '~...#....~',
      '~...#....~',
      '....#.....',
      '..........',
    ]),
    blurb: 'An island chain down column 5 with reefs at the edges: two small seas joined.',
  },
] as const;

const BY_ID: Readonly<Record<SeaId, SeaSpec>> = Object.fromEntries(
  SEAS.map((sea) => [sea.id, sea]),
) as Readonly<Record<SeaId, SeaSpec>>;

const SEA_IDS = new Set<string>(SEAS.map((sea) => sea.id));

export function isSeaId(value: unknown): value is SeaId {
  return typeof value === 'string' && SEA_IDS.has(value);
}

export function seaSpec(id: SeaId): SeaSpec {
  return BY_ID[id];
}

export function terrainForSea(id: SeaId): Terrain {
  return BY_ID[id].terrain;
}

// ---------------------------------------------------------------------------
// Cell lookups
// ---------------------------------------------------------------------------

/** The cell at a coordinate; anything off-grid reads as water. */
export function cellAt(terrain: Terrain, at: Coord): TerrainCell {
  return terrain[at.r]?.[at.c] ?? 'water';
}

export function isIsland(terrain: Terrain, at: Coord): boolean {
  return cellAt(terrain, at) === 'island';
}

export function isReef(terrain: Terrain, at: Coord): boolean {
  return cellAt(terrain, at) === 'reef';
}

export function isFog(terrain: Terrain, at: Coord): boolean {
  return cellAt(terrain, at) === 'fog';
}

/** A structurally valid terrain grid: 10 rows of 10 known cells. */
export function isTerrain(value: unknown): value is Terrain {
  if (!Array.isArray(value) || value.length !== GRID_SIZE) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === GRID_SIZE &&
      row.every(
        (cell: unknown) =>
          cell === 'water' || cell === 'island' || cell === 'reef' || cell === 'fog',
      ),
  );
}

// ---------------------------------------------------------------------------
// The season sea and the Lighthouse ladder (DECISIONS D36/D37)
// ---------------------------------------------------------------------------

/** Part 4's season is 28 days; the sea rotates on the same period. */
export const SEASON_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * One sea per season, Open Sea at every even position — so "Open Sea at least
 * every other season" is structural, not arithmetic: no two consecutive
 * entries are both non-open, and the cycle is closed (strait → open).
 */
export const SEASON_SEA_CYCLE: readonly SeaId[] = [
  'open',
  'archipelago',
  'open',
  'coral',
  'open',
  'fogbank',
  'open',
  'strait',
];

export function seasonSeaFor(season: number): SeaId {
  const length = SEASON_SEA_CYCLE.length;
  const index = ((Math.trunc(season) % length) + length) % length;
  return SEASON_SEA_CYCLE[index] as SeaId;
}

/** 1-based, counted in 28-day periods from the Unix epoch. */
export function seasonNumberAt(now: number): number {
  return Math.floor(now / SEASON_MS) + 1;
}

export function currentSeasonSeaAt(now: number): SeaId {
  return seasonSeaFor(seasonNumberAt(now));
}

/** The seas the Lighthouse has unlocked, one per level. Open is always there. */
export const LIGHTHOUSE_SEAS: readonly SeaId[] = [
  'archipelago',
  'coral',
  'fogbank',
  'strait',
];

export function unlockedSeasFor(lighthouseLevel: number): readonly SeaId[] {
  const level = Math.max(0, Math.min(Math.trunc(lighthouseLevel), LIGHTHOUSE_SEAS.length));
  return ['open', ...LIGHTHOUSE_SEAS.slice(0, level)];
}
