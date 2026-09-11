/**
 * The board lab's scenario: a match with damage already dealt on both sides so
 * every visual state is on screen at once. Pure — the route renders it, and a
 * Node check can assert on it.
 */
import { createMatch, projectView, reduce } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { ArsenalItem, CellState, Coord, MatchState, Ship, SunkShipView } from '@engine/types';

export const YOU = 'you';
export const FOE = 'foe';

const OWN_ARSENAL: readonly Omit<ArsenalItem, 'at'>[] = [
  { id: 'gun-1', kind: 'aaGun' },
  { id: 'gun-2', kind: 'aaGun' },
  { id: 'mine-1', kind: 'mine' },
  { id: 'radar-1', kind: 'radar' },
];

export function shipCells(ship: Pick<Ship, 'len' | 'origin' | 'orientation'>): Coord[] {
  const out: Coord[] = [];
  for (let i = 0; i < ship.len; i++) {
    out.push(ship.orientation === 'h' ? { r: ship.origin.r, c: ship.origin.c + i } : { r: ship.origin.r + i, c: ship.origin.c });
  }
  return out;
}

/** The first free cell scanning from the bottom-right corner. */
function freeCell(ships: readonly Ship[], taken: readonly Coord[]): Coord {
  const occupied = new Set([...ships.flatMap(shipCells), ...taken].map((c) => `${c.r},${c.c}`));
  for (let r = 9; r >= 0; r--) for (let c = 9; c >= 0; c--) if (!occupied.has(`${r},${c}`)) return { r, c };
  return { r: 9, c: 9 };
}

export function buildLab(seed = 2024): MatchState {
  const rng = createRng(seed);
  const mine = autoPlaceFleet(rng);
  const theirs = autoPlaceFleet(rng);

  const used: Coord[] = [];
  const ownArsenal: ArsenalItem[] = OWN_ARSENAL.map((item) => {
    const at = freeCell(mine, used);
    used.push(at);
    return { ...item, at };
  });
  const foeMine = freeCell(theirs, []);

  let state = createMatch({ id: 'lab', mode: 'advanced', seed: 1, playerIds: [YOU, FOE] });
  state = reduce(state, { type: 'SUBMIT_LAYOUT', playerId: YOU, ships: mine, arsenal: ownArsenal }).state;
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: FOE,
    ships: theirs,
    arsenal: [{ id: 'foe-mine', kind: 'mine', at: foeMine }],
  }).state;

  const fire = (who: string, s: MatchState, at: Coord) => reduce({ ...s, turn: who }, { type: 'FIRE', playerId: who, at }).state;

  // The enemy trips your mine, wrecks a gun, sinks a boat and wounds your
  // battleship — items first, before a sunk ship's halo could reveal them.
  state = fire(FOE, state, (ownArsenal.find((i) => i.kind === 'mine') as ArsenalItem).at as Coord);
  state = fire(FOE, state, (ownArsenal.find((i) => i.id === 'gun-2') as ArsenalItem).at as Coord);
  const boat = mine.find((s) => s.class === 'boat') as Ship;
  state = fire(FOE, state, boat.origin);
  const battleship = mine.find((s) => s.class === 'battleship') as Ship;
  state = fire(FOE, state, shipCells(battleship)[1] as Coord);
  // ...and misses once, on a cell nothing has touched.
  const ownMarks = state.players[0].board.marks;
  const miss = (() => {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (ownMarks[`${r},${c}`]) continue;
        if (mine.some((sh) => shipCells(sh).some((x) => x.r === r && x.c === c))) continue;
        if (ownArsenal.some((i) => i.at && i.at.r === r && i.at.c === c)) continue;
        return { r, c };
      }
    }
    return { r: 0, c: 0 };
  })();
  state = fire(FOE, state, miss);

  // You trip their mine, sink their destroyer, hit their cruiser, miss twice.
  state = fire(YOU, state, foeMine);
  const destroyer = theirs.find((s) => s.class === 'destroyer') as Ship;
  for (const cell of shipCells(destroyer)) state = fire(YOU, state, cell);
  const cruiser = theirs.find((s) => s.class === 'cruiser') as Ship;
  state = fire(YOU, state, shipCells(cruiser)[0] as Coord);
  const known = new Set(Object.keys(state.players[1].board.marks));
  let misses = 0;
  for (let r = 0; r < 10 && misses < 2; r++) {
    for (let c = 0; c < 10 && misses < 2; c++) {
      if (known.has(`${r},${c}`) || theirs.some((s) => shipCells(s).some((x) => x.r === r && x.c === c))) continue;
      state = fire(YOU, state, { r, c });
      misses++;
    }
  }
  return { ...state, turn: YOU };
}

/** Sunk enemy ships come back from the view as cells; rebuild a Ship for the wreck sprite. */
export function wrecksOf(sunk: readonly SunkShipView[]): Ship[] {
  return sunk.map((s) => {
    const first = s.cells[0] as Coord;
    const second = s.cells[1];
    return {
      id: s.id,
      class: s.class,
      len: s.cells.length,
      origin: first,
      orientation: second && second.r === first.r ? 'h' : 'v',
      hits: [...s.cells],
    };
  });
}

/** Which mark states each board shows — the lab must show all of them. */
export function statesShown(state: MatchState): { own: CellState[]; enemy: CellState[] } {
  const own = new Set(Object.values(state.players[0].board.marks));
  const enemy = new Set(Object.values(projectView(state, YOU).enemy.marks));
  return { own: [...own].sort(), enemy: [...enemy].sort() };
}
