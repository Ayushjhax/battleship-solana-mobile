/**
 * The tutorial as data. Fourteen beats from the reference screenshots
 * (IMG_9744 … IMG_9768), driven over the REAL battle and placement screens by
 * TutorialOverlay. Nothing here is a fake game: the engine stays honest and
 * the outcomes are rigged by a fixed enemy layout plus a fixed shot script.
 *
 *   F5 must hit, E5 must sink, H8 must miss, the bomber at C4 must land one
 *   hit, the second bomber must fly into an AA row — so the enemy fleet below
 *   is built to make exactly that happen.
 */
import type { ArsenalItem, Coord, MatchEvent, Ship } from '@engine/types';

import type { BattleSetup } from '@/state/battle';

export type Side = 'left' | 'right';

export type Requirement =
  | { kind: 'tap-cell'; board: 'enemy' | 'own' | 'placement'; coord: Coord }
  | { kind: 'tap-element'; ref: string }
  | { kind: 'drag-ship'; shipId: string; to: Coord }
  | { kind: 'place-item'; itemKind: ArsenalItem['kind'] }
  | { kind: 'wait'; ms: number };

export interface Step {
  id: string;
  /** Which screen this beat lives on. The route swaps screens on the boundary. */
  screen: 'battle' | 'placement';
  say?: { text: string; side: Side; voice?: number };
  spotlight?: { target: 'cell' | 'element'; ref: string };
  require?: Requirement;
  /** Events this beat expects the engine to produce — checked, never faked. */
  forceOutcome?: MatchEvent['type'][];
  /** An action the driver performs on the player's behalf when the beat starts. */
  auto?: 'opponent-fires-I7' | 'second-bomber-run';
  /** Screen preparation when the beat starts. */
  prepare?: 'clear-fleet';
  /** Text used when the player taps the wrong thing. */
  nudge?: string;
}

export const YOU = 'you';
export const FOE = 'foe';

/** A1 … J10 -> {r, c}. */
export function cell(label: string): Coord {
  const r = label.charCodeAt(0) - 65;
  const c = Number(label.slice(1)) - 1;
  return { r, c };
}

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

/** Your fleet, exactly as IMG_9744 draws it. I7 is open water. */
export const TUTORIAL_OWN_FLEET: Ship[] = [
  ship('destroyer-1', 'destroyer', 2, 'A4', 'h'),
  ship('destroyer-2', 'destroyer', 2, 'B1', 'v'),
  ship('destroyer-3', 'destroyer', 2, 'B10', 'v'),
  ship('battleship-1', 'battleship', 4, 'C3', 'h'),
  ship('cruiser-1', 'cruiser', 3, 'E7', 'v'),
  ship('cruiser-2', 'cruiser', 3, 'G1', 'h'),
  ship('boat-1', 'boat', 1, 'F9', 'h'),
  ship('boat-2', 'boat', 1, 'H10', 'h'),
  ship('boat-3', 'boat', 1, 'I1', 'h'),
  ship('boat-4', 'boat', 1, 'J8', 'h'),
];

/**
 * The enemy fleet the script needs: a destroyer standing on E5-F5, a second
 * destroyer lying on C5-C6 under the bomber's T, open water at H8, and an AA
 * gun on row H for the second bomber run.
 */
export const TUTORIAL_ENEMY_FLEET: Ship[] = [
  ship('battleship-1', 'battleship', 4, 'A1', 'h'),
  ship('cruiser-1', 'cruiser', 3, 'J1', 'h'),
  ship('cruiser-2', 'cruiser', 3, 'J8', 'h'),
  ship('destroyer-1', 'destroyer', 2, 'E5', 'v'),
  ship('destroyer-2', 'destroyer', 2, 'C5', 'h'),
  ship('destroyer-3', 'destroyer', 2, 'G1', 'v'),
  ship('boat-1', 'boat', 1, 'A8', 'h'),
  ship('boat-2', 'boat', 1, 'E9', 'h'),
  ship('boat-3', 'boat', 1, 'H6', 'h'),
  ship('boat-4', 'boat', 1, 'C9', 'h'),
];

export const TUTORIAL_ENEMY_ARSENAL: ArsenalItem[] = [
  { id: 'foe-gun', kind: 'aaGun', at: cell('H10') },
];

/** Two bombers: one for the lesson, one to be shot down. */
export const TUTORIAL_OWN_ARSENAL: ArsenalItem[] = [
  { id: 'bomber-1', kind: 'bomber' },
  { id: 'bomber-2', kind: 'bomber' },
];

/** The seed is chosen so the coin flip gives you the first turn. */
export const TUTORIAL_SEED = 7;

export function buildTutorialSetup(profile: {
  name: string;
  avatarId: number;
  avatarColor: string;
  countryCode: string;
}): BattleSetup {
  return {
    mode: 'tutorial',
    ruleset: 'advanced',
    seed: TUTORIAL_SEED,
    one: {
      id: YOU,
      name: profile.name || 'Player',
      points: 10,
      avatarId: profile.avatarId,
      avatarColor: profile.avatarColor,
      countryCode: profile.countryCode,
      ships: TUTORIAL_OWN_FLEET,
      arsenal: TUTORIAL_OWN_ARSENAL,
    },
    two: {
      id: FOE,
      name: 'The Captain',
      points: 13365,
      avatarId: 4,
      avatarColor: '#3A3A3A',
      countryCode: 'RU',
      ships: TUTORIAL_ENEMY_FLEET,
      arsenal: TUTORIAL_ENEMY_ARSENAL,
    },
    difficulty: 'normal',
  };
}

export const STEPS: readonly Step[] = [
  {
    id: '1',
    screen: 'battle',
    say: { text: "Welcome aboard. Let's sink something.", side: 'right', voice: 1 },
    require: { kind: 'wait', ms: 2400 },
  },
  {
    id: '2',
    screen: 'battle',
    say: { text: 'Your turn. Tap a square on the right to fire.', side: 'right', voice: 2 },
    spotlight: { target: 'cell', ref: 'enemy:F5' },
    require: { kind: 'tap-cell', board: 'enemy', coord: cell('F5') },
    forceOutcome: ['HIT'],
    nudge: 'Not there — the square I am pointing at.',
  },
  {
    id: '3',
    screen: 'battle',
    say: { text: 'A hit. That means you fire again.', side: 'left', voice: 3 },
    require: { kind: 'wait', ms: 2000 },
  },
  {
    id: '4',
    screen: 'battle',
    spotlight: { target: 'cell', ref: 'enemy:E5' },
    require: { kind: 'tap-cell', board: 'enemy', coord: cell('E5') },
    forceOutcome: ['HIT', 'SUNK', 'AUTO_REVEAL'],
    say: {
      text: 'Sunk. The squares around a wreck are always empty, so we mark them for you.',
      side: 'left',
      voice: 4,
    },
    nudge: 'Finish it off — the square just above.',
  },
  {
    id: '5',
    screen: 'battle',
    spotlight: { target: 'cell', ref: 'enemy:H8' },
    require: { kind: 'tap-cell', board: 'enemy', coord: cell('H8') },
    forceOutcome: ['MISS', 'TURN_CHANGED'],
    say: { text: 'A miss ends your turn.', side: 'left', voice: 5 },
    nudge: 'Try the square I am pointing at.',
  },
  {
    id: '6',
    screen: 'battle',
    auto: 'opponent-fires-I7',
    say: { text: "They've missed. Back to you.", side: 'left', voice: 6 },
    require: { kind: 'wait', ms: 1800 },
  },
  {
    id: '7',
    screen: 'battle',
    say: { text: "You're not limited to one square at a time.", side: 'right', voice: 7 },
    spotlight: { target: 'element', ref: 'arsenal-tab' },
    require: { kind: 'tap-element', ref: 'arsenal-tab' },
    nudge: 'Open the Arsenal — the red tab at the top.',
  },
  {
    id: '8',
    screen: 'battle',
    say: { text: 'A bomber hits three squares at once.', side: 'right', voice: 8 },
    spotlight: { target: 'element', ref: 'card-bomber' },
    require: { kind: 'tap-element', ref: 'card-bomber' },
    nudge: 'Pick the Bomber card.',
  },
  {
    id: '9',
    screen: 'battle',
    say: { text: 'Pick your target.', side: 'right' },
    spotlight: { target: 'cell', ref: 'enemy:C4' },
    require: { kind: 'tap-cell', board: 'enemy', coord: cell('C4') },
    forceOutcome: ['ARSENAL_USED', 'HIT'],
    nudge: 'Drop it on the square I am pointing at.',
  },
  {
    id: '10',
    screen: 'battle',
    auto: 'second-bomber-run',
    say: {
      text: "Their anti-air covers that row. Aircraft can't cross it.",
      side: 'right',
      voice: 10,
    },
    forceOutcome: ['AIRCRAFT_DOWNED'],
    require: { kind: 'wait', ms: 2600 },
  },
  {
    id: '11',
    screen: 'placement',
    prepare: 'clear-fleet',
    say: { text: 'Before every battle, you set your own fleet.', side: 'right', voice: 11 },
    spotlight: { target: 'element', ref: 'ship-cruiser-1' },
    require: { kind: 'drag-ship', shipId: 'cruiser-1', to: cell('C3') },
    nudge: 'Drag the cruiser onto C3.',
  },
  {
    id: '12',
    screen: 'placement',
    say: { text: 'Tap a ship to turn it.', side: 'right', voice: 12 },
    spotlight: { target: 'element', ref: 'ship-cruiser-1' },
    require: { kind: 'tap-element', ref: 'ship-cruiser-1' },
    nudge: 'Tap the cruiser you just placed.',
  },
  {
    id: '13',
    screen: 'placement',
    say: {
      text: 'And you can buy defences. You can buy more mid-battle too.',
      side: 'left',
      voice: 13,
    },
    spotlight: { target: 'element', ref: 'card-aagun' },
    require: { kind: 'tap-element', ref: 'card-aagun' },
    nudge: 'The AA Gun card, on the right.',
  },
  {
    id: '13b',
    screen: 'placement',
    say: { text: 'Now put it somewhere on your board.', side: 'left' },
    spotlight: { target: 'element', ref: 'board-placement' },
    require: { kind: 'place-item', itemKind: 'aaGun' },
    nudge: 'Tap any free square on your board.',
  },
  {
    id: '14',
    screen: 'placement',
    say: { text: "That's everything. Go win one.", side: 'left', voice: 14 },
    require: { kind: 'wait', ms: 2000 },
  },
];

/** The engine actions the driver performs for the automatic beats. */
export const AUTO_ACTIONS = {
  'opponent-fires-I7': { type: 'FIRE', playerId: FOE, at: cell('I7') },
  'second-bomber-run': { type: 'USE_ARSENAL', playerId: YOU, itemId: 'bomber-2', at: cell('H3') },
} as const;
