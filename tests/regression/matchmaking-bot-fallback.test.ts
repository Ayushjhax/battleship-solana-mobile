/**
 * The bot fallback's player-facing copy and identification.
 *
 * A bot arriving through the 40-second matchmaking fallback must be named as
 * a bot and announced with the exact notice the product asked for — never
 * dressed up as a human captain.
 */
import { describe, expect, it } from 'vitest';

import {
  BOT_FALLBACK_NOTICE,
  isBotOpponent,
  opponentDisplayName,
} from '../../src/features/matchmaking/botFallback';

describe('bot fallback presentation', () => {
  it('uses the exact notice the product specifies', () => {
    expect(BOT_FALLBACK_NOTICE).toBe('No opponent found. Playing against a bot instead.');
  });

  it('identifies only a server-flagged bot', () => {
    expect(isBotOpponent({ isBot: true })).toBe(true);
    expect(isBotOpponent({ isBot: false })).toBe(false);
    expect(isBotOpponent(null)).toBe(false);
    expect(isBotOpponent(undefined)).toBe(false);
  });

  it('never shows a bot under its profile name', () => {
    expect(opponentDisplayName({ name: 'Berhan', isBot: true })).toBe('Bot');
    expect(opponentDisplayName({ name: 'Khyh', isBot: false })).toBe('Khyh');
  });
});
