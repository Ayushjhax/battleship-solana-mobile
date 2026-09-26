/**
 * The Attack deck has to fit: one card per aimable weapon, inside the
 * panel's pen border, clear of the row letters beside your own board. Adding
 * a seventh weapon to WEAPON_ORDER, or moving the battle's boards back to
 * the middle of the sheet, should fail here rather than on a phone.
 */
import { describe, expect, it } from 'vitest';

import {
  BATTLE_BOARD_LEFT,
  BATTLE_BOARD_TOP,
  BOARD_SIZE,
  GUTTER,
  LABEL_MARGIN,
} from '../../src/board/layout';
import { WEAPON_ORDER } from '../../src/features/arsenal/catalog';
import {
  CARD,
  CARDS_TOP,
  CARD_X,
  DECK,
  DECK_BORDER,
  cardCentre,
  cardOrigin,
  cardsBottom,
} from '../../src/features/battle/deckLayout';

const CANVAS_H = 360;

describe('the Attack deck fits its panel', () => {
  it('holds every aimable weapon between the heading and the panel foot', () => {
    expect(WEAPON_ORDER.length).toBe(6);
    // Clear of the "Attack" heading at the top…
    expect(CARDS_TOP).toBeGreaterThan(DECK_BORDER + 8);
    // …and the last card stops inside the border at the bottom.
    expect(cardsBottom(WEAPON_ORDER.length)).toBeLessThanOrEqual(DECK.y + DECK.h - DECK_BORDER);
  });

  it('keeps the cards inside the panel border on both sides', () => {
    expect(CARD_X).toBeGreaterThan(DECK_BORDER);
    expect(CARD_X + CARD.w).toBeLessThan(DECK.w - DECK_BORDER);
  });

  it('stacks the cards in order without overlapping', () => {
    for (let i = 1; i < WEAPON_ORDER.length; i++) {
      const previous = cardOrigin(i - 1);
      const current = cardOrigin(i);
      expect(current.x).toBe(previous.x);
      expect(current.y - (previous.y + CARD.h)).toBeCloseTo(CARD.gap, 5);
    }
    expect(cardCentre(0)).toEqual({
      x: DECK.x + CARD_X + CARD.w / 2,
      y: DECK.y + CARDS_TOP + CARD.h / 2,
    });
  });

  it('stays on the sheet, under the HUD', () => {
    expect(DECK.x).toBeGreaterThanOrEqual(0);
    expect(DECK.y).toBeGreaterThanOrEqual(BATTLE_BOARD_TOP);
    expect(DECK.y + DECK.h).toBeLessThanOrEqual(CANVAS_H);
  });
});

describe('the deck and the boards share the sheet', () => {
  it('leaves the row letters beside your own board room to the right of it', () => {
    // GridBoard draws them from (board x - LABEL_MARGIN - 3), 22 wide.
    const lettersLeft = BATTLE_BOARD_LEFT - LABEL_MARGIN - 3;
    expect(DECK.x + DECK.w).toBeLessThanOrEqual(lettersLeft);
  });

  it('still fits both boards and the opponent row letters', () => {
    const enemyRight = BATTLE_BOARD_LEFT + BOARD_SIZE + GUTTER + BOARD_SIZE;
    expect(enemyRight + LABEL_MARGIN).toBeLessThanOrEqual(800);
  });
});
