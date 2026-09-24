/**
 * The Naval Academy's research queue — part-05 §5.
 *
 * This closes DECISIONS.md **D23**, which stood in for it across Parts 6, 7
 * and 8: until now "has this player researched the decoy?" was answered with
 * "is the Naval Academy built at all?", which is strictly looser than the rule
 * §5 actually states.
 *
 * The property that matters most is the parenthesis in §5: the queue is the
 * Academy's OWN, so it is not gated on a dock worker and a building upgrade
 * running in the background does not block it.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_RESEARCH,
  RESEARCH,
  RESEARCHABLE,
  isResearched,
  researchCoversAcademyKinds,
  researchMsLeft,
  researchSpec,
  researchableAt,
  rushResearch,
  settleResearch,
  startResearch,
  unlockList,
  type ResearchState,
} from '@engine/city';
import { ACADEMY_KINDS } from '@engine/types';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

// ===========================================================================
// §5's table
// ===========================================================================

describe('the research table', () => {
  it('is §5’s three items, at §5’s prices and times', () => {
    expect(RESEARCH).toEqual([
      { item: 'sonar_net', academyLevel: 1, coins: 1_000, minutes: 120 },
      { item: 'decoy', academyLevel: 2, coins: 2_500, minutes: 480 },
      { item: 'minesweeper', academyLevel: 3, coins: 5_000, minutes: 1_440 },
    ]);
  });

  it('covers exactly the engine’s ACADEMY_KINDS, and no more', () => {
    // Two lists that must agree: `ACADEMY_KINDS` gates the arsenal, this
    // table gates the research. A fourth item added to one and not the other
    // is either unresearchable or free.
    expect(researchCoversAcademyKinds()).toBe(true);
    expect([...RESEARCHABLE].sort()).toEqual([...ACADEMY_KINDS].sort());
  });

  it('gates each item behind its Academy level', () => {
    expect(researchableAt(0)).toHaveLength(0);
    expect(researchableAt(1).map((r) => r.item)).toEqual(['sonar_net']);
    expect(researchableAt(2).map((r) => r.item)).toEqual(['sonar_net', 'decoy']);
    expect(researchableAt(3)).toHaveLength(3);
    // §5's levels 4-5 are "(reserved)" — nothing new, and that is not a bug.
    expect(researchableAt(5)).toHaveLength(3);
  });

  it('returns null for something that is not researchable', () => {
    expect(researchSpec('bomber')).toBeNull();
    expect(researchSpec('mine')).toBeNull();
  });
});

// ===========================================================================
// Starting
// ===========================================================================

describe('starting research', () => {
  it('starts the sonar net at Academy 1', () => {
    const out = startResearch(EMPTY_RESEARCH, 'sonar_net', 1, 5_000, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dCoins).toBe(-1_000);
    expect(out.state.job).toEqual({ item: 'sonar_net', startedAt: NOW, endsAt: NOW + 2 * HOUR });
    // Nothing is unlocked yet — that is what finishing is for.
    expect(out.state.unlocks).toEqual([]);
  });

  it('refuses an item the Academy is too low for', () => {
    const out = startResearch(EMPTY_RESEARCH, 'decoy', 1, 99_999, NOW);
    expect(out.ok === false && out.error).toBe('needs-academy');
  });

  it('refuses when the coins are short', () => {
    const out = startResearch(EMPTY_RESEARCH, 'sonar_net', 1, 999, NOW);
    expect(out.ok === false && out.error).toBe('not-enough-coins');
  });

  it('refuses something already researched', () => {
    const done: ResearchState = { unlocks: ['sonar_net'], job: null };
    expect(startResearch(done, 'sonar_net', 3, 99_999, NOW).ok).toBe(false);
  });

  it('refuses a SECOND job — §5, one at a time', () => {
    const busy = startResearch(EMPTY_RESEARCH, 'sonar_net', 3, 99_999, NOW);
    expect(busy.ok).toBe(true);
    if (!busy.ok) return;

    const second = startResearch(busy.state, 'decoy', 3, 99_999, NOW);
    expect(second.ok === false && second.error).toBe('already-researching');
  });

  it('refuses an item that is not researchable at all', () => {
    expect(startResearch(EMPTY_RESEARCH, 'bomber', 5, 99_999, NOW).ok).toBe(false);
  });

  it('never mutates the state it was given', () => {
    const before = JSON.stringify(EMPTY_RESEARCH);
    startResearch(EMPTY_RESEARCH, 'sonar_net', 1, 5_000, NOW);
    expect(JSON.stringify(EMPTY_RESEARCH)).toBe(before);
  });
});

// ===========================================================================
// Finishing
// ===========================================================================

describe('finishing', () => {
  const started = () => {
    const out = startResearch(EMPTY_RESEARCH, 'sonar_net', 1, 5_000, NOW);
    if (!out.ok) throw new Error('setup failed');
    return out.state;
  };

  it('does nothing before the clock', () => {
    const state = started();
    expect(settleResearch(state, NOW + HOUR).job).not.toBeNull();
    expect(settleResearch(state, NOW + HOUR).unlocks).toEqual([]);
  });

  it('unlocks the item at exactly the end', () => {
    const settled = settleResearch(started(), NOW + 2 * HOUR);
    expect(settled.job).toBeNull();
    expect(settled.unlocks).toEqual(['sonar_net']);
    expect(isResearched(settled, 'sonar_net')).toBe(true);
  });

  it('settling twice does not unlock twice', () => {
    const once = settleResearch(started(), NOW + 3 * HOUR);
    const twice = settleResearch(once, NOW + 9 * HOUR);
    expect(twice.unlocks).toEqual(['sonar_net']);
  });

  it('frees the queue, so the next item can start', () => {
    const settled = settleResearch(started(), NOW + 3 * HOUR);
    const next = startResearch(settled, 'decoy', 2, 99_999, NOW + 3 * HOUR);
    expect(next.ok).toBe(true);
  });

  it('counts down', () => {
    const state = started();
    expect(researchMsLeft(state, NOW)).toBe(2 * HOUR);
    expect(researchMsLeft(state, NOW + HOUR)).toBe(HOUR);
    expect(researchMsLeft(state, NOW + 9 * HOUR)).toBe(0);
    expect(researchMsLeft(EMPTY_RESEARCH, NOW)).toBe(0);
  });

  it('all three can be researched, in order', () => {
    let state: ResearchState = EMPTY_RESEARCH;
    let clock = NOW;
    for (const spec of RESEARCH) {
      const out = startResearch(state, spec.item, spec.academyLevel, 99_999, clock);
      expect(out.ok, spec.item).toBe(true);
      if (!out.ok) return;
      clock += spec.minutes * 60_000;
      state = settleResearch(out.state, clock);
    }
    expect([...unlockList(state)].sort()).toEqual([...ACADEMY_KINDS].sort());
  });
});

// ===========================================================================
// Rushing with gems (§5)
// ===========================================================================

describe('rushing', () => {
  const started = () => {
    const out = startResearch(EMPTY_RESEARCH, 'minesweeper', 3, 99_999, NOW);
    if (!out.ok) throw new Error('setup failed');
    return out.state;
  };

  it('finishes it now, for gems', () => {
    const out = rushResearch(started(), 40, 100, NOW + HOUR);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dGems).toBe(-40);
    expect(out.state.unlocks).toEqual(['minesweeper']);
    expect(out.state.job).toBeNull();
  });

  it('refuses when the gems are short', () => {
    expect(rushResearch(started(), 40, 10, NOW + HOUR).ok).toBe(false);
  });

  it('refuses when nothing is researching', () => {
    const out = rushResearch(EMPTY_RESEARCH, 40, 100, NOW);
    expect(out.ok === false && out.error).toBe('not-researching');
  });

  it('refuses a job that has already finished — settle it instead', () => {
    const out = rushResearch(started(), 40, 100, NOW + 48 * HOUR);
    expect(out.ok === false && out.error).toBe('not-finished');
  });

  it('charges no coins — the coins were spent at the start', () => {
    const out = rushResearch(started(), 40, 100, NOW + HOUR);
    expect(out.ok && out.dCoins).toBe(0);
  });
});

// ===========================================================================
// What the rest of the package asks it
// ===========================================================================

describe('the question Parts 6, 7 and 8 ask', () => {
  it('hands back a plain string list, which is what every validator takes', () => {
    const state: ResearchState = { unlocks: ['sonar_net', 'decoy'], job: null };
    const list = unlockList(state);
    expect(list).toEqual(['sonar_net', 'decoy']);
    // validateSubmission / validateHarbour / validateKit all take readonly
    // string[], so this must be assignable to one without a cast.
    const asStrings: readonly string[] = list;
    expect(asStrings).toHaveLength(2);
  });

  it('is STRICTLY TIGHTER than D23’s stand-in', () => {
    // D23 said: a built Naval Academy unlocks all three. The real rule is
    // that each item is unlocked separately, so a player with a level-3
    // Academy and no research has NOTHING — where D23 gave them everything.
    const academyBuiltButNothingResearched: ResearchState = { unlocks: [], job: null };
    for (const kind of ACADEMY_KINDS) {
      expect(isResearched(academyBuiltButNothingResearched, kind), kind).toBe(false);
    }
  });
});
