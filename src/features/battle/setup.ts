/**
 * Builds a BattleSetup from what the placement screen left behind and the
 * player's profile. Pure: the screen calls it once on mount.
 */
import { validateArsenalPlacement } from '@engine/placement';
import { autoPlaceFleet } from '@engine/placement';
import { createRng, type Rng } from '@engine/rng';
import type { ArsenalItem, Board, Coord, MatchMode, Ship } from '@engine/types';

import type { BattleMode, BattleSetup, Combatant } from '@/state/battle';

export interface PlacementSnapshot {
  readonly mode: BattleMode;
  readonly ruleset: MatchMode;
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly playerOneShips: readonly Ship[] | null;
  readonly playerTwoShips: readonly Ship[] | null;
  readonly playerOneArsenal: readonly ArsenalItem[] | null;
  readonly playerTwoArsenal: readonly ArsenalItem[] | null;
}

export interface ProfileSnapshot {
  readonly name: string;
  readonly rankPoints: number;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string;
}

/** A modest kit for the AI in advanced mode: defences on free cells, two strikes. */
export function aiKit(rng: Rng, ships: readonly Ship[]): ArsenalItem[] {
  const items: ArsenalItem[] = [
    { id: 'ai-atomic', kind: 'atomicBomber' },
    { id: 'ai-torpedo', kind: 'torpedoBomber' },
  ];
  const board: Board = { ships, arsenal: [], marks: {} };
  const wanted: ArsenalItem['kind'][] = ['mine', 'mine', 'aaGun'];
  wanted.forEach((kind, n) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const at: Coord = { r: rng.int(10), c: rng.int(10) };
      const item: ArsenalItem = { id: `ai-${kind}-${n}`, kind, at };
      if (validateArsenalPlacement({ ...board, arsenal: items }, item).ok) {
        items.push(item);
        break;
      }
    }
  });
  return items;
}

export function buildBattleSetup(
  placement: PlacementSnapshot,
  profile: ProfileSnapshot,
  seed: number,
): BattleSetup {
  const rng = createRng(seed);
  const mode: BattleMode = placement.mode === 'online' ? 'ai' : placement.mode;
  if (placement.mode === 'online')
    console.warn('[battle] online play lands in P13; playing the AI instead');

  const myShips = (placement.mode === 'hotseat' ? placement.playerOneShips : placement.ships) ?? [];
  const myArsenal =
    (placement.mode === 'hotseat' ? placement.playerOneArsenal : placement.arsenal) ?? [];
  const advanced = placement.ruleset === 'advanced';

  const one: Combatant = {
    id: 'p1',
    name: placement.mode === 'hotseat' ? 'Player 1' : profile.name || 'Player',
    points: profile.rankPoints,
    avatarId: profile.avatarId,
    avatarColor: profile.avatarColor,
    countryCode: profile.countryCode,
    ships: myShips.length === 10 ? myShips : autoPlaceFleet(rng),
    arsenal: advanced ? myArsenal : [],
  };

  let two: Combatant;
  if (placement.mode === 'hotseat') {
    const ships = placement.playerTwoShips ?? [];
    two = {
      id: 'p2',
      name: 'Player 2',
      points: 0,
      avatarId: 2,
      avatarColor: '#8A5A2B',
      countryCode: profile.countryCode,
      ships: ships.length === 10 ? ships : autoPlaceFleet(rng),
      arsenal: advanced ? (placement.playerTwoArsenal ?? []) : [],
    };
  } else {
    const ships = autoPlaceFleet(rng);
    two = {
      id: 'ai',
      name: 'Berhan',
      points: 13365,
      avatarId: 4,
      avatarColor: '#3A3A3A',
      countryCode: 'RU',
      ships,
      arsenal: advanced ? aiKit(rng, ships) : [],
    };
  }

  return { mode, ruleset: placement.ruleset, seed, one, two, difficulty: 'normal' };
}
