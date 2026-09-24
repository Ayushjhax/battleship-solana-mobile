/**
 * Part 10A — Rosa's +25 % salvage, at the one place salvage is computed.
 *
 * She is the captain who must have NO effect inside the match; her whole
 * ability is this number. The engine's differential test proves the first
 * half; this pins the second: applied to the base, floored, per seat.
 */
import { describe, expect, it } from 'vitest';
import { cellsOf } from '@engine/board';
import { autoPlaceFleet } from '@engine/placement';
import { createMatch, reduce } from '@engine/match';
import { createRng } from '@engine/rng';
import type { CaptainId, MatchState } from '@engine/types';
import { SALVAGE_PER_CELL } from '@engine/city';

import { salvageBases } from '../../src/city/salvage';

function started(captainA: CaptainId | null, captainB: CaptainId | null): MatchState {
  let state = createMatch({ id: 'salvage', mode: 'advanced', seed: 1, playerIds: ['a', 'b'] });
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: 'a',
    ships: autoPlaceFleet(createRng(1)),
    arsenal: [],
    ...(captainA ? { captainId: captainA } : {}),
  }).state;
  state = reduce(state, {
    type: 'SUBMIT_LAYOUT',
    playerId: 'b',
    ships: autoPlaceFleet(createRng(2)),
    arsenal: [],
    ...(captainB ? { captainId: captainB } : {}),
  }).state;
  return state;
}

/** Every ship on `index`'s board fully hit, as a finished match would leave it. */
function sinkFleet(state: MatchState, index: 0 | 1): MatchState {
  const player = state.players[index];
  const ships = player.board.ships.map((ship) => ({ ...ship, hits: cellsOf(ship) }));
  const updated = { ...player, board: { ...player.board, ships } };
  const players: [typeof updated, typeof updated] =
    index === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players };
}

describe('Rosa, the Quartermaster — salvage', () => {
  it('pays exactly the base with no captain, and +25 % floored with Rosa', () => {
    const base = started(null, null);
    const sunk = sinkFleet(base, 1);
    const fullFleet = sunk.players[1].board.ships.reduce((n, ship) => n + ship.len, 0);
    expect(salvageBases(sunk)[0]).toBe(fullFleet * SALVAGE_PER_CELL);

    const rosa = sinkFleet(started('rosa', null), 1);
    expect(salvageBases(rosa)[0]).toBe(Math.floor(fullFleet * SALVAGE_PER_CELL * 1.25));
  });

  it('floors the odd cell: a lone boat is 5 → 6, not 7', () => {
    const rosa = started('rosa', null);
    // One boat, fully hit.
    const player = rosa.players[1];
    const ships = player.board.ships.map((ship, index) =>
      index === 0 ? { ...ship, len: 1, hits: [{ r: ship.origin.r, c: ship.origin.c }] } : { ...ship, hits: [] },
    );
    const updated = { ...player, board: { ...player.board, ships } };
    const state: MatchState = {
      ...rosa,
      players: [rosa.players[0], updated],
    };
    expect(salvageBases(state)[0]).toBe(Math.floor(SALVAGE_PER_CELL * 1.25));
  });

  it('applies per seat, not to the whole match', () => {
    const both = sinkFleet(sinkFleet(started('rosa', null), 1), 0);
    const [a, b] = salvageBases(both);
    expect(a).toBeGreaterThan(0);
    // Seat B has no captain: the plain base, not the boosted one.
    expect(b % SALVAGE_PER_CELL).toBe(0);
    expect(a).not.toBe(b);
  });
});
