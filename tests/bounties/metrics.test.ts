/**
 * The metric evaluator — part-04 §5.1.
 *
 * "Each metric: a crafted match event log advances exactly the right
 *  contracts, and a match that does not qualify advances none."
 *
 * The second half is tested as hard as the first, because a metric that fires
 * too eagerly is worse than one that never fires: the player gets a contract
 * for free and stops trusting the board.
 */
import { describe, expect, it } from 'vitest';

import type { MatchEvent } from '@engine/types';
import {
  CONTRACTS,
  advance,
  countsTowardContracts,
  deltasFor,
  type ContractMetric,
  type MatchSummary,
  type MetricSource,
} from '@engine/bounties';

const match = (patch: Partial<MatchSummary> = {}): MetricSource => ({
  kind: 'match',
  match: {
    won: false,
    online: false,
    difficulty: null,
    shipsAfloat: 0,
    boughtArsenal: false,
    events: [],
    ...patch,
  },
});

const e = (type: string, extra: Record<string, unknown> = {}): MatchEvent =>
  ({ type, playerId: 'me', ...extra }) as unknown as MatchEvent;

const sunk = (shipClass = 'destroyer') => e('SUNK', { shipClass, shipId: `${shipClass}-1`, cells: [] });

// ===========================================================================
// Every metric in the catalogue has an evaluator
// ===========================================================================

describe('the catalogue', () => {
  it('has at least 30 contracts, as §1 asks', () => {
    expect(CONTRACTS.length).toBeGreaterThanOrEqual(30);
  });

  it('has unique ids', () => {
    const ids = CONTRACTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every contract has a positive target and a real title', () => {
    for (const contract of CONTRACTS) {
      expect(contract.target, contract.id).toBeGreaterThan(0);
      expect(contract.title.length, contract.id).toBeGreaterThan(4);
    }
  });

  it('every metric used is one the evaluator can answer', () => {
    // `advance` returns 0 rather than throwing for anything it does not know,
    // so this asserts each metric can be advanced by SOME source — a metric
    // no source advances would be a contract nobody can ever finish.
    // A match in which everything happened at least once, so a metric that
    // returns 0 here is one no source can advance — a contract nobody could
    // ever finish.
    const everything: MatchEvent[] = [
      sunk('battleship'),
      e('TORPEDO_RUN'),
      sunk('cruiser'),
      e('TURN_CHANGED'),
      e('BOMB_DROPPED', { kind: 'atomicBomber' }),
      sunk('destroyer'),
      sunk('destroyer'),
      e('TURN_CHANGED'),
      e('SUBMARINE_SURFACED', { at: { r: 2, c: 2 } }),
      sunk('boat'),
      e('TURN_CHANGED'),
      e('AIRCRAFT_DOWNED', { kind: 'bomber', gunAt: { r: 3, c: 3 } }),
      e('AIRCRAFT_DOWNED', { kind: 'bomber', gunAt: { r: 3, c: 3 } }),
      e('MINE_TRIGGERED'),
      e('RADAR_RESULT', { at: { r: 6, c: 6 }, count: 1 }),
      e('HIT', { at: { r: 6, c: 6 } }),
      e('HIT'),
      e('HIT'),
      e('HIT'),
      e('HIT'),
    ];
    const sources: MetricSource[] = [
      match({ won: true, online: true, difficulty: 'hard', shipsAfloat: 8, events: everything }),
      { kind: 'city', city: { steelCollected: 9, upgradesFinished: 9, admiraltyLevel: 9, scrapyardCollections: 9 } },
      { kind: 'raid', raid: { stars: 9, steelTaken: 9, defended: 9, threeStarred: 9 } },
    ];
    const metrics = new Set(CONTRACTS.map((c) => c.metric));
    for (const metric of metrics) {
      const best = Math.max(...sources.map((s) => advance(metric, s)));
      expect(best, metric).toBeGreaterThan(0);
    }
  });

  it('every raid contract is gated on the raids flag — §4', () => {
    const raidMetrics: ContractMetric[] = ['raid_stars', 'raid_steel', 'defended', 'three_starred'];
    for (const contract of CONTRACTS) {
      if (raidMetrics.includes(contract.metric)) {
        expect(contract.requires, contract.id).toBe('portCity.raids');
      }
    }
  });
});

// ===========================================================================
// Battle metrics
// ===========================================================================

describe('battle metrics', () => {
  it('matches_won counts a win and not a loss', () => {
    expect(advance('matches_won', match({ won: true }))).toBe(1);
    expect(advance('matches_won', match({ won: false }))).toBe(0);
  });

  it('online_won needs BOTH a win and an online match', () => {
    expect(advance('online_won', match({ won: true, online: true }))).toBe(1);
    expect(advance('online_won', match({ won: true, online: false }))).toBe(0);
    expect(advance('online_won', match({ won: false, online: true }))).toBe(0);
  });

  it('battleships_sunk counts only battleships', () => {
    const events = [sunk('battleship'), sunk('cruiser'), sunk('battleship')];
    expect(advance('battleships_sunk', match({ events }))).toBe(2);
    expect(advance('battleships_sunk', match({ events: [sunk('boat')] }))).toBe(0);
  });

  it('torpedo_sinks counts sinks inside a torpedo run', () => {
    const events = [e('TORPEDO_RUN'), sunk(), sunk(), e('TURN_CHANGED'), sunk()];
    expect(advance('torpedo_sinks', match({ events }))).toBe(2);
  });

  it('...and none when the sink came before the torpedo', () => {
    expect(advance('torpedo_sinks', match({ events: [sunk(), e('TORPEDO_RUN')] }))).toBe(0);
  });

  it('atomic_double needs TWO sinks from ONE atomic bomber', () => {
    const two = [e('BOMB_DROPPED', { kind: 'atomicBomber' }), sunk(), sunk()];
    expect(advance('atomic_double', match({ events: two }))).toBe(1);

    const one = [e('BOMB_DROPPED', { kind: 'atomicBomber' }), sunk()];
    expect(advance('atomic_double', match({ events: one }))).toBe(0);
  });

  it('...and a PLAIN bomber does not count, however many it sinks', () => {
    const events = [e('BOMB_DROPPED', { kind: 'bomber' }), sunk(), sunk(), sunk()];
    expect(advance('atomic_double', match({ events }))).toBe(0);
  });

  it('...and two separate atomics with one sink each do not count', () => {
    const events = [
      e('BOMB_DROPPED', { kind: 'atomicBomber' }),
      sunk(),
      e('TURN_CHANGED'),
      e('BOMB_DROPPED', { kind: 'atomicBomber' }),
      sunk(),
    ];
    expect(advance('atomic_double', match({ events }))).toBe(0);
  });

  it('aa_downs counts every downed aircraft', () => {
    const events = [
      e('AIRCRAFT_DOWNED', { kind: 'bomber', gunAt: { r: 1, c: 1 } }),
      e('AIRCRAFT_DOWNED', { kind: 'bomber', gunAt: { r: 5, c: 5 } }),
    ];
    expect(advance('aa_downs', match({ events }))).toBe(2);
  });

  it('gun_double needs the SAME gun twice', () => {
    const same = [
      e('AIRCRAFT_DOWNED', { gunAt: { r: 3, c: 3 } }),
      e('AIRCRAFT_DOWNED', { gunAt: { r: 3, c: 3 } }),
    ];
    expect(advance('gun_double', match({ events: same }))).toBe(1);

    const different = [
      e('AIRCRAFT_DOWNED', { gunAt: { r: 3, c: 3 } }),
      e('AIRCRAFT_DOWNED', { gunAt: { r: 7, c: 7 } }),
    ];
    expect(advance('gun_double', match({ events: different }))).toBe(0);
  });

  it('mine_stops counts triggered mines', () => {
    expect(advance('mine_stops', match({ events: [e('MINE_TRIGGERED'), e('MINE_TRIGGERED')] }))).toBe(2);
  });

  it('win_with_4_afloat needs a win AND four ships', () => {
    expect(advance('win_with_4_afloat', match({ won: true, shipsAfloat: 4 }))).toBe(1);
    expect(advance('win_with_4_afloat', match({ won: true, shipsAfloat: 3 }))).toBe(0);
    expect(advance('win_with_4_afloat', match({ won: false, shipsAfloat: 8 }))).toBe(0);
  });

  it('run_of_5 needs five HITs with no miss between', () => {
    const five = Array.from({ length: 5 }, () => e('HIT'));
    expect(advance('run_of_5', match({ events: five }))).toBe(1);

    const broken = [e('HIT'), e('HIT'), e('MISS'), e('HIT'), e('HIT'), e('HIT')];
    expect(advance('run_of_5', match({ events: broken }))).toBe(0);
  });

  it('...and a mine breaks the run too', () => {
    const events = [e('HIT'), e('HIT'), e('MINE_TRIGGERED'), e('HIT'), e('HIT'), e('HIT')];
    expect(advance('run_of_5', match({ events }))).toBe(0);
  });

  it('win_no_arsenal needs a win with nothing bought', () => {
    expect(advance('win_no_arsenal', match({ won: true, boughtArsenal: false }))).toBe(1);
    expect(advance('win_no_arsenal', match({ won: true, boughtArsenal: true }))).toBe(0);
  });

  it('beat_hard_ai needs a win on Hard', () => {
    expect(advance('beat_hard_ai', match({ won: true, difficulty: 'hard' }))).toBe(1);
    expect(advance('beat_hard_ai', match({ won: true, difficulty: 'normal' }))).toBe(0);
    expect(advance('beat_hard_ai', match({ won: false, difficulty: 'hard' }))).toBe(0);
  });

  it('radar_then_hit needs the NEXT shot inside the 3x3', () => {
    const inside = [e('RADAR_RESULT', { at: { r: 4, c: 4 }, count: 2 }), e('HIT', { at: { r: 5, c: 5 } })];
    expect(advance('radar_then_hit', match({ events: inside }))).toBe(1);

    const outside = [e('RADAR_RESULT', { at: { r: 4, c: 4 }, count: 2 }), e('HIT', { at: { r: 9, c: 9 } })];
    expect(advance('radar_then_hit', match({ events: outside }))).toBe(0);

    const missedFirst = [e('RADAR_RESULT', { at: { r: 4, c: 4 }, count: 2 }), e('MISS'), e('HIT', { at: { r: 4, c: 4 } })];
    expect(advance('radar_then_hit', match({ events: missedFirst }))).toBe(0);
  });
});

// ===========================================================================
// "a match that does not qualify advances none"
// ===========================================================================

describe('an empty match advances nothing', () => {
  it('every battle metric stays at zero', () => {
    const nothing = match();
    const metrics: ContractMetric[] = [
      'matches_won',
      'online_won',
      'battleships_sunk',
      'torpedo_sinks',
      'atomic_double',
      'submarine_sinks',
      'aa_downs',
      'gun_double',
      'mine_stops',
      'win_with_4_afloat',
      'run_of_5',
      'win_no_arsenal',
      'beat_hard_ai',
      'radar_then_hit',
    ];
    for (const metric of metrics) {
      expect(advance(metric, nothing), metric).toBe(0);
    }
  });

  it('a match never advances a CITY or RAID metric', () => {
    const busy = match({
      won: true,
      online: true,
      events: [sunk('battleship'), e('MINE_TRIGGERED')],
    });
    for (const metric of ['steel_collected', 'raid_stars', 'defended'] as ContractMetric[]) {
      expect(advance(metric, busy), metric).toBe(0);
    }
  });

  it('a city collection never advances a BATTLE metric', () => {
    const city: MetricSource = {
      kind: 'city',
      city: { steelCollected: 9_999, upgradesFinished: 5, admiraltyLevel: 8, scrapyardCollections: 4 },
    };
    expect(advance('matches_won', city)).toBe(0);
    expect(advance('steel_collected', city)).toBe(9_999);
  });
});

// ===========================================================================
// City and raid metrics
// ===========================================================================

describe('city and raid metrics', () => {
  const city = (patch: Partial<{ steelCollected: number; upgradesFinished: number; admiraltyLevel: number; scrapyardCollections: number }>): MetricSource => ({
    kind: 'city',
    city: { steelCollected: 0, upgradesFinished: 0, admiraltyLevel: 0, scrapyardCollections: 0, ...patch },
  });

  it('steel_collected is the amount, not a count of collections', () => {
    expect(advance('steel_collected', city({ steelCollected: 350 }))).toBe(350);
  });

  it('admiralty_level is the LEVEL, so it completes on issue if already reached', () => {
    expect(advance('admiralty_level', city({ admiraltyLevel: 5 }))).toBe(5);
  });

  it('never returns a negative, however odd the input', () => {
    expect(advance('steel_collected', city({ steelCollected: -50 }))).toBe(0);
  });

  it('raid metrics read the raid summary', () => {
    const raid: MetricSource = {
      kind: 'raid',
      raid: { stars: 3, steelTaken: 400, defended: 1, threeStarred: 1 },
    };
    expect(advance('raid_stars', raid)).toBe(3);
    expect(advance('raid_steel', raid)).toBe(400);
    expect(advance('defended', raid)).toBe(1);
    expect(advance('three_starred', raid)).toBe(1);
  });
});

// ===========================================================================
// §5.5 — the offline daily cap
// ===========================================================================

describe('the offline daily cap', () => {
  it('an OFFLINE match past the cap advances nothing', () => {
    expect(countsTowardContracts(match({ won: true }), false)).toBe(false);
    expect(deltasFor([{ contractId: 'win-1', metric: 'matches_won' }], match({ won: true }), false))
      .toEqual([]);
  });

  it('an ONLINE match is never capped', () => {
    expect(countsTowardContracts(match({ won: true, online: true }), false)).toBe(true);
    expect(
      deltasFor([{ contractId: 'win-1', metric: 'matches_won' }], match({ won: true, online: true }), false),
    ).toEqual([{ contractId: 'win-1', delta: 1 }]);
  });

  it('an offline match inside the cap counts normally', () => {
    expect(
      deltasFor([{ contractId: 'win-1', metric: 'matches_won' }], match({ won: true }), true),
    ).toEqual([{ contractId: 'win-1', delta: 1 }]);
  });

  it('city and raid progress is never capped — the cap is on MATCHES', () => {
    const raid: MetricSource = { kind: 'raid', raid: { stars: 2, steelTaken: 0, defended: 0, threeStarred: 0 } };
    expect(countsTowardContracts(raid, false)).toBe(true);
  });
});

describe('deltasFor', () => {
  it('returns only the contracts that actually moved', () => {
    const active = [
      { contractId: 'win-1', metric: 'matches_won' as ContractMetric },
      { contractId: 'aa-3', metric: 'aa_downs' as ContractMetric },
    ];
    expect(deltasFor(active, match({ won: true }))).toEqual([{ contractId: 'win-1', delta: 1 }]);
  });

  it('returns nothing for a match that did nothing', () => {
    expect(deltasFor([{ contractId: 'win-1', metric: 'matches_won' }], match())).toEqual([]);
  });
});
