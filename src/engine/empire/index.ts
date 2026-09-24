export type EmpireRegion = 'home-waters' | 'coral-reach' | 'mist-expanse' | 'black-flag-sea';
export type EmpireBoss = 'kraken' | 'ghost-fleet' | 'pirate-king';
export type PortTwist = 'standard' | 'no-arsenal' | 'torpedoes-only' | 'mine-harbour' | 'fog-sea';
export interface EmpireCoord { readonly row: number; readonly col: number }
export interface EmpireShip { readonly id: string; readonly cells: readonly EmpireCoord[]; readonly ghost?: boolean }
export interface EmpirePort {
  readonly id: string; readonly name: string; readonly region: EmpireRegion; readonly boss?: EmpireBoss;
  readonly twist: PortTwist; readonly ships: readonly EmpireShip[]; readonly kit: readonly string[];
  readonly twoStarShipsAfloat: number; readonly threeStarTurns: number; readonly tributeCoins: number; readonly tributeSteel: number;
}
export interface EmpireResult { readonly won: boolean; readonly shipsAfloat: number; readonly turns: number }
export interface Tribute { readonly coins: number; readonly steel: number }

const REGIONS: readonly EmpireRegion[] = ['home-waters', 'coral-reach', 'mist-expanse', 'black-flag-sea'];
const NAMES = [
  ['Brinewatch', 'Mackerel Bay', 'Copper Quay', 'Needle Cape', 'Kraken Deep'],
  ['Sunken Bell', 'Coral Gate', 'Six-Mine Haven', 'Red Current', 'Ghost Anchorage'],
  ['Fog Lantern', 'Whisper Shoal', 'Torpedo Narrows', 'Pale Harbour', 'Crownless Cay'],
  ['Smuggler Run', 'Iron Atoll', 'Powder Port', 'Last Horizon', 'Pirate Throne'],
] as const;

const line = (id: string, row: number, col: number, length: number, vertical = false): EmpireShip => ({
  id,
  cells: Array.from({ length }, (_, i) => ({ row: row + (vertical ? i : 0), col: col + (vertical ? 0 : i) })),
});

export const KRAKEN_SHAPE: EmpireShip = { id: 'kraken', cells: [{ row: 2, col: 4 }, { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 }, { row: 4, col: 3 }, { row: 4, col: 5 }, { row: 5, col: 2 }, { row: 5, col: 3 }, { row: 5, col: 5 }, { row: 5, col: 6 }] };

function portShips(index: number, boss?: EmpireBoss): readonly EmpireShip[] {
  if (boss === 'kraken') return [KRAKEN_SHAPE, line('guard-a', 7, 1, 2), line('guard-b', 7, 8, 2, true)];
  const ghost = boss === 'ghost-fleet';
  return [line('alpha', 1, 1, 4, index % 2 === 0), { ...line('beta', 6, 4, 3, index % 2 !== 0), ...(ghost ? { ghost: true } : {}) }, line('gamma', 8, 7, 2)];
}

export const EMPIRE_PORTS: readonly EmpirePort[] = REGIONS.flatMap((region, regionIndex) =>
  NAMES[regionIndex]!.map((name, localIndex) => {
    const index = regionIndex * 5 + localIndex;
    const boss: EmpireBoss | undefined = index === 4 ? 'kraken' : index === 9 ? 'ghost-fleet' : index === 19 ? 'pirate-king' : undefined;
    const twist: PortTwist = boss === 'ghost-fleet' ? 'fog-sea' : localIndex === 1 ? 'no-arsenal' : localIndex === 2 ? 'mine-harbour' : localIndex === 3 ? 'torpedoes-only' : 'standard';
    return { id: `port-${String(index + 1).padStart(2, '0')}`, name, region, ...(boss ? { boss } : {}), twist, ships: portShips(index, boss), kit: twist === 'no-arsenal' ? [] : twist === 'torpedoes-only' ? ['torpedo'] : ['cannon'], twoStarShipsAfloat: 2, threeStarTurns: 45 + regionIndex * 5, tributeCoins: 4 + regionIndex, tributeSteel: 2 + regionIndex };
  }),
);

export function connected(cells: readonly EmpireCoord[]): boolean {
  if (cells.length === 0) return false;
  const keys = new Set(cells.map((cell) => `${cell.row}:${cell.col}`));
  const seen = new Set<string>(); const queue = [cells[0]!];
  while (queue.length) { const cell = queue.shift()!; const key = `${cell.row}:${cell.col}`; if (seen.has(key)) continue; seen.add(key); for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]] as const) { const next = { row: cell.row + dr, col: cell.col + dc }; if (keys.has(`${next.row}:${next.col}`)) queue.push(next); } }
  return seen.size === cells.length;
}

export function obeysHalo(ships: readonly EmpireShip[]): boolean {
  for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) for (const x of ships[a]!.cells) for (const y of ships[b]!.cells) if (Math.max(Math.abs(x.row - y.row), Math.abs(x.col - y.col)) <= 1) return false;
  return true;
}

export function shipSunk(ship: EmpireShip, hits: ReadonlySet<string>): boolean { return ship.cells.every((cell) => hits.has(`${cell.row}:${cell.col}`)); }
export function starsFor(port: EmpirePort, result: EmpireResult): 0 | 1 | 2 | 3 { if (!result.won) return 0; if (result.shipsAfloat >= port.twoStarShipsAfloat && result.turns <= port.threeStarTurns) return 3; if (result.shipsAfloat >= port.twoStarShipsAfloat) return 2; return 1; }
export function scriptedSolution(port: EmpirePort): readonly EmpireCoord[] { return port.ships.flatMap((ship) => ship.cells); }
export function replayEmpireBattle(port: EmpirePort, shots: readonly EmpireCoord[]): EmpireResult {
  const fired = new Set(shots.filter((cell) => cell.row >= 0 && cell.row < 10 && cell.col >= 0 && cell.col < 10).map((cell) => `${cell.row}:${cell.col}`));
  const won = port.ships.every((ship) => shipSunk(ship, fired));
  return { won, turns: shots.length, shipsAfloat: Math.max(0, 8 - Math.floor(shots.length / 8)) };
}

export function relocateGhost(ship: EmpireShip, ships: readonly EmpireShip[], hits: ReadonlySet<string>, enemyTurn: number, seed: number): EmpireShip {
  if (!ship.ghost || enemyTurn <= 0 || enemyTurn % 3 !== 0 || ship.cells.some((cell) => hits.has(`${cell.row}:${cell.col}`))) return ship;
  const height = Math.max(...ship.cells.map((c) => c.row)) - Math.min(...ship.cells.map((c) => c.row));
  const width = Math.max(...ship.cells.map((c) => c.col)) - Math.min(...ship.cells.map((c) => c.col));
  const others = ships.filter((candidate) => candidate.id !== ship.id);
  const candidates: EmpireShip[] = [];
  for (let row = 0; row + height < 10; row++) for (let col = 0; col + width < 10; col++) {
    const minRow = Math.min(...ship.cells.map((c) => c.row)); const minCol = Math.min(...ship.cells.map((c) => c.col));
    const moved = { ...ship, cells: ship.cells.map((cell) => ({ row: row + cell.row - minRow, col: col + cell.col - minCol })) };
    if (obeysHalo([...others, moved])) candidates.push(moved);
  }
  return candidates.length ? candidates[Math.abs(seed) % candidates.length]! : ship;
}

export const PIRATE_KING_INVENTORY = { aaGuns: 5, mines: 8, decoys: 2 } as const;
export const TRIBUTE_CAP_MS = 24 * 60 * 60 * 1000;
export function accrueTribute(conquered: readonly string[], elapsedMs: number): Tribute {
  const elapsedDays = Math.min(TRIBUTE_CAP_MS, Math.max(0, elapsedMs)) / TRIBUTE_CAP_MS;
  const ports = EMPIRE_PORTS.filter((port) => conquered.includes(port.id));
  return { coins: Math.floor(ports.reduce((sum, port) => sum + port.tributeCoins, 0) * elapsedDays), steel: Math.floor(ports.reduce((sum, port) => sum + port.tributeSteel, 0) * elapsedDays) };
}
export function empireProgress(conquered: readonly string[]): number { return Math.floor((new Set(conquered).size / EMPIRE_PORTS.length) * 100); }
