/**
 * The scripted demo match (P17): an AI opponent on 'easy', fixed fleets, a
 * fixed seed. Nothing is faked — the engine plays it straight — the rig is
 * that the presenter KNOWS the enemy board (docs/DEMO.md):
 *
 *   - Enemy battleship along row B (B2-B5): four quick hits and a sink.
 *   - Enemy AA gun at E9: a bomber dropped anywhere on rows D-F (its 3x3
 *     crosses row E) is shot down — the set piece, the plane spirals.
 *   - Enemy destroyer at H2-H3 and a boat at J10 for the closing shots.
 *   - Your kit: two bombers, a torpedo bomber, an AA gun at E9 and a mine
 *     at H8 — the AI's shots will find one of them over a long game.
 *
 * The seed is chosen so you have the first turn.
 */
import type { ArsenalItem, Ship } from '@engine/types';

import type { BattleSetup } from '@/state/battle';
import { cell } from '@/tutorial/script';

const ship = (
  id: string,
  cls: Ship['class'],
  len: number,
  at: string,
  o: Ship['orientation'],
): Ship => ({
  id,
  class: cls,
  len,
  origin: cell(at),
  orientation: o,
  hits: [],
});

export const DEMO_OWN_FLEET: Ship[] = [
  ship('battleship-1', 'battleship', 4, 'A1', 'h'),
  ship('cruiser-1', 'cruiser', 3, 'C1', 'h'),
  ship('cruiser-2', 'cruiser', 3, 'C6', 'h'),
  ship('destroyer-1', 'destroyer', 2, 'F1', 'v'),
  ship('destroyer-2', 'destroyer', 2, 'F4', 'h'),
  ship('destroyer-3', 'destroyer', 2, 'I5', 'h'),
  ship('boat-1', 'boat', 1, 'A10', 'h'),
  ship('boat-2', 'boat', 1, 'J1', 'h'),
];

export const DEMO_OWN_ARSENAL: ArsenalItem[] = [
  { id: 'demo-bomber-1', kind: 'bomber' },
  { id: 'demo-bomber-2', kind: 'bomber' },
  { id: 'demo-torpedo', kind: 'torpedoBomber' },
  { id: 'demo-gun', kind: 'aaGun', at: cell('E9') },
  { id: 'demo-mine', kind: 'mine', at: cell('H8') },
];

export const DEMO_ENEMY_FLEET: Ship[] = [
  ship('battleship-1', 'battleship', 4, 'B2', 'h'),
  ship('cruiser-1', 'cruiser', 3, 'D1', 'v'),
  ship('cruiser-2', 'cruiser', 3, 'J4', 'h'),
  ship('destroyer-1', 'destroyer', 2, 'H2', 'h'),
  ship('destroyer-2', 'destroyer', 2, 'B8', 'v'),
  ship('destroyer-3', 'destroyer', 2, 'G6', 'v'),
  ship('boat-1', 'boat', 1, 'J10', 'h'),
  ship('boat-2', 'boat', 1, 'E4', 'h'),
];

export const DEMO_ENEMY_ARSENAL: ArsenalItem[] = [
  { id: 'foe-gun', kind: 'aaGun', at: cell('E9') },
  { id: 'foe-mine', kind: 'mine', at: cell('A7') },
];

export const DEMO_SEED = 7;

export function buildDemoSetup(profile: {
  name: string;
  avatarId: number;
  avatarColor: string;
  countryCode: string;
  rankPoints: number;
}): BattleSetup {
  return {
    mode: 'ai',
    ruleset: 'advanced',
    seed: DEMO_SEED,
    one: {
      id: 'p1',
      name: profile.name || 'Player',
      points: profile.rankPoints,
      avatarId: profile.avatarId,
      avatarColor: profile.avatarColor,
      countryCode: profile.countryCode,
      ships: DEMO_OWN_FLEET,
      arsenal: DEMO_OWN_ARSENAL,
    },
    two: {
      id: 'ai',
      name: 'Berhan',
      points: 13365,
      avatarId: 4,
      avatarColor: '#3A3A3A',
      countryCode: 'RU',
      ships: DEMO_ENEMY_FLEET,
      arsenal: DEMO_ENEMY_ARSENAL,
    },
    difficulty: 'easy',
  };
}
