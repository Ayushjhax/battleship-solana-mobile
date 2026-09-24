/**
 * Cosmetics — part-03 §1, §2.
 *
 * "The game is drawn with a pen on paper. So the cosmetics are **pens, ink and
 *  paper** — the most on-brand store a game like this can have, and **not one
 *  point of power**."
 *
 * THE HARD RULE FOR THIS PART, from the instruction that commissioned it:
 * *"zero gameplay effect. If any cosmetic changes a hitbox, a duration that
 * matters or an information boundary, stop and report instead of shipping
 * it."* Two items hit that rule during Part 2's survey and were held open as
 * DECISIONS D11 and D12; both are now resolved, and the reasoning is in
 * `./contrast.ts` (D11) and `./visibility.ts` (D12).
 *
 * PURITY: no React, no I/O, no `Date.now()`, no `Math.random()`.
 */

export const COSMETIC_SLOTS = [
  'fleetInk',
  'paper',
  'pen',
  'hullSet',
  'sinkEffect',
  'victoryStamp',
] as const;

export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** §1 — which slots the OPPONENT can see, and under what rule. */
export const OPPONENT_VISIBLE: Readonly<Record<CosmeticSlot, boolean>> = {
  // "yes, on cells they have proven (sunk ships, revealed items)".
  fleetInk: true,
  // "for you only".
  paper: false,
  pen: true,
  hullSet: true,
  // "yes — it plays on both screens".
  sinkEffect: true,
  victoryStamp: true,
};

export interface CosmeticItem {
  readonly id: string;
  readonly slot: CosmeticSlot;
  readonly name: string;
  /** §2 — "Each store's level gates the shelf". */
  readonly tier: number;
  readonly coins: number;
  readonly gems: number;
  /** The default for its slot: owned by everyone, never purchasable. */
  readonly isDefault?: boolean;
  /** Ink and paper carry a colour the contrast test reads. */
  readonly hex?: string;
  /**
   * §3's remap — an ink's alternative colour for papers it would otherwise be
   * illegible on. See ./contrast.ts, which explains why this is now
   * BIDIRECTIONAL (D11).
   */
  readonly onDark?: string;
  readonly onLight?: string;
  /** Sink effects declare their duration; §3 caps it at 600 ms. */
  readonly durationMs?: number;
}

const item = (
  id: string,
  slot: CosmeticSlot,
  name: string,
  tier: number,
  coins: number,
  extra: Partial<CosmeticItem> = {},
): CosmeticItem => ({ id, slot, name, tier, coins, gems: 0, ...extra });

// ---------------------------------------------------------------------------
// §2's catalogue
// ---------------------------------------------------------------------------

/** §2 — "Ballpoint violet (default), Crimson, Forest, Sepia, Charcoal, Teal,
 *  Rust, **Gold** (gems). 300-900 coins, gold 350 gems." */
export const FLEET_INKS: readonly CosmeticItem[] = [
  item('ink-violet', 'fleetInk', 'Ballpoint violet', 1, 0, {
    isDefault: true,
    hex: '#3E2FB8',
    onDark: '#8E82F0',
  }),
  item('ink-crimson', 'fleetInk', 'Crimson', 1, 300, { hex: '#A81A2B', onDark: '#E8697A' }),
  item('ink-forest', 'fleetInk', 'Forest', 1, 300, { hex: '#1F5E3A', onDark: '#63B98A' }),
  item('ink-sepia', 'fleetInk', 'Sepia', 2, 500, { hex: '#6B4A2A', onDark: '#C39A6B' }),
  item('ink-charcoal', 'fleetInk', 'Charcoal', 2, 500, { hex: '#2A2A2E', onDark: '#9B9BA6' }),
  item('ink-teal', 'fleetInk', 'Teal', 2, 700, { hex: '#0F5F63', onDark: '#5FC0C6' }),
  item('ink-rust', 'fleetInk', 'Rust', 3, 900, { hex: '#8A3B12', onDark: '#D98A5A' }),
  /**
   * §2's premium ink, and the reason D11 existed. Its bright form scores
   * 1.95-2.51 against light papers — well under §3's 3:1 floor — so it
   * carries an `onLight` variant (a dark bronze) as well as its bright
   * `onDark`. See ./contrast.ts.
   */
  item('ink-gold', 'fleetInk', 'Gold', 3, 0, {
    gems: 350,
    hex: '#C9A227',
    onDark: '#F0D060',
    onLight: '#6E5510',
  }),
];

/** §2 — "Graph (default), Parchment, Blueprint, Dotted notebook, Old sea
 *  chart, Squared exercise book. 400-1,200 coins." */
export const PAPERS: readonly CosmeticItem[] = [
  item('paper-graph', 'paper', 'Graph', 1, 0, { isDefault: true, hex: '#FBFCFE' }),
  item('paper-parchment', 'paper', 'Parchment', 1, 400, { hex: '#F2E6CC' }),
  item('paper-dotted', 'paper', 'Dotted notebook', 1, 400, { hex: '#FDFDF7' }),
  item('paper-squared', 'paper', 'Squared exercise book', 2, 700, { hex: '#F7F9F2' }),
  item('paper-chart', 'paper', 'Old sea chart', 2, 900, { hex: '#E8DCC0' }),
  /** The one DARK paper. §3's remap exists because of it. */
  item('paper-blueprint', 'paper', 'Blueprint', 3, 1_200, { hex: '#123A5C' }),
];

/** §2 — "Ballpoint (default), Fountain pen, Pencil, Marker, Crayon. 500-1,500." */
export const PENS: readonly CosmeticItem[] = [
  item('pen-ballpoint', 'pen', 'Ballpoint', 1, 0, { isDefault: true }),
  item('pen-fountain', 'pen', 'Fountain pen', 1, 500, {}),
  item('pen-pencil', 'pen', 'Pencil', 2, 800, {}),
  item('pen-marker', 'pen', 'Marker', 2, 1_100, {}),
  item('pen-crayon', 'pen', 'Crayon', 3, 1_500, {}),
];

/** §2 — "Standard (default), Ghost fleet, Paper boats, plus slots reserved
 *  for art-dependent sets. 1,500-4,000 coins or 250-400 gems." */
export const HULL_SETS: readonly CosmeticItem[] = [
  item('hull-standard', 'hullSet', 'Standard', 1, 0, { isDefault: true }),
  /**
   * §2's "existing masks at 45% alpha with a dashed overlay and a **slow
   * drift**". The drift was D12's problem: a drifting sprite on a cell the
   * rules have not made public would reveal a ship's presence. Resolved in
   * ./visibility.ts — it renders on the opponent's screen only for SUNK
   * ships, whose cells are already marked 'sunk'.
   */
  item('hull-ghost', 'hullSet', 'Ghost fleet', 2, 0, { gems: 250 }),
  item('hull-paperboats', 'hullSet', 'Paper boats', 2, 1_500, {}),
  item('hull-ironclad', 'hullSet', 'Ironclad', 3, 4_000, {}),
];

/** §2 — "Ink blot (default), Splatter, Whirlpool, Confetti (event)." */
export const SINK_EFFECTS: readonly CosmeticItem[] = [
  item('sink-blot', 'sinkEffect', 'Ink blot', 1, 0, { isDefault: true, durationMs: 420 }),
  item('sink-splatter', 'sinkEffect', 'Splatter', 1, 600, { durationMs: 420 }),
  item('sink-whirlpool', 'sinkEffect', 'Whirlpool', 2, 1_200, { durationMs: 420 }),
  item('sink-confetti', 'sinkEffect', 'Confetti', 3, 1_800, { durationMs: 420 }),
];

/** §2 — "Laurel (default), Anchor, Skull and crossbones, Kraken." */
export const VICTORY_STAMPS: readonly CosmeticItem[] = [
  item('stamp-laurel', 'victoryStamp', 'Laurel', 1, 0, { isDefault: true }),
  item('stamp-anchor', 'victoryStamp', 'Anchor', 1, 800, {}),
  item('stamp-skull', 'victoryStamp', 'Skull and crossbones', 2, 1_400, {}),
  item('stamp-kraken', 'victoryStamp', 'Kraken', 3, 2_000, {}),
];

export const COSMETICS: readonly CosmeticItem[] = [
  ...FLEET_INKS,
  ...PAPERS,
  ...PENS,
  ...HULL_SETS,
  ...SINK_EFFECTS,
  ...VICTORY_STAMPS,
];

export function cosmeticById(id: string): CosmeticItem | null {
  return COSMETICS.find((c) => c.id === id) ?? null;
}

export function itemsInSlot(slot: CosmeticSlot): readonly CosmeticItem[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** The defaults everyone owns, which is also the fallback for an unknown id. */
export const DEFAULTS: Readonly<Record<CosmeticSlot, string>> = COSMETIC_SLOTS.reduce(
  (out, slot) => {
    const fallback = COSMETICS.find((c) => c.slot === slot && c.isDefault);
    return { ...out, [slot]: fallback?.id ?? '' };
  },
  {} as Record<CosmeticSlot, string>,
);

/**
 * §2 — "Shipyard/Stationer's level 1 shows tier 1, level 2 adds tier 2, and so
 * on." A level-1 store never returns a tier-2 item as buyable (§6.6).
 */
export function shelfFor(slot: CosmeticSlot, storeLevel: number): readonly CosmeticItem[] {
  return itemsInSlot(slot).filter((c) => c.tier <= Math.max(0, storeLevel));
}

/** Which store sells which slot. */
export const SLOT_STORE: Readonly<Record<CosmeticSlot, 'shipyard' | 'stationery'>> = {
  fleetInk: 'stationery',
  paper: 'stationery',
  pen: 'stationery',
  hullSet: 'shipyard',
  sinkEffect: 'shipyard',
  victoryStamp: 'shipyard',
};

export type BuyError =
  | 'already-owned'
  | 'not-enough-coins'
  | 'not-enough-gems'
  | 'locked-tier'
  | 'unknown-item'
  | 'feature-off';

export interface BuyCheck {
  readonly ok: boolean;
  readonly error: BuyError | null;
  readonly coins: number;
  readonly gems: number;
}

export function canBuy(
  itemId: string,
  owned: readonly string[],
  storeLevel: number,
  wallet: { coins: number; gems: number },
): BuyCheck {
  const cosmetic = cosmeticById(itemId);
  if (!cosmetic) return { ok: false, error: 'unknown-item', coins: 0, gems: 0 };
  if (cosmetic.isDefault || owned.includes(itemId)) {
    return { ok: false, error: 'already-owned', coins: 0, gems: 0 };
  }
  if (cosmetic.tier > storeLevel) {
    return { ok: false, error: 'locked-tier', coins: cosmetic.coins, gems: cosmetic.gems };
  }
  if (cosmetic.gems > 0 && wallet.gems < cosmetic.gems) {
    return { ok: false, error: 'not-enough-gems', coins: 0, gems: cosmetic.gems };
  }
  if (cosmetic.gems === 0 && wallet.coins < cosmetic.coins) {
    return { ok: false, error: 'not-enough-coins', coins: cosmetic.coins, gems: 0 };
  }
  return { ok: true, error: null, coins: cosmetic.coins, gems: cosmetic.gems };
}

export type EquipError = 'not-owned' | 'bad-slot' | 'unknown-item';

export function canEquip(
  slot: CosmeticSlot,
  itemId: string,
  owned: readonly string[],
): { ok: boolean; error: EquipError | null } {
  const cosmetic = cosmeticById(itemId);
  if (!cosmetic) return { ok: false, error: 'unknown-item' };
  if (cosmetic.slot !== slot) return { ok: false, error: 'bad-slot' };
  if (!cosmetic.isDefault && !owned.includes(itemId)) return { ok: false, error: 'not-owned' };
  return { ok: true, error: null };
}

export type Equipped = Readonly<Record<CosmeticSlot, string>>;

/** A full, valid loadout from a partial one — unknown ids fall back. */
export function resolveEquipped(partial: Partial<Record<string, string>>): Equipped {
  return COSMETIC_SLOTS.reduce((out, slot) => {
    const wanted = partial[slot];
    const cosmetic = wanted ? cosmeticById(wanted) : null;
    return {
      ...out,
      [slot]: cosmetic && cosmetic.slot === slot ? cosmetic.id : DEFAULTS[slot],
    };
  }, {} as Record<CosmeticSlot, string>);
}
