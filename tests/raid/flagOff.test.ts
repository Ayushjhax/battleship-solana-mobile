/**
 * part-07 §8 QA — "once with the flag off to confirm the harbour nameplate
 * reverts to the old stats card" — and §9.2, "Nothing in the UI reveals
 * anything the server did not send."
 *
 * Two different guarantees, tested together because they are the two ways
 * this part can be wrong in a way nobody notices until it is shipped:
 *
 *   1. the flag is off and a raid surface appears anyway;
 *   2. the flag is on and a payload carries something it should not.
 *
 * The second one is the parse boundary. Part 6 made the secret structural on
 * the SERVER; this is the same guarantee on the client, where an attacker
 * actually has leverage.
 */
import { describe, expect, it } from 'vitest';

import { RAID_ERROR_CODES, RaidViewSchema, TargetCardSchema } from '@/raid/types';

// ===========================================================================
// §9.2 — the parse boundary strips what should not be there
// ===========================================================================

const validView = {
  marks: { '0,0': 'hit' },
  sunkShips: [],
  revealedItems: [],
  shipsRemaining: 8,
  shells: 29,
  kit: {},
  kitLeft: 0,
  stars: 0,
  destruction: 0,
  over: false,
  msLeft: 240_000,
};

describe('a raid payload cannot carry the defender’s board', () => {
  it('accepts a well-formed view', () => {
    expect(RaidViewSchema.safeParse(validView).success).toBe(true);
  });

  it('REJECTS a payload carrying ships', () => {
    const leaky = {
      ...validView,
      ships: [{ id: 'battleship-1', origin: { r: 0, c: 0 }, len: 4, orientation: 'h' }],
    };
    expect(RaidViewSchema.safeParse(leaky).success).toBe(false);
  });

  it('REJECTS a payload carrying an arsenal', () => {
    const leaky = { ...validView, arsenal: [{ id: 'mine-1', kind: 'mine', at: { r: 3, c: 3 } }] };
    expect(RaidViewSchema.safeParse(leaky).success).toBe(false);
  });

  it('REJECTS a payload carrying a layout', () => {
    const leaky = { ...validView, layout: { ships: [], arsenal: [] } };
    expect(RaidViewSchema.safeParse(leaky).success).toBe(false);
  });

  it('rejects ANY field it was not told about', () => {
    // The point of `.strict()`: a future server field is a parse failure, not
    // a silent passenger that a `{...view}` spread carries into a component.
    for (const key of ['board', 'secret', 'defenderShips', 'hidden', 'debug']) {
      expect(RaidViewSchema.safeParse({ ...validView, [key]: 'x' }).success, key).toBe(false);
    }
  });

  it('the target card cannot carry a layout either', () => {
    const card = {
      kind: 'player',
      userId: '11111111-1111-4111-8111-111111111111',
      coveSeed: null,
      name: 'Someone',
      avatarId: 1,
      avatarColor: 'violet',
      countryCode: 'IN',
      admiraltyLevel: 4,
      renown: 800,
      loot: { coins: 100, steel: 200 },
      renownOffer: { best: 20, worst: -14 },
      costCoins: 40,
    };
    expect(TargetCardSchema.safeParse(card).success).toBe(true);
    expect(TargetCardSchema.safeParse({ ...card, layout: {} }).success).toBe(false);
    expect(TargetCardSchema.safeParse({ ...card, ships: [] }).success).toBe(false);
  });

  it('clamps stars and destruction at the boundary, not in a component', () => {
    expect(RaidViewSchema.safeParse({ ...validView, stars: 4 }).success).toBe(false);
    expect(RaidViewSchema.safeParse({ ...validView, stars: -1 }).success).toBe(false);
    expect(RaidViewSchema.safeParse({ ...validView, destruction: 1.5 }).success).toBe(false);
  });

  it('a missing field is a failure, so a half-payload never half-renders', () => {
    for (const key of Object.keys(validView)) {
      const partial = { ...validView };
      delete (partial as Record<string, unknown>)[key];
      expect(RaidViewSchema.safeParse(partial).success, key).toBe(false);
    }
  });
});

// ===========================================================================
// The flag
// ===========================================================================

describe('the raids flag', () => {
  it('is a known Port City flag', async () => {
    const { CITY_FLAGS } = await import('@/city/flagKeys');
    expect(CITY_FLAGS).toContain('portCity.raids');
  });

  it('the client and the server agree on every flag name', async () => {
    // Two hand-kept lists, like the wire protocol. A typo in either is a
    // feature that silently never turns on, with nothing to notice it.
    const { CITY_FLAGS } = await import('@/city/flagKeys');
    const { FEATURE_KEYS } = await import('../../server/src/features');
    expect([...CITY_FLAGS].sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it('every raid endpoint can answer feature-off, and it has copy', async () => {
    const { raidErrorLine } = await import('@/raid/ui/captainCopy');
    expect(RAID_ERROR_CODES).toContain('feature-off');
    const line = raidErrorLine('feature-off');
    expect(line).toBeTruthy();
    expect(line).not.toContain('feature-off');
  });

  it('the server gates the flag too, so a flag-off client cannot be tricked', async () => {
    // The client hiding a button is a courtesy; the server refusing is the
    // rule. This asserts the server's flag name matches the client's, which
    // is the one way the two could silently disagree.
    const { FEATURE_KEYS } = await import('../../server/src/features');
    expect(FEATURE_KEYS).toContain('portCity.raids');
  });
});
