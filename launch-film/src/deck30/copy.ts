/**
 * Deck30 — every string on screen. Edit here; nothing else holds copy.
 *
 * Two voices of type (the trailer's system): cards in Anton, ALL CAPS, max 3 words; "Your move." in Inter Tight,
 * sentence case; the game's own font (Bitter) only for in-game names. Every name and number exists in the game:
 * fleet = src/engine/fleet.ts + src/features/store/catalog.ts, weapons = src/features/arsenal/catalog.ts,
 * board = src/engine/types.ts (10 x 10, rows A–J, columns 1–10). No quotes, no claims, no stats.
 */

export const REAL = ['REAL PLAYERS.', 'REAL BATTLES.'] as const;

/** One label per face of the flipping glass screen. */
export const FLIP = {
  base: 'BUILD YOUR BASE.',
  fleet: 'ASSEMBLE YOUR FLEET.',
  arsenal: 'LOAD YOUR ARSENAL.',
  rival: 'FIND YOUR RIVAL.',
} as const;

/** Spelled in lit board cells by the lock-ons (pixel letters in src/deck30/components/LockOnGrid.tsx). */
export const FIRE = 'FIRE';

export const DROP = { hit: 'HIT.', sunk: 'SUNK.' } as const;

export const VICTORY = 'VICTORY.';

/** The bento tiles, in snap order (timeline TILE_BEATS). The game's own names for these screens. */
export const BENTO = ['LEADERBOARD', 'BUY POINTS', 'SELL POINTS', 'STORE', 'WALLET'] as const;

/** In-game names (the game's own font). Fleet: src/engine/fleet.ts lengths, store catalog names. */
export const FLEET = [
  { art: 'battleship', name: 'Battleship', len: 4 },
  { art: 'cruiser', name: 'Cruiser', len: 3 },
  { art: 'destroyer', name: 'Destroyer', len: 2 },
  { art: 'boat', name: 'Patrol Boat', len: 1 },
] as const;

/** The carousel; the last one is the strongest and lands centre, glowing (ARSENAL_NAMES / ARSENAL_INFO). */
export const ARSENAL = [
  { art: 'attack/torpedo-bomber', name: 'Torpedo Bomber' },
  { art: 'attack/double-torpedo', name: 'Double Torpedo Bomber' },
  { art: 'defence/radar', name: 'Radar' },
  { art: 'attack/submarine', name: 'Submarine' },
  { art: 'attack/bomber', name: 'Bomber' },
  { art: 'attack/atomic-bomber', name: 'Atomic Bomber', info: 'Destroys every cell in a 3x3 area.' },
] as const;

/** Pieces that snap around the base screen: defence planted on your own board + the Port City. */
export const BASE_PIECES = [
  { art: 'art/defence/aa-gun.png', name: 'AA Gun' },
  { art: 'art/defence/mine.png', name: 'Mine' },
  { art: 'port/buildings/lighthouse.png' },
  { art: 'port/buildings/shipyard.png' },
  { art: 'port/buildings/harbour_defence.png' },
] as const;

/** Board coordinates, as the game labels them. */
export const BOARD = { rows: 'ABCDEFGHIJ', cols: 10 } as const;

export const END = { line: 'Your move.' } as const;
