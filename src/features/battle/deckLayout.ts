/**
 * Where the battle's Attack deck sits on the 800 x 360 canvas — pure maths,
 * so the fit can be asserted instead of eyeballed (deckLayout.test.ts).
 *
 * The deck is a fixed column: it must hold one card per weapon in
 * catalog.ts WEAPON_ORDER inside the panel's pen border, and it must stop
 * short of the row letters down the left of your own board — which is why
 * the battle's boards start at BATTLE_BOARD_LEFT rather than SIDE_MARGIN.
 */
import { BATTLE_BOARD_TOP } from '@/board/layout';

/** The panel. scripts/deck-assets.sh builds the art at 3x these. */
export const DECK = { x: 6, y: BATTLE_BOARD_TOP, w: 92, h: 278 } as const;

/** One weapon card. */
export const CARD = { w: 74, h: 38, gap: 3.6 } as const;

/** The first card's top, under the "Attack" heading. */
export const CARDS_TOP = 24;

/**
 * The panel art's pen border, in canvas units: the source's 32 px at the
 * 276 px width it is drawn at. Cards stay inside it.
 */
export const DECK_BORDER = (32 * (DECK.w * 3)) / 519 / 3;

export const CARD_X = (DECK.w - CARD.w) / 2;

/** Canvas position of one card's top-left corner. */
export function cardOrigin(index: number): { readonly x: number; readonly y: number } {
  return { x: DECK.x + CARD_X, y: DECK.y + CARDS_TOP + index * (CARD.h + CARD.gap) };
}

/** Canvas position of one card's centre — where a launched weapon flies from. */
export function cardCentre(index: number): { readonly x: number; readonly y: number } {
  const { x, y } = cardOrigin(index);
  return { x: x + CARD.w / 2, y: y + CARD.h / 2 };
}

/** The canvas y the last of `count` cards reaches. */
export function cardsBottom(count: number): number {
  return DECK.y + CARDS_TOP + count * CARD.h + (count - 1) * CARD.gap;
}
