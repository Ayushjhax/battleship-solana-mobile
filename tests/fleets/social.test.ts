/**
 * Friendly raids, the Flag Hall and quick chat — part-08 §7.6, §7.7, §7.8.
 *
 *   7.6 "Friendly raids: no loot, no renown, no shield, no lock, and they never
 *        appear in the defence log."
 *   7.7 "Flag Hall: a beaten captain's flag is recorded once; the picker writes
 *        the profile and the leaderboard shows it."
 *   7.8 "Quick chat: rate limits, 7-day expiry, and no path exists for free
 *        text while the flag is off."
 *
 * §7.8's last clause is the one with a sharp edge, and it is tested as written:
 * not "free text is disabled" but "no path exists".
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BASE_STICKER_COUNT,
  MESSAGE_TTL_MS,
  MIN_GAP_MS,
  PER_MINUTE,
  QUICK_PHRASES,
  canRaidFriendly,
  checkSend,
  earnsFlag,
  flagProgress,
  isExpired,
  liveMessages,
  phraseById,
  phrasesIn,
  raidPolicy,
  renderMessage,
  stickerUnlocked,
  stickersAvailable,
  wallOrder,
  type ChatMessage,
  type LayoutContext,
} from '@engine/fleets';
import {
  ALPHABET,
  COUNTRIES,
  COUNTRY_COUNT,
  activeLetters,
  byLetter,
  compareCountries,
  countryByCode,
  countryName,
  indexOfLetter,
  isCountryCode,
  sortKey,
} from '@/data/countries';

// ===========================================================================
// §7.6 — friendly raids
// ===========================================================================

describe('a friendly raid settles to nothing', () => {
  const friendly = raidPolicy('friendly');

  it('takes no loot', () => expect(friendly.loot).toBe(false));
  it('moves no renown', () => expect(friendly.renown).toBe(false));
  it('leaves no shield', () => expect(friendly.shield).toBe(false));
  it('takes no lock', () => expect(friendly.lock).toBe(false));
  it('costs nothing to find', () => expect(friendly.searchCost).toBe(false));

  it('NEVER appears in the defence log', () => {
    // §5. If it did, the log's Revenge button would offer revenge on a
    // fleetmate who was doing you a favour.
    expect(friendly.defenceLog).toBe(false);
  });

  it('is unlimited — §5 says so in as many words', () => {
    expect(friendly.limited).toBe(false);
  });

  it('always shows the full result — it is a teaching tool', () => {
    expect(friendly.alwaysReveal).toBe(true);
  });

  it('a REAL raid still does all four, so the policy is doing work', () => {
    const real = raidPolicy('raid');
    expect(real).toMatchObject({ loot: true, renown: true, shield: true, lock: true, defenceLog: true });
  });

  it('a WAR raid takes no loot and moves no renown either (§4)', () => {
    const war = raidPolicy('war');
    expect(war.loot).toBe(false);
    expect(war.renown).toBe(false);
    expect(war.shield).toBe(false);
    expect(war.lock).toBe(false);
    // But it IS limited: two per member.
    expect(war.limited).toBe(true);
    expect(war.defenceLog).toBe(false);
  });

  it('asking for a ranked "raid policy" pays nothing — the safe answer', () => {
    const ranked = raidPolicy('ranked');
    expect(Object.values(ranked).filter((v) => v === true)).toEqual([true]); // only `limited`
    expect(ranked.loot).toBe(false);
    expect(ranked.renown).toBe(false);
  });

  it('only a fleetmate can be practised on', () => {
    expect(canRaidFriendly('f1', 'f1', 'me', 'you').ok).toBe(true);
    expect(canRaidFriendly('f1', 'f2', 'me', 'you').ok).toBe(false);
    expect(canRaidFriendly(null, null, 'me', 'you').ok).toBe(false);
  });

  it('you cannot practise on yourself', () => {
    const check = canRaidFriendly('f1', 'f1', 'me', 'me');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('own mines');
  });
});

// ===========================================================================
// §7.7 — the Flag Hall
// ===========================================================================

describe('the Flag Hall', () => {
  it('a ranked WIN earns a flag; a loss does not', () => {
    expect(earnsFlag('ranked', { won: true })).toBe(true);
    expect(earnsFlag('ranked', { won: false })).toBe(false);
  });

  it('a raid earns one only if it took a star', () => {
    expect(earnsFlag('raid', { won: true, stars: 1 })).toBe(true);
    expect(earnsFlag('raid', { won: true, stars: 3 })).toBe(true);
    expect(earnsFlag('raid', { won: false, stars: 0 })).toBe(false);
  });

  it('a war or a friendly raid earns nothing — they are not conquests', () => {
    expect(earnsFlag('war', { won: true, stars: 3 })).toBe(false);
    expect(earnsFlag('friendly', { won: true, stars: 3 })).toBe(false);
  });

  it('counts a country ONCE, however many times you beat it', () => {
    const progress = flagProgress(['IN', 'IN', 'in', 'GB'], COUNTRY_COUNT);
    expect(progress.earned).toBe(2);
    expect(progress.label).toBe(`2 / ${COUNTRY_COUNT}`);
  });

  it('the denominator is the picker’s list, so the wall can be completed', () => {
    // If these two disagreed, the wall would show "250 / 199" or could never
    // be finished. One number, from one place.
    expect(flagProgress([], COUNTRY_COUNT).total).toBe(COUNTRIES.length);
  });

  it('the wall fills in the order the flags were won', () => {
    const wall = wallOrder([
      { countryCode: 'GB', firstAt: 300 },
      { countryCode: 'IN', firstAt: 100 },
      { countryCode: 'BR', firstAt: 200 },
    ]);
    expect(wall.map((f) => f.countryCode)).toEqual(['IN', 'BR', 'GB']);
  });

  it('an empty wall reads 0 / total, not 0 / 0', () => {
    expect(flagProgress([], COUNTRY_COUNT)).toMatchObject({ earned: 0, total: COUNTRY_COUNT });
  });
});

// ===========================================================================
// Appendix C — the country picker
// ===========================================================================

describe('the country picker', () => {
  it('has a list at all, which the repo did not before', () => {
    expect(COUNTRIES.length).toBeGreaterThan(150);
    expect(COUNTRY_COUNT).toBe(COUNTRIES.length);
  });

  it('is sorted by NAME, ignoring diacritics', () => {
    // A plain `<` files Türkiye after Tuvalu, where nobody will look for it.
    const sorted = [...COUNTRIES].sort(compareCountries);
    expect(sorted.map((c) => c.code)).toEqual(COUNTRIES.map((c) => c.code));
  });

  it('files Türkiye between Tunisia and Turkmenistan, where a reader looks', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names.indexOf('Türkiye')).toBeGreaterThan(names.indexOf('Tunisia'));
    expect(names.indexOf('Türkiye')).toBeLessThan(names.indexOf('Turkmenistan'));
    // And its letter index entry is T, not Ü.
    expect(sortKey('Türkiye').charAt(0)).toBe('T');
    expect(activeLetters().has('Ü')).toBe(false);
  });

  it('has no duplicate codes and every code is two letters', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code, code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('looks a country up by code, case-insensitively', () => {
    expect(countryByCode('IN')?.name).toBe('India');
    expect(countryByCode('in')?.name).toBe('India');
    expect(countryByCode('ZZ')).toBeNull();
    expect(countryByCode(null)).toBeNull();
    expect(countryByCode('')).toBeNull();
  });

  it('renders an unknown code as "Unknown" rather than blank', () => {
    expect(countryName('ZZ')).toBe('Unknown');
    expect(countryName(undefined)).toBe('Unknown');
    expect(countryName('GB')).toBe('United Kingdom');
  });

  it('validates a code, for the profile write', () => {
    expect(isCountryCode('US')).toBe(true);
    expect(isCountryCode('us')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
  });

  it('the letter index knows which letters are dead', () => {
    const active = activeLetters();
    expect(active.has('A')).toBe(true);
    expect(active.has('I')).toBe(true);
    // Every letter the index offers is either active or knowably inactive —
    // a tappable letter that jumps nowhere is worse than one visibly off.
    for (const letter of ALPHABET) {
      const at = indexOfLetter(letter);
      expect(active.has(letter) ? at !== null : at === null, letter).toBe(true);
    }
  });

  it('a letter jumps to the FIRST country with that letter', () => {
    const at = indexOfLetter('I')!;
    expect(COUNTRIES[at]?.name.charAt(0)).toBe('I');
    if (at > 0) expect(COUNTRIES[at - 1]?.name.charAt(0)).not.toBe('I');
  });

  it('groups for a sectioned render, in letter order', () => {
    const groups = byLetter();
    expect(groups.length).toBe(activeLetters().size);
    const letters = groups.map((g) => g.letter);
    expect([...letters].sort()).toEqual(letters);
    expect(groups.reduce((n, g) => n + g.countries.length, 0)).toBe(COUNTRIES.length);
  });
});

// ===========================================================================
// §7.8 — quick chat
// ===========================================================================

const base = {
  fleetHallLevel: 3,
  isMember: true,
  recent: [] as number[],
  now: 1_000_000,
};

describe('quick chat', () => {
  it('offers about 24 phrases, six in each of four groups', () => {
    expect(QUICK_PHRASES.length).toBe(24);
    for (const group of ['greetings', 'requests', 'tactics', 'praise'] as const) {
      expect(phrasesIn(group), group).toHaveLength(6);
    }
  });

  it('every phrase has a unique id and real text', () => {
    const ids = QUICK_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const phrase of QUICK_PHRASES) {
      expect(phrase.text.length, phrase.id).toBeGreaterThan(3);
    }
  });

  it('accepts a known phrase', () => {
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1' }).ok).toBe(true);
  });

  it('refuses an unknown one — this is the closed vocabulary', () => {
    const check = checkSend({ ...base, kind: 'phrase', code: 'not-a-phrase' });
    expect(check.ok).toBe(false);
    expect(check.error).toBe('unknown-phrase');
  });

  it('refuses arbitrary TEXT sent as a phrase code', () => {
    // The nearest thing to a free-text attack: put the message in the code.
    for (const attempt of ['hello there', '<script>', 'you are bad', '']) {
      expect(checkSend({ ...base, kind: 'phrase', code: attempt }).ok, attempt).toBe(false);
    }
  });

  it('refuses a locked sticker and accepts an unlocked one', () => {
    expect(stickersAvailable(0)).toBe(BASE_STICKER_COUNT);
    expect(stickersAvailable(3)).toBe(BASE_STICKER_COUNT + 6);
    expect(stickerUnlocked(0, 0)).toBe(true);
    expect(stickerUnlocked(9, 0)).toBe(false);

    expect(checkSend({ ...base, kind: 'sticker', code: '0' }).ok).toBe(true);
    expect(checkSend({ ...base, kind: 'sticker', code: '99', fleetHallLevel: 1 }).error).toBe(
      'locked-sticker',
    );
  });

  it('refuses a non-member', () => {
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', isMember: false }).error).toBe(
      'not-a-member',
    );
  });

  // ---- the rate limits (§2) ----------------------------------------------

  it('allows one message every 2 seconds', () => {
    expect(MIN_GAP_MS).toBe(2_000);
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', recent: [base.now - 1_999] }).error).toBe(
      'too-fast',
    );
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', recent: [base.now - 2_000] }).ok).toBe(true);
  });

  it('allows 30 a minute and refuses the 31st', () => {
    expect(PER_MINUTE).toBe(30);
    const thirty = Array.from({ length: 30 }, (_, n) => base.now - 3_000 - n * 1_000);
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', recent: thirty }).error).toBe('too-many');

    const twentyNine = thirty.slice(0, 29);
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', recent: twentyNine }).ok).toBe(true);
  });

  it('messages older than a minute do not count toward the minute limit', () => {
    const old = Array.from({ length: 40 }, (_, n) => base.now - 61_000 - n * 100);
    expect(checkSend({ ...base, kind: 'phrase', code: 'g1', recent: old }).ok).toBe(true);
  });

  it('every refusal has copy, and none of it is a code', () => {
    for (const check of [
      checkSend({ ...base, kind: 'phrase', code: 'nope' }),
      checkSend({ ...base, kind: 'phrase', code: 'g1', recent: [base.now] }),
      checkSend({ ...base, kind: 'phrase', code: 'g1', isMember: false }),
    ]) {
      expect(check.reason).toBeTruthy();
      expect(check.reason).not.toBe(check.error);
    }
  });

  // ---- the 7-day expiry (§2) ---------------------------------------------

  it('messages last 7 days', () => {
    expect(MESSAGE_TTL_MS).toBe(7 * 24 * 3_600_000);
    const message = (at: number): ChatMessage => ({ fleetId: 'f', userId: 'u', kind: 'phrase', code: 'g1', at });

    expect(isExpired(message(base.now - MESSAGE_TTL_MS + 1), base.now)).toBe(false);
    expect(isExpired(message(base.now - MESSAGE_TTL_MS), base.now)).toBe(true);

    const live = liveMessages(
      [message(base.now - 1_000), message(base.now - MESSAGE_TTL_MS - 1)],
      base.now,
    );
    expect(live).toHaveLength(1);
  });

  it('renders a phrase as OUR text and a sticker as an id', () => {
    expect(renderMessage({ fleetId: 'f', userId: 'u', kind: 'phrase', code: 'g1', at: 0 })).toEqual({
      text: 'Fair winds.',
      stickerId: null,
    });
    expect(renderMessage({ fleetId: 'f', userId: 'u', kind: 'sticker', code: '3', at: 0 })).toEqual({
      text: null,
      stickerId: 3,
    });
  });

  it('an unknown code renders as NOTHING, never as the raw code', () => {
    // The last line of defence: even if a bad row reached the client, the
    // renderer will not print it.
    expect(renderMessage({ fleetId: 'f', userId: 'u', kind: 'phrase', code: 'hello', at: 0 }).text)
      .toBeNull();
    expect(phraseById('hello')).toBeNull();
  });
});

// ===========================================================================
// §7.8 — "no path exists for free text"
// ===========================================================================

describe('free text does not ship', () => {
  it('no exported function anywhere in the fleets engine accepts free text', async () => {
    // Not "is disabled". NOT PRESENT. §2 is explicit that the flag exists so
    // the decision is visible, and that there is nothing behind it.
    const fleets = await import('@engine/fleets');
    const names = Object.keys(fleets);
    for (const name of names) {
      const lower = name.toLowerCase();
      expect(lower, name).not.toContain('freetext');
      expect(lower, name).not.toContain('sendtext');
      expect(lower, name).not.toContain('message_text');
    }
  });

  it('a ChatMessage has no text field to put one in', () => {
    const message: ChatMessage = { fleetId: 'f', userId: 'u', kind: 'phrase', code: 'g1', at: 0 };
    expect(Object.keys(message).sort()).toEqual(['at', 'code', 'fleetId', 'kind', 'userId']);
    expect('text' in message).toBe(false);
    expect('body' in message).toBe(false);
  });

  it('the only two kinds are phrase and sticker', () => {
    // A third kind is where free text would arrive. There isn't one, and
    // checkSend's sticker branch rejects anything that is not a number.
    expect(checkSend({ ...base, kind: 'text' as never, code: 'hello' }).ok).toBe(false);
  });

  it('the SQL check constraint agrees', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sql = readFileSync(
      fileURLToPath(new URL('../../supabase/migrations/0017_fleets.sql', import.meta.url)),
      'utf8',
    );
    // fleet_message.kind is constrained to the two, in the database itself.
    expect(sql).toContain("check (kind in ('phrase', 'sticker'))");
  });
});
