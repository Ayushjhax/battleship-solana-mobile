/**
 * Two hand-placed, halo-valid layouts used across the suites, and a helper
 * that gets a match into the 'playing' phase with a known first player.
 */
import { createMatch, reduce } from '../match';
import type { ArsenalItem, Coord, MatchMode, MatchState, Ship } from '../types';

export const P0 = 'alice';
export const P1 = 'bob';

const ship = (
  id: string,
  cls: Ship['class'],
  len: number,
  r: number,
  c: number,
  o: Ship['orientation'],
): Ship => ({
  id,
  class: cls,
  len,
  origin: { r, c },
  orientation: o,
  hits: [],
});

/**
 * Layout A — rows 0, 2, 4, 6 with gaps:
 *   row 0: battleship (0,0)-(0,3)
 *   row 2: cruiser-1 (2,0)-(2,2)   cruiser-2 (2,4)-(2,6)
 *   row 4: destroyer-1 (4,0)-(4,1)  destroyer-2 (4,3)-(4,4)  destroyer-3 (4,6)-(4,7)
 *   row 6: boats at (6,0) (6,2) (6,4) (6,6)
 */
export const LAYOUT_A: Ship[] = [
  ship('battleship-1', 'battleship', 4, 0, 0, 'h'),
  ship('cruiser-1', 'cruiser', 3, 2, 0, 'h'),
  ship('cruiser-2', 'cruiser', 3, 2, 4, 'h'),
  ship('destroyer-1', 'destroyer', 2, 4, 0, 'h'),
  ship('destroyer-2', 'destroyer', 2, 4, 3, 'h'),
  ship('destroyer-3', 'destroyer', 2, 4, 6, 'h'),
  ship('boat-1', 'boat', 1, 6, 0, 'h'),
  ship('boat-2', 'boat', 1, 6, 2, 'h'),
  ship('boat-3', 'boat', 1, 6, 4, 'h'),
  ship('boat-4', 'boat', 1, 6, 6, 'h'),
];

/** Layout B — the same idea turned vertical, in columns 9, 7, 5, 3. */
export const LAYOUT_B: Ship[] = [
  ship('battleship-1', 'battleship', 4, 0, 9, 'v'),
  ship('cruiser-1', 'cruiser', 3, 0, 7, 'v'),
  ship('cruiser-2', 'cruiser', 3, 4, 7, 'v'),
  ship('destroyer-1', 'destroyer', 2, 0, 5, 'v'),
  ship('destroyer-2', 'destroyer', 2, 3, 5, 'v'),
  ship('destroyer-3', 'destroyer', 2, 6, 5, 'v'),
  ship('boat-1', 'boat', 1, 0, 3, 'v'),
  ship('boat-2', 'boat', 1, 2, 3, 'v'),
  ship('boat-3', 'boat', 1, 4, 3, 'v'),
  ship('boat-4', 'boat', 1, 6, 3, 'v'),
];

/** Every cell of a layout, for exhaustive firing. */
export function cellsOfLayout(ships: readonly Ship[]): Coord[] {
  const out: Coord[] = [];
  for (const s of ships) {
    for (let i = 0; i < s.len; i++) {
      out.push(
        s.orientation === 'h'
          ? { r: s.origin.r, c: s.origin.c + i }
          : { r: s.origin.r + i, c: s.origin.c },
      );
    }
  }
  return out;
}

export interface StartOptions {
  mode?: MatchMode;
  seed?: number;
  arsenalA?: ArsenalItem[];
  arsenalB?: ArsenalItem[];
  /** Force whose turn it is after the coin flip, for deterministic scripts. */
  first?: string;
}

/** A match in 'playing' with P0 on layout A and P1 on layout B. */
export function startMatch(options: StartOptions = {}): MatchState {
  const mode = options.mode ?? 'classic';
  let state = createMatch({ id: 'm1', mode, seed: options.seed ?? 7, playerIds: [P0, P1] });
  let r = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: P0,
    ships: LAYOUT_A,
    arsenal: options.arsenalA ?? [],
  });
  if (r.events.some((e) => e.type === 'REJECTED'))
    throw new Error(`layout A rejected: ${JSON.stringify(r.events)}`);
  state = r.state;
  r = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: P1,
    ships: LAYOUT_B,
    arsenal: options.arsenalB ?? [],
  });
  if (r.events.some((e) => e.type === 'REJECTED'))
    throw new Error(`layout B rejected: ${JSON.stringify(r.events)}`);
  state = r.state;
  if (state.phase !== 'playing') throw new Error('match did not start');
  return options.first ? { ...state, turn: options.first } : state;
}

export const types = (events: readonly { type: string }[]): string[] => events.map((e) => e.type);
