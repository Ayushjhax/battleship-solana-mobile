/**
 * What the store sells: every item in three colours, priced in coins. The
 * prices are the mockup's; a colour doesn't change the price. Unlocking is
 * collecting only for now — nothing here changes what the battle draws.
 * Pure data (no art), so it runs under vitest; the art is STORE_ITEM_ART.
 */
export const STORE_COLOURS = ['crimson', 'emerald', 'purple'] as const;
export type StoreColour = (typeof STORE_COLOURS)[number];

export const STORE_SECTIONS = ['attack', 'boards', 'defence', 'fleet'] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number];

export interface StoreItem {
  readonly key: string;
  readonly section: StoreSection;
  readonly name: string;
  readonly price: number;
}

export const STORE_ITEMS: readonly StoreItem[] = [
  { key: 'bomber', section: 'attack', name: 'Bomber', price: 200 },
  { key: 'torpedo-bomber', section: 'attack', name: 'Torpedo Bomber', price: 300 },
  { key: 'double-torpedo', section: 'attack', name: 'Double Torpedo', price: 400 },
  { key: 'submarine', section: 'attack', name: 'Submarine', price: 350 },
  { key: 'atomic-bomber', section: 'attack', name: 'Atomic Bomber', price: 450 },
  { key: 'board', section: 'boards', name: 'Battle Board', price: 300 },
  { key: 'aa-gun', section: 'defence', name: 'AA Gun', price: 250 },
  { key: 'mine', section: 'defence', name: 'Mine', price: 200 },
  { key: 'radar', section: 'defence', name: 'Radar', price: 300 },
  { key: 'battleship', section: 'fleet', name: 'Battleship', price: 500 },
  { key: 'boat', section: 'fleet', name: 'Patrol Boat', price: 200 },
  { key: 'cruiser', section: 'fleet', name: 'Cruiser', price: 400 },
  { key: 'destroyer', section: 'fleet', name: 'Destroyer', price: 350 },
];

export const COLOUR_NAME: Readonly<Record<StoreColour, string>> = {
  crimson: 'Crimson',
  emerald: 'Emerald',
  purple: 'Purple',
};

export const SECTION_NAME: Readonly<Record<StoreSection, string>> = {
  attack: 'Attack',
  boards: 'Boards',
  defence: 'Defence',
  fleet: 'Fleet',
};

/** What a purchase is recorded as: `crimson:bomber`. */
export function unlockId(colour: StoreColour, key: string): string {
  return `${colour}:${key}`;
}

export interface Unlock {
  readonly id: string;
  readonly colour: StoreColour;
  readonly item: StoreItem;
}

/** Recorded ids back to items, in catalogue order; ids the catalogue no longer has are skipped. */
export function unlocksFrom(ids: readonly string[]): Unlock[] {
  const owned = new Set(ids);
  const out: Unlock[] = [];
  for (const colour of STORE_COLOURS) {
    for (const item of STORE_ITEMS) {
      const id = unlockId(colour, item.key);
      if (owned.has(id)) out.push({ id, colour, item });
    }
  }
  return out;
}

export const STORE_ITEM_COUNT = STORE_ITEMS.length * STORE_COLOURS.length;
