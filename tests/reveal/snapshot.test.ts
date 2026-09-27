/**
 * The winner's board as the reveal will draw it (src/features/reveal/snapshot.ts):
 * a real finished match's board comes through whole and detached, and a board
 * that cannot be drawn truthfully is refused rather than guessed at.
 */
import { cellsOf, coordKey } from '@engine/board';
import { createMatch, reduce } from '@engine/match';
import type { ArsenalItem, Board, MatchAction, MatchState, Ship } from '@engine/types';
import { describe, expect, it } from 'vitest';

import { hasDefences, parseRevealBoard, sunkShipsOf } from '../../src/features/reveal/snapshot';

function ship(id: string, cls: Ship['class'], len: number, r: number, c: number, orientation: 'h' | 'v'): Ship {
  return { id, class: cls, len, origin: { r, c }, orientation, hits: [] };
}

/** Rows 0, 2, 4, 6 plus one vertical cruiser, halo-legal. */
const FLEET: readonly Ship[] = [
  ship('battleship-1', 'battleship', 4, 0, 0, 'h'),
  ship('cruiser-1', 'cruiser', 3, 2, 0, 'h'),
  ship('cruiser-2', 'cruiser', 3, 3, 9, 'v'),
  ship('destroyer-1', 'destroyer', 2, 4, 0, 'h'),
  ship('destroyer-2', 'destroyer', 2, 4, 3, 'h'),
  ship('destroyer-3', 'destroyer', 2, 8, 6, 'h'),
  ship('boat-1', 'boat', 1, 6, 0, 'h'),
  ship('boat-2', 'boat', 1, 6, 2, 'h'),
];
const DEFENCES: readonly ArsenalItem[] = [
  { id: 'gun-1', kind: 'aaGun', at: { r: 9, c: 0 } },
  { id: 'mine-1', kind: 'mine', at: { r: 9, c: 3 } },
];

function step(state: MatchState, action: MatchAction): MatchState {
  const { state: next, events } = reduce(state, action);
  const rejected = events.find((e) => e.type === 'REJECTED');
  if (rejected) throw new Error(`rejected: ${JSON.stringify(rejected)}`);
  return next;
}

/**
 * A finished advanced match: B's fleet is sunk by A; B lands a few shots on A
 * first, so A's board carries damage, a sunk boat, a spent mine and misses.
 */
function finishedMatch(): MatchState {
  let s = createMatch({ id: 'm', mode: 'advanced', seed: 7, playerIds: ['A', 'B'] });
  s = step(s, { type: 'SUBMIT_LAYOUT', playerId: 'A', ships: FLEET, arsenal: DEFENCES });
  s = step(s, { type: 'SUBMIT_LAYOUT', playerId: 'B', ships: FLEET, arsenal: [] });
  // B's shots at A, taken whenever it is B's turn: two hits, a sunk boat, a miss.
  const bShots = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 6, c: 0 },
    { r: 7, c: 7 },
  ];
  const aTargets = FLEET.flatMap((sh) => cellsOf(sh));
  for (let guard = 0; guard < 200 && s.phase === 'playing'; guard++) {
    if (s.turn === 'B') {
      const at = bShots.shift() ?? { r: 9, c: 9 };
      s = step(s, { type: 'FIRE', playerId: 'B', at });
    } else if (bShots.length > 0) {
      // A hit keeps the turn, so A would sink everything before B ever fired:
      // A opens with a miss instead.
      s = step(s, { type: 'FIRE', playerId: 'A', at: { r: 9, c: 9 } });
    } else {
      const at = aTargets.shift();
      if (!at) break;
      s = step(s, { type: 'FIRE', playerId: 'A', at });
    }
  }
  expect(s.phase).toBe('over');
  expect(s.winner).toBe('A');
  return s;
}

describe('parseRevealBoard — a real final board', () => {
  const match = finishedMatch();
  const board = match.players[0].board;
  const parsed = parseRevealBoard(JSON.parse(JSON.stringify(board)));

  it('keeps every ship exactly where and how it lay: same cells, same orientation, never transposed', () => {
    expect(parsed).not.toBeNull();
    expect(parsed?.ships.map((s) => [s.id, s.class, s.origin, s.orientation])).toEqual(
      board.ships.map((s) => [s.id, s.class, s.origin, s.orientation]),
    );
    const vertical = parsed?.ships.find((s) => s.id === 'cruiser-2');
    expect(vertical?.orientation).toBe('v');
    expect(cellsOf(vertical as Ship).map(coordKey)).toEqual(['3,9', '4,9', '5,9']);
  });

  it('keeps the damage: hits on ships, the sunk boat, and the loser’s marks', () => {
    expect(parsed?.ships.find((s) => s.id === 'battleship-1')?.hits).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ]);
    expect(sunkShipsOf(parsed as Board).map((s) => s.id)).toEqual(['boat-1']);
    expect(parsed?.marks).toEqual(board.marks);
    expect(Object.values(parsed?.marks ?? {})).toContain('miss');
  });

  it('keeps the defences as they ended', () => {
    expect(parsed?.arsenal).toEqual(board.arsenal.filter((i) => i.at));
    expect(hasDefences(parsed as Board)).toBe(true);
  });

  it('is a detached copy — nothing shared with the source', () => {
    const src = JSON.parse(JSON.stringify(board)) as Board;
    const copy = parseRevealBoard(src) as Board;
    (src.ships[0] as unknown as { hits: unknown[] }).hits.push({ r: 0, c: 3 });
    expect(copy.ships[0]?.hits).toHaveLength(2);
    expect(copy.ships[0]).not.toBe(src.ships[0]);
  });
});

describe('parseRevealBoard — refuses what it cannot draw truthfully', () => {
  const good = (): Record<string, unknown> => JSON.parse(JSON.stringify({ ships: FLEET, arsenal: DEFENCES, marks: {} }));

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'board'],
    ['an array', []],
    ['no ships', { arsenal: [], marks: {} }],
    ['an empty fleet', { ships: [], arsenal: [], marks: {} }],
  ])('%s', (_label, raw) => {
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('a ship running off the grid', () => {
    const raw = good();
    (raw.ships as Ship[])[0] = ship('battleship-1', 'battleship', 4, 0, 7, 'h');
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('a length that does not match the class', () => {
    const raw = good();
    (raw.ships as { len: number }[])[1]!.len = 2;
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('two ships on one cell', () => {
    const raw = good();
    (raw.ships as Ship[])[7] = ship('boat-2', 'boat', 1, 0, 0, 'h');
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('a hit that is not on its ship', () => {
    const raw = good();
    (raw.ships as { hits: unknown[] }[])[0]!.hits = [{ r: 5, c: 5 }];
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('a repeated ship id', () => {
    const raw = good();
    (raw.ships as { id: string }[])[1]!.id = 'battleship-1';
    expect(parseRevealBoard(raw)).toBeNull();
  });

  it('a coordinate that is not a whole in-grid number', () => {
    const raw = good();
    (raw.ships as { origin: unknown }[])[6]!.origin = { r: 6.5, c: 0 };
    expect(parseRevealBoard(raw)).toBeNull();
  });
});

describe('parseRevealBoard — keeps what it can draw, drops the rest, invents nothing', () => {
  it('drops a newer server’s defence kinds and carried weapons, keeps guns and mines', () => {
    const parsed = parseRevealBoard({
      ships: FLEET,
      arsenal: [
        ...DEFENCES,
        { id: 'net-1', kind: 'sonar_net', at: { r: 9, c: 6 } },
        { id: 'bomber-1', kind: 'bomber', used: true },
        { id: 'gun-2', kind: 'aaGun', at: { r: 12, c: 0 } },
      ],
      marks: {},
    });
    expect(parsed?.arsenal.map((i) => i.id)).toEqual(['gun-1', 'mine-1']);
  });

  it('keeps destroyed/used flags only when they are really true', () => {
    const parsed = parseRevealBoard({
      ships: FLEET,
      arsenal: [
        { id: 'gun-1', kind: 'aaGun', at: { r: 9, c: 0 }, destroyed: true },
        { id: 'mine-1', kind: 'mine', at: { r: 9, c: 3 }, used: 'yes' },
      ],
      marks: {},
    });
    expect(parsed?.arsenal).toEqual([
      { id: 'gun-1', kind: 'aaGun', at: { r: 9, c: 0 }, destroyed: true },
      { id: 'mine-1', kind: 'mine', at: { r: 9, c: 3 } },
    ]);
  });

  it('keeps marks it can draw, drops unknown states and malformed keys', () => {
    const parsed = parseRevealBoard({
      ships: FLEET,
      arsenal: [],
      marks: { '0,0': 'hit', '5,5': 'miss', '9,9': 'mine_disarmed', '1,1': 'unknown', '10,0': 'miss', x: 'hit' },
    });
    expect(parsed?.marks).toEqual({ '0,0': 'hit', '5,5': 'miss' });
  });

  it('missing arsenal or marks read as none, not as an error', () => {
    const parsed = parseRevealBoard({ ships: FLEET });
    expect(parsed?.arsenal).toEqual([]);
    expect(parsed?.marks).toEqual({});
    expect(hasDefences(parsed as Board)).toBe(false);
    expect(sunkShipsOf(parsed as Board)).toEqual([]);
  });
});
