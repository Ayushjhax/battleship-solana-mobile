/**
 * part-07 §8.2 and §8.3.
 *
 *   8.2 "Shell HUD: refund animation fires on hit, not on miss; the number
 *        always equals the server's value (never a local guess); a mine
 *        shows -3."
 *   8.3 "Stars and destruction render from the server payload only."
 *
 * The second half of each is the interesting one. It is easy to write a HUD
 * that animates correctly and still drifts, because it keeps its own count
 * and only corrects it when a response lands. These tests pin the other
 * behaviour: the component is handed two server numbers and asked what to
 * draw, and it has no way to produce a third.
 */
import { describe, expect, it } from 'vitest';

import { RAID_DEFAULTS } from '@engine/raid';

import {
  MINE_FLASH_MS,
  SHELL_POP_MS,
  clockText,
  lootTally,
  shellFeedback,
  shellRow,
  starEarned,
  starStrip,
} from '@/raid/ui/shellHud';

const HIT = { hit: true, mine: false };
const MISS = { hit: false, mine: false };
const MINE = { hit: false, mine: true };

// ===========================================================================
// §8.2 — the refund
// ===========================================================================

describe('the refund fires on a hit, not on a miss', () => {
  it('a hit pops the shell back and says +1', () => {
    const out = shellFeedback(30, 30, HIT);
    expect(out.kind).toBe('refund');
    expect(out.popBack).toBe(true);
    expect(out.label).toBe('+1');
    expect(out.flash).toBe(false);
  });

  it('a miss does not pop, and says nothing', () => {
    const out = shellFeedback(30, 29, MISS);
    expect(out.kind).toBe('spend');
    expect(out.popBack).toBe(false);
    expect(out.label).toBeNull();
  });

  it('a sunk ship refunds exactly as a hit does', () => {
    // SUNK implies HIT in the events, so the caller passes hit: true.
    expect(shellFeedback(22, 22, HIT).popBack).toBe(true);
  });

  it('a DECOY refunds and is indistinguishable from a hit — deliberately', () => {
    // The decoy serialises as a plain HIT (Part 5). If the HUD drew it
    // differently, the item would be useless: the attacker would know.
    const decoy = shellFeedback(18, 18, HIT);
    const ship = shellFeedback(18, 18, HIT);
    expect(decoy).toEqual(ship);
  });

  it('an item destroyed refunds too', () => {
    expect(shellFeedback(12, 12, HIT).kind).toBe('refund');
  });

  it('a kit weapon that costs nothing says nothing at all', () => {
    const out = shellFeedback(20, 20, MISS);
    expect(out.kind).toBe('free');
    expect(out.popBack).toBe(false);
    expect(out.label).toBeNull();
  });
});

// ===========================================================================
// §8.2 — the mine
// ===========================================================================

describe('a mine', () => {
  it('shows −3 at the default penalty and flashes red', () => {
    // -1 for the shell, -2 for the penalty (RAID_DEFAULTS.minePenalty).
    const after = 30 - 1 - RAID_DEFAULTS.minePenalty;
    const out = shellFeedback(30, after, MINE);
    expect(out.label).toBe('-3');
    expect(out.delta).toBe(-3);
    expect(out.kind).toBe('mine');
    expect(out.flash).toBe(true);
    expect(out.popBack).toBe(false);
  });

  it('reports whatever the server actually charged, not a hardcoded 3', () => {
    // A server running RAID_MINE_PENALTY=5 charges 6. The HUD must say 6.
    const out = shellFeedback(30, 24, MINE);
    expect(out.label).toBe('-6');
    expect(out.delta).toBe(-6);
  });

  it('a mine at the end of the budget cannot go below zero on screen', () => {
    // The server clamps at 0; the HUD reports the clamped move.
    const out = shellFeedback(1, 0, MINE);
    expect(out.delta).toBe(-1);
    expect(out.kind).toBe('mine');
  });
});

// ===========================================================================
// §8.2 — "the number always equals the server's value"
// ===========================================================================

describe('the number is the server’s', () => {
  it('shellRow draws exactly what it was given', () => {
    expect(shellRow(17, 30)).toEqual({ filled: 17, empty: 13 });
    expect(shellRow(0, 30)).toEqual({ filled: 0, empty: 30 });
    expect(shellRow(30, 30)).toEqual({ filled: 30, empty: 0 });
  });

  it('never invents shells, even if a response arrives out of order', () => {
    // A stale response claiming more shells than the budget must not grow the
    // row — the budget came from the open response and is the ceiling.
    expect(shellRow(99, 30).filled).toBe(30);
    expect(shellRow(-4, 30).filled).toBe(0);
  });

  it('feedback is a pure function of two server numbers', () => {
    // Called twice with the same pair, it says the same thing. There is no
    // internal counter that could drift between calls.
    const a = shellFeedback(30, 29, MISS);
    const b = shellFeedback(30, 29, MISS);
    expect(a).toEqual(b);
  });

  it('the animation timings are the existing ones (§3)', () => {
    expect(SHELL_POP_MS).toBe(220);
    expect(MINE_FLASH_MS).toBe(420);
  });
});

// ===========================================================================
// §8.3 — stars and destruction come from the payload
// ===========================================================================

describe('stars and destruction render from the payload only', () => {
  it('inks exactly the number of stars the server sent', () => {
    expect(starStrip({ stars: 0, destruction: 0 }).slots).toEqual([
      'outline',
      'outline',
      'outline',
    ]);
    expect(starStrip({ stars: 2, destruction: 0.6 }).slots).toEqual(['inked', 'inked', 'outline']);
    expect(starStrip({ stars: 3, destruction: 1 }).slots).toEqual(['inked', 'inked', 'inked']);
  });

  it('does NOT re-derive stars from destruction', () => {
    // 100% destruction would be three stars by the engine's rule. If the
    // server says one — because the rule changed, or because this is a stale
    // payload — the HUD shows one. Re-deriving is how a client starts lying.
    expect(starStrip({ stars: 1, destruction: 1 }).slots).toEqual([
      'inked',
      'outline',
      'outline',
    ]);
  });

  it('always draws three slots, whatever it is handed', () => {
    for (const stars of [-2, 0, 1, 2, 3, 7, 99]) {
      expect(starStrip({ stars, destruction: 0.5 }).slots).toHaveLength(3);
    }
  });

  it('rounds the destruction percentage and clamps it', () => {
    expect(starStrip({ stars: 0, destruction: 0.444 }).destructionPercent).toBe(44);
    expect(starStrip({ stars: 0, destruction: 0.555 }).destructionPercent).toBe(56);
    expect(starStrip({ stars: 0, destruction: 1.4 }).destructionPercent).toBe(100);
    expect(starStrip({ stars: 0, destruction: -1 }).destructionPercent).toBe(0);
  });

  it('a 4/18 destruction reads 22%, the engine denominator', () => {
    expect(starStrip({ stars: 1, destruction: 4 / 18 }).destructionPercent).toBe(22);
  });

  it('starEarned reports only a star that just landed', () => {
    expect(starEarned(0, 1)).toBe(1);
    expect(starEarned(1, 2)).toBe(2);
    expect(starEarned(2, 2)).toBeNull();
    expect(starEarned(3, 3)).toBeNull();
    // Stars cannot fall inside one raid, but a stale payload must not stamp.
    expect(starEarned(2, 1)).toBeNull();
  });
});

// ===========================================================================
// The clock and the loot tally
// ===========================================================================

describe('the raid clock', () => {
  it('starts at 4:00 for the default budget', () => {
    expect(clockText(RAID_DEFAULTS.timeLimitMs)).toBe('4:00');
  });

  it('counts down from the server value plus elapsed device time', () => {
    expect(clockText(240_000, 30_000)).toBe('3:30');
    expect(clockText(240_000, 239_000)).toBe('0:01');
  });

  it('never shows a negative clock', () => {
    expect(clockText(1_000, 999_999)).toBe('0:00');
    expect(clockText(-5_000)).toBe('0:00');
  });

  it('pads the seconds', () => {
    expect(clockText(65_000)).toBe('1:05');
    expect(clockText(600_000)).toBe('10:00');
  });
});

describe('the loot tally climbs with destruction', () => {
  const pool = { coins: 200, steel: 400 };

  it('is zero at the start', () => {
    expect(lootTally(pool, 0)).toEqual({ coins: 0, steel: 0 });
  });

  it('is proportional, and floors', () => {
    expect(lootTally(pool, 0.5)).toEqual({ coins: 100, steel: 200 });
    expect(lootTally(pool, 1)).toEqual({ coins: 200, steel: 400 });
    expect(lootTally(pool, 1 / 3)).toEqual({ coins: 66, steel: 133 });
  });

  it('never exceeds the pool, whatever destruction says', () => {
    expect(lootTally(pool, 5)).toEqual({ coins: 200, steel: 400 });
  });

  it('is monotonic, so the tally never ticks backwards mid-raid', () => {
    let previous = -1;
    for (let d = 0; d <= 1.0001; d += 0.02) {
      const steel = lootTally(pool, Math.min(1, d)).steel;
      expect(steel).toBeGreaterThanOrEqual(previous);
      previous = steel;
    }
  });
});
