export const WORLD_BOSS_SIZE = 30;
export const BASE_DAILY_SHOTS = 5;
export const MAX_DAILY_SHOTS = 10;
export const WORLD_BOSS_SHIP_LENGTHS = [6, ...Array(3).fill(5), ...Array(6).fill(4), ...Array(10).fill(3), ...Array(20).fill(2)] as readonly number[];
export const MILESTONES = [25, 50, 75, 100] as const;

export interface BossCoord { readonly row: number; readonly col: number }
export interface BossShip { readonly id: string; readonly kind: 'flagship' | 'escort'; readonly cells: readonly BossCoord[] }
export interface BossLayout { readonly size: 30; readonly seed: number; readonly wave: number; readonly ships: readonly BossShip[]; readonly mines: readonly BossCoord[] }
export type BossMark = 'miss' | 'hit' | 'mine';
export interface PublicBossBoard { readonly size: 30; readonly wave: number; readonly marks: Readonly<Record<string, BossMark>>; readonly sunkShipIds: readonly string[]; readonly resolved: number; readonly totalShipCells: number }

export const bossCoordKey = ({ row, col }: BossCoord): string => `${row}:${col}`;
export const isBossCoord = (coord: BossCoord): boolean => Number.isInteger(coord.row) && Number.isInteger(coord.col) && coord.row >= 0 && coord.col >= 0 && coord.row < WORLD_BOSS_SIZE && coord.col < WORLD_BOSS_SIZE;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function neighbours(cell: BossCoord): BossCoord[] {
  const out: BossCoord[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const next = { row: cell.row + dr, col: cell.col + dc };
    if (isBossCoord(next)) out.push(next);
  }
  return out;
}

export function generateBossLayout(seed: number, wave = 1): BossLayout {
  const next = rng(seed ^ Math.imul(wave, 0x9e3779b1));
  const blocked = new Set<string>();
  const ships: BossShip[] = [];
  for (let index = 0; index < WORLD_BOSS_SHIP_LENGTHS.length; index++) {
    const length = WORLD_BOSS_SHIP_LENGTHS[index]!;
    let placed: readonly BossCoord[] | null = null;
    for (let attempt = 0; attempt < 20_000 && !placed; attempt++) {
      const vertical = next() < 0.5;
      const row = Math.floor(next() * (vertical ? WORLD_BOSS_SIZE - length + 1 : WORLD_BOSS_SIZE));
      const col = Math.floor(next() * (vertical ? WORLD_BOSS_SIZE : WORLD_BOSS_SIZE - length + 1));
      const cells = Array.from({ length }, (_, offset) => ({ row: row + (vertical ? offset : 0), col: col + (vertical ? 0 : offset) }));
      if (cells.every((cell) => !blocked.has(bossCoordKey(cell)))) placed = cells;
    }
    if (!placed) throw new Error(`world-boss-layout-exhausted:${index}`);
    ships.push({ id: index === 0 ? 'flagship' : `escort-${index}`, kind: index === 0 ? 'flagship' : 'escort', cells: placed });
    for (const cell of placed) for (const neighbour of neighbours(cell)) blocked.add(bossCoordKey(neighbour));
  }

  const occupied = new Set(ships.flatMap((ship) => ship.cells.map(bossCoordKey)));
  const mineCount = Math.min(30, 8 + (wave - 1) * 2);
  const candidates: BossCoord[] = [];
  for (let row = 0; row < WORLD_BOSS_SIZE; row++) for (let col = 0; col < WORLD_BOSS_SIZE; col++) {
    if (!occupied.has(`${row}:${col}`)) candidates.push({ row, col });
  }
  const mines: BossCoord[] = [];
  while (mines.length < mineCount) {
    const index = Math.floor(next() * candidates.length);
    mines.push(candidates.splice(index, 1)[0]!);
  }
  return { size: WORLD_BOSS_SIZE, seed, wave, ships, mines };
}

export function totalShipCells(layout: BossLayout): number {
  return layout.ships.reduce((sum, ship) => sum + ship.cells.length, 0);
}

export function resolveBossCell(layout: BossLayout, coord: BossCoord): BossMark {
  if (!isBossCoord(coord)) throw new Error('cell-out-of-bounds');
  const key = bossCoordKey(coord);
  if (layout.mines.some((cell) => bossCoordKey(cell) === key)) return 'mine';
  return layout.ships.some((ship) => ship.cells.some((cell) => bossCoordKey(cell) === key)) ? 'hit' : 'miss';
}

export function sunkShips(layout: BossLayout, marks: Readonly<Record<string, BossMark>>): readonly string[] {
  return layout.ships.filter((ship) => ship.cells.every((cell) => marks[bossCoordKey(cell)] === 'hit')).map((ship) => ship.id);
}

export function publicBossBoard(layout: BossLayout, marks: Readonly<Record<string, BossMark>>): PublicBossBoard {
  return { size: 30, wave: layout.wave, marks: { ...marks }, sunkShipIds: sunkShips(layout, marks), resolved: Object.keys(marks).length, totalShipCells: totalShipCells(layout) };
}

export function dailyShotAllowance(gazette: boolean, fleetWarRaids: number): number {
  return Math.min(MAX_DAILY_SHOTS, BASE_DAILY_SHOTS + (gazette ? 1 : 0) + Math.max(0, Math.floor(fleetWarRaids)));
}

export function reachedMilestones(previousPercent: number, nextPercent: number): readonly (typeof MILESTONES)[number][] {
  return MILESTONES.filter((milestone) => previousPercent < milestone && nextPercent >= milestone);
}

