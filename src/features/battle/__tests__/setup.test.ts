/**
 * The placement -> match boundary.
 *
 * The bug this pins: buildBattleSetup used to accept a fleet only when it had
 * exactly 10 ships, a number left behind when FLEET_SPEC dropped to 8. Every
 * offline and hot-seat match therefore threw the arranged board away and
 * auto-placed a random one; the arsenal was then validated against that new
 * fleet, failed, and was dropped too. The player placed a board and played a
 * different one with no defences on it.
 */
import { FLEET_SHIP_COUNT } from '@engine/fleet';
import { validateSubmission } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { ArsenalItem, Ship } from '@engine/types';
import { describe, expect, it, vi } from 'vitest';

// buildBattleSetup is pure; only its module neighbour reads the socket store.
vi.mock('@/net/match-client', () => ({ useMatchClient: { getState: () => ({}) } }));

import { aiKit, buildBattleSetup, usableLayout, type PlacementSnapshot } from '../setup';

const PROFILE = {
  name: 'Khyh',
  rankPoints: 30,
  avatarId: 1,
  avatarColor: '#3E2FB8',
  countryCode: 'IN',
};

function fleet(seed: number): readonly Ship[] {
  return autoPlaceFleet(createRng(seed));
}

/** Defences on cells no ship in `ships` occupies, so the pair is legal. */
function defences(ships: readonly Ship[]): ArsenalItem[] {
  const taken = new Set<string>();
  for (const ship of ships) {
    for (let n = 0; n < ship.len; n++) {
      const r = ship.origin.r + (ship.orientation === 'v' ? n : 0);
      const c = ship.origin.c + (ship.orientation === 'h' ? n : 0);
      // Arsenal may not touch a ship, so block the neighbourhood too.
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) taken.add(`${r + dr},${c + dc}`);
      }
    }
  }
  const free: { r: number; c: number }[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) if (!taken.has(`${r},${c}`)) free.push({ r, c });
  }
  return [
    { id: 'aa-1', kind: 'aaGun', at: free[0] as { r: number; c: number } },
    { id: 'radar-1', kind: 'radar', at: free[free.length - 1] as { r: number; c: number } },
    { id: 'torp-1', kind: 'torpedoBomber' },
  ];
}

function snapshot(over: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    mode: 'ai',
    difficulty: 'normal',
    ruleset: 'advanced',
    ships: [],
    arsenal: [],
    playerOneShips: null,
    playerTwoShips: null,
    playerOneArsenal: null,
    playerTwoArsenal: null,
    playerOneName: 'Player 1',
    playerTwoName: 'Player 2',
    ...over,
  };
}

describe('usableLayout', () => {
  it('keeps a legal fleet and its arsenal exactly as arranged', () => {
    const ships = fleet(7);
    const arsenal = defences(ships);

    const layout = usableLayout('advanced', ships, arsenal, createRng(1), 'test');

    expect(layout.ships).toBe(ships);
    expect(layout.arsenal).toBe(arsenal);
  });

  it('drops the arsenal in classic without touching the fleet', () => {
    const ships = fleet(8);

    const layout = usableLayout('classic', ships, defences(ships), createRng(1), 'test');

    expect(layout.ships).toBe(ships);
    expect(layout.arsenal).toEqual([]);
  });

  it('replaces ships and arsenal together when the layout is illegal', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ships = fleet(9);
    // One ship short: the reducer would reject this whole submission.
    const short = ships.slice(1);

    const layout = usableLayout('advanced', short, defences(ships), createRng(3), 'test');

    // Never a fresh fleet wearing the old board's defences — that pairing is
    // itself invalid, and it is what left players with no arsenal at all.
    expect(layout.ships).toHaveLength(FLEET_SHIP_COUNT);
    expect(layout.arsenal).toEqual([]);
    expect(validateSubmission('advanced', layout.ships, layout.arsenal).ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns something the reducer accepts for every input it is given', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ships = fleet(seed);
      const layout = usableLayout('advanced', ships, defences(ships), createRng(seed), 'test');
      expect(validateSubmission('advanced', layout.ships, layout.arsenal).ok).toBe(true);
    }
  });
});

describe('buildBattleSetup', () => {
  it('carries the arranged fleet and arsenal into an offline match', () => {
    const ships = fleet(21);
    const arsenal = defences(ships);

    const setup = buildBattleSetup(snapshot({ ships, arsenal }), PROFILE, 99);

    expect(setup.one.ships).toEqual(ships);
    expect(setup.one.arsenal).toEqual(arsenal);
  });

  it('accepts the fleet the fleet table actually defines', () => {
    // The regression in one line: FLEET_SHIP_COUNT is 8, and the old guard
    // wanted 10, so a perfectly legal board was always thrown away.
    const ships = fleet(4);
    expect(ships).toHaveLength(FLEET_SHIP_COUNT);

    const setup = buildBattleSetup(snapshot({ ships, ruleset: 'classic' }), PROFILE, 5);

    expect(setup.one.ships).toEqual(ships);
  });

  it('gives both hot-seat players the board they each arranged', () => {
    const one = fleet(31);
    const two = fleet(32);

    const setup = buildBattleSetup(
      snapshot({
        mode: 'hotseat',
        playerOneShips: one,
        playerOneArsenal: defences(one),
        playerTwoShips: two,
        playerTwoArsenal: defences(two),
      }),
      PROFILE,
      12,
    );

    expect(setup.one.ships).toEqual(one);
    expect(setup.two.ships).toEqual(two);
    expect(setup.one.arsenal).not.toEqual([]);
    expect(setup.two.arsenal).not.toEqual([]);
  });

  it('builds an AI opponent the reducer will accept', () => {
    const setup = buildBattleSetup(snapshot({ ships: fleet(41), arsenal: [] }), PROFILE, 41);

    expect(validateSubmission('advanced', setup.two.ships, setup.two.arsenal).ok).toBe(true);
  });

  it('leaves the AI without an arsenal in classic', () => {
    const ships = fleet(51);

    const setup = buildBattleSetup(snapshot({ ships, ruleset: 'classic' }), PROFILE, 51);

    expect(setup.two.arsenal).toEqual([]);
    expect(validateSubmission('classic', setup.two.ships, setup.two.arsenal).ok).toBe(true);
  });
});

describe('aiKit', () => {
  it('stays inside the fuel budget and off the AI’s own ships', () => {
    for (const seed of [1, 7, 13, 29]) {
      const ships = fleet(seed);
      expect(validateSubmission('advanced', ships, aiKit(createRng(seed), ships)).ok).toBe(true);
    }
  });
});
