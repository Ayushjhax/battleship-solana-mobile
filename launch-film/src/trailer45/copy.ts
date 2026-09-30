/**
 * Trailer45 — every string on screen. Edit here; nothing else holds copy.
 * Names and numbers must exist in the game (src/features/arsenal/catalog.ts,
 * src/features/store/catalog.ts, src/engine/fleet.ts). No quotes, no claims.
 */

/** The four hero cards, in order (photos in cast.ts HEROES). */
export const CAST_LABELS = ['THE ADMIRAL.', 'THE TACTICIAN.', 'THE HUNTER.', 'THE CAPTAIN.'] as const;

export const CLAIM = ['REAL PLAYERS.', 'REAL BATTLES.'] as const;

export const STING = 'AN EMPIRE OF BITS ORIGINAL';

export const CARDS = {
  build: 'BUILD YOUR BASE.',
  fleet: 'ASSEMBLE YOUR FLEET.',
  arsenal: 'LOAD YOUR ARSENAL.',
  rival: 'FIND YOUR RIVAL.',
  fire: 'FIRE.',
  hit: 'HIT.',
  sunk: 'SUNK.',
  victory: 'VICTORY.',
} as const;

export const ECONOMY = ['BUY POINTS.', 'SELL POINTS.', 'GEAR UP.', 'CLIMB.'] as const;

/** In-game names (the game's own font). Fleet = src/engine/fleet.ts, names = store catalog. */
export const FLEET = [
  { art: 'battleship', name: 'Battleship', count: 1, len: 4 },
  { art: 'cruiser', name: 'Cruiser', count: 2, len: 3 },
  { art: 'destroyer', name: 'Destroyer', count: 3, len: 2 },
  { art: 'boat', name: 'Patrol Boat', count: 2, len: 1 },
] as const;

/** Carousel order; the last one is the strongest and lands centre (ARSENAL_NAMES / ARSENAL_INFO). */
export const ARSENAL = [
  { art: 'attack/torpedo-bomber', name: 'Torpedo Bomber' },
  { art: 'defence/aa-gun', name: 'AA Gun' },
  { art: 'attack/double-torpedo', name: 'Double Torpedo Bomber' },
  { art: 'defence/radar', name: 'Radar' },
  { art: 'attack/submarine', name: 'Submarine' },
  { art: 'defence/mine', name: 'Mine' },
  { art: 'attack/bomber', name: 'Bomber' },
  { art: 'attack/atomic-bomber', name: 'Atomic Bomber', info: 'Destroys every cell in a 3x3 area.' },
] as const;

/** Defence pieces planted on your own board (src/engine/arsenal.ts placement). */
export const DEFENCE = [
  { art: 'defence/aa-gun', name: 'AA Gun' },
  { art: 'defence/mine', name: 'Mine' },
] as const;

export const END = {
  line: 'Your move.',
} as const;
