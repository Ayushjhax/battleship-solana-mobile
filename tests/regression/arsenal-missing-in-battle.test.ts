/**
 * Regression: "i am not able to use my arsenals" — in an advanced offline
 * match the Arsenal tab opened on a "Choose a weapon" list showing 0 of every
 * weapon, and the board underneath was not the one the player had arranged.
 *
 * `buildBattleSetup` decided whether to trust the placement screen's fleet
 * with `ships.length === 10 ? ships : autoPlaceFleet(rng)`. The fleet table
 * had since lost two of the four one-cell boats, so FLEET_SHIP_COUNT is 8 and
 * that test could never pass again. Every offline match therefore threw the
 * arranged board away and rolled a random one; the arsenal was handed over
 * unchanged, but its mines, radar and AA gun had been validated against the
 * arranged board, so on the random one they sat on a ship, the engine
 * REJECTED the whole SUBMIT_LAYOUT, and LocalMatch's own safety net
 * re-submitted with `arsenal: []` — the empty weapon list the player saw.
 * One stale constant, and the board and the entire arsenal were both gone,
 * silently, because every layer had a fallback.
 *
 * `src/features/battle/__tests__/setup.test.ts` pins `usableLayout` itself.
 * These stay on the symptom that was reported: what the popover counts after
 * the layout has been through the REAL reducer, which is the only place the
 * silent wipe actually happened.
 */
import { describe, expect, it, vi } from 'vitest';

import { FLEET_SHIP_COUNT } from '../../src/engine/fleet';
import { createMatch, projectView, reduce } from '../../src/engine/match';
import { autoPlaceFleet, validateArsenalPlacement } from '../../src/engine/placement';
import { createRng } from '../../src/engine/rng';
import type { ArsenalItem, Ship } from '../../src/engine/types';
import {
  buildBattleSetup,
  type PlacementSnapshot,
  type ProfileSnapshot,
} from '../../src/features/battle/setup';

vi.mock('../../src/net/match-client', () => ({
  useMatchClient: { getState: () => ({ matchId: null, you: null, opponent: null, mode: null }) },
}));

const PROFILE: ProfileSnapshot = {
  name: 'Ayush',
  rankPoints: 0,
  avatarId: 1,
  avatarColor: '#3E2FB8',
  countryCode: 'IN',
};

/** A fleet plus the kit a player actually buys: two strikes and placed defences. */
function placedLoadout(seed: number): { ships: Ship[]; arsenal: ArsenalItem[] } {
  const ships = autoPlaceFleet(createRng(seed));
  const arsenal: ArsenalItem[] = [
    { id: 'buy-atomic', kind: 'atomicBomber' },
    { id: 'buy-torpedo', kind: 'torpedoBomber' },
  ];
  // Placed the way the placement screen places them: on cells the engine
  // accepts for THIS fleet, which is exactly what made them illegal on a
  // fleet the player never arranged.
  for (const [n, kind] of (['mine', 'mine', 'aaGun', 'radar'] as const).entries()) {
    for (let index = 0; index < 100; index++) {
      const item: ArsenalItem = {
        id: `buy-${kind}-${n}`,
        kind,
        at: { r: Math.floor(index / 10), c: index % 10 },
      };
      if (validateArsenalPlacement({ ships, arsenal, marks: {} }, item).ok) {
        arsenal.push(item);
        break;
      }
    }
  }
  return { ships, arsenal };
}

function snapshot(over: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  const { ships, arsenal } = placedLoadout(7);
  return {
    mode: 'ai',
    difficulty: 'normal',
    ruleset: 'advanced',
    ships,
    arsenal,
    captainId: null,
    seaId: 'open',
    playerOneShips: null,
    playerTwoShips: null,
    playerOneArsenal: null,
    playerTwoArsenal: null,
    playerOneCaptain: null,
    playerTwoCaptain: null,
    playerOneName: 'Player 1',
    playerTwoName: 'Player 2',
    ...over,
  };
}

/** What LocalMatch does at start(): both layouts through the real reducer. */
function startMatch(setup: ReturnType<typeof buildBattleSetup>) {
  let state = createMatch({
    id: 'test',
    mode: setup.ruleset,
    seed: setup.seed,
    playerIds: [setup.one.id, setup.two.id],
  });
  for (const side of [setup.one, setup.two]) {
    const result = reduce(state, {
      type: 'SUBMIT_LAYOUT',
      playerId: side.id,
      ships: side.ships,
      arsenal: side.arsenal,
    });
    expect(
      result.events.filter((event) => event.type === 'REJECTED'),
      `the engine rejected ${side.id}'s layout — LocalMatch would wipe its arsenal here`,
    ).toEqual([]);
    state = result.state;
  }
  return state;
}

/** Exactly what BattleArsenalPopover counts for each weapon card. */
function weaponsInHand(state: ReturnType<typeof startMatch>, playerId: string) {
  return projectView(state, playerId).you.board.arsenal.filter(
    (item) => !item.used && !item.destroyed,
  );
}

describe('the weapon list is not empty', () => {
  it('every purchased weapon survives into the match view', () => {
    const placement = snapshot();

    const state = startMatch(buildBattleSetup(placement, PROFILE, 42));

    const usable = weaponsInHand(state, 'p1');
    expect(usable).toHaveLength(placement.arsenal.length);
    expect(usable.some((item) => item.kind === 'atomicBomber')).toBe(true);
    expect(usable.some((item) => item.kind === 'mine')).toBe(true);
  });

  it('plays the board that was arranged, not a random one', () => {
    const placement = snapshot();

    const setup = buildBattleSetup(placement, PROFILE, 42);
    const state = startMatch(setup);

    expect(setup.one.ships).toEqual(placement.ships);
    expect(projectView(state, 'p1').you.board.ships.map((s) => s.origin)).toEqual(
      placement.ships.map((s) => s.origin),
    );
  });

  it('does not hinge on the fleet being ten ships — the table defines eight', () => {
    // The stale `ships.length === 10` is precisely this assertion turned false.
    expect(FLEET_SHIP_COUNT).toBe(8);
    const placement = snapshot();
    expect(placement.ships).toHaveLength(FLEET_SHIP_COUNT);

    const state = startMatch(buildBattleSetup(placement, PROFILE, 42));

    expect(weaponsInHand(state, 'p1').length).toBeGreaterThan(0);
  });

  it('arms both hot-seat players from their own purchases', () => {
    const one = placedLoadout(3);
    const two = placedLoadout(11);

    const state = startMatch(
      buildBattleSetup(
        snapshot({
          mode: 'hotseat',
          playerOneShips: one.ships,
          playerOneArsenal: one.arsenal,
          playerTwoShips: two.ships,
          playerTwoArsenal: two.arsenal,
        }),
        PROFILE,
        42,
      ),
    );

    expect(weaponsInHand(state, 'p1')).toHaveLength(one.arsenal.length);
    expect(weaponsInHand(state, 'p2')).toHaveLength(two.arsenal.length);
  });

  it('leaves the AI able to fight back', () => {
    const state = startMatch(buildBattleSetup(snapshot(), PROFILE, 42));

    expect(weaponsInHand(state, 'ai').length).toBeGreaterThan(0);
  });
});

describe('an illegal layout is replaced whole, never half', () => {
  /**
   * usableLayout's contract (see setup.ts): ships and arsenal travel together
   * and are replaced together. Keeping the arranged fleet but dropping only
   * the items that clash — or worse, keeping items validated against a fleet
   * that is no longer on the board — is how the wipe above stayed invisible.
   */
  it('takes a fresh fleet AND no arsenal when an item cannot be placed', () => {
    const { ships } = placedLoadout(7);
    const arsenal: ArsenalItem[] = [
      { id: 'buy-atomic', kind: 'atomicBomber' },
      // Legal to ask for, impossible to place: straight on top of a ship.
      { id: 'bad-mine', kind: 'mine', at: (ships[0] as Ship).origin },
    ];

    const setup = buildBattleSetup(snapshot({ ships, arsenal }), PROFILE, 42);

    expect(setup.one.arsenal).toEqual([]);
    expect(setup.one.ships).not.toEqual(ships);
    expect(setup.one.ships).toHaveLength(FLEET_SHIP_COUNT);
    startMatch(setup); // and the reducer takes it
  });

  it('still starts a playable match when the fleet itself is unusable', () => {
    const short = autoPlaceFleet(createRng(7)).slice(0, 3);

    const setup = buildBattleSetup(snapshot({ ships: short, arsenal: [] }), PROFILE, 42);

    expect(setup.one.ships).toHaveLength(FLEET_SHIP_COUNT);
    expect(startMatch(setup).phase).toBe('playing');
  });
});
