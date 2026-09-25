/**
 * What the screens say about each arsenal item — names, the one-line rule,
 * which group it belongs to and the cells its effect diagram marks. The
 * rules themselves are the engine's (src/engine/arsenal.ts); this is copy.
 *
 * The two groups are how the shop is laid out, so a player can tell at a
 * glance what a purchase does:
 *   attack   bought now, waits in the Arsenal and is fired at the enemy
 *            board during the battle (the aircraft and the submarine)
 *   defence  bought now and placed on your own board straight away, where it
 *            works on its own (AA gun, mine) or is switched on from the
 *            Arsenal (radar) — every one of them can be hit
 */
import type { ArsenalKind } from '@engine/types';

export const ARSENAL_NAMES: Record<ArsenalKind, string> = {
  torpedoBomber: 'Torpedo Bomber',
  doubleTorpedoBomber: 'Double Torpedo Bomber',
  bomber: 'Bomber',
  atomicBomber: 'Atomic Bomber',
  aaGun: 'AA Gun',
  radar: 'Radar',
  mine: 'Mine',
  submarine: 'Submarine',
};

/** The shop card's name, where "Double Torpedo Bomber" will not fit. */
export const CARD_NAMES: Record<ArsenalKind, string> = {
  torpedoBomber: 'Torpedo',
  doubleTorpedoBomber: 'Double Tap',
  bomber: 'Bomber',
  atomicBomber: 'Atomic Bomb',
  aaGun: 'AA Gun',
  radar: 'Radar',
  mine: 'Mine',
  submarine: 'Submarine',
};

export const ARSENAL_INFO: Record<ArsenalKind, string> = {
  torpedoBomber: 'Runs along one row and hits the first intact ship cell.',
  doubleTorpedoBomber: 'Runs two torpedoes along two rows side by side.',
  bomber: 'Bombs the target, the cell right of it and the cell below it.',
  atomicBomber: 'Destroys every cell in a 3x3 area.',
  aaGun: 'Shoots down any enemy aircraft flying through its row.',
  mine: "The enemy's turn ends the moment they hit it.",
  radar: 'Reports how many ship cells sit in a 3x3 area. Not which ones.',
  submarine: 'Surfaces on a free cell and fires one torpedo up and one down.',
};

export type ArsenalGroup = 'attack' | 'defence';

export const ARSENAL_GROUP: Record<ArsenalKind, ArsenalGroup> = {
  torpedoBomber: 'attack',
  doubleTorpedoBomber: 'attack',
  bomber: 'attack',
  atomicBomber: 'attack',
  submarine: 'attack',
  aaGun: 'defence',
  mine: 'defence',
  radar: 'defence',
};

/** The shop's order: the attack group, then the defence group. */
export const SHOP_ORDER: readonly ArsenalKind[] = [
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'submarine',
  'aaGun',
  'mine',
  'radar',
];

/** What the battle's "Choose a weapon" list offers: what can be aimed. */
export const WEAPON_ORDER: readonly ArsenalKind[] = [
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'radar',
  'submarine',
];

/** The battle's weapon rows: room for two words. */
export const WEAPON_NAMES: Record<ArsenalKind, string> = {
  ...ARSENAL_NAMES,
  doubleTorpedoBomber: 'Double Torpedo',
};

/** How each group is explained where it is shown. */
export const GROUP_COPY: Record<ArsenalGroup, { title: string; line: string }> = {
  attack: { title: 'Attack', line: 'fired at the enemy during battle' },
  defence: { title: 'Defence', line: 'placed on your board now' },
};

/** The cells an effect diagram hatches, on its 5 x 5 grid, [row, col]. */
export function diagramCells(kind: ArsenalKind): readonly [number, number][] {
  switch (kind) {
    case 'torpedoBomber':
    case 'aaGun':
      return [0, 1, 2, 3, 4].map((c) => [2, c] as [number, number]);
    case 'doubleTorpedoBomber':
      return [1, 2].flatMap((r) => [0, 1, 2, 3, 4].map((c) => [r, c] as [number, number]));
    case 'bomber':
      return [
        [2, 2],
        [2, 3],
        [3, 2],
      ];
    case 'atomicBomber':
    case 'radar':
      return [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) => [r, c] as [number, number]));
    case 'mine':
      return [[2, 2]];
    case 'submarine':
      return [0, 1, 2, 3, 4].map((r) => [r, 2] as [number, number]);
  }
}
