/** The demo match is rigged by knowledge, not by cheating: prove the script in docs/DEMO.md holds. */
import { createMatch, reduce } from '@engine/match';
import { validateArsenalPlacement, validateLayout } from '@engine/placement';
import { emptyBoard } from '@engine/board';
import type { MatchState } from '@engine/types';
import { describe, expect, it } from 'vitest';

import { cell } from '@/tutorial/script';
import { DEMO_ENEMY_ARSENAL, DEMO_ENEMY_FLEET, DEMO_OWN_ARSENAL, DEMO_OWN_FLEET, buildDemoSetup } from '../demoMatch';

const setup = buildDemoSetup({ name: 'Ayush', avatarId: 1, avatarColor: '#3E2FB8', countryCode: 'IN', rankPoints: 0 });

function start(): MatchState {
  let m = createMatch({ id: 'demo', mode: 'advanced', seed: setup.seed, playerIds: ['p1', 'ai'] });
  for (const side of [setup.one, setup.two]) {
    const r = reduce(m, { type: 'SUBMIT_LAYOUT', playerId: side.id, ships: side.ships, arsenal: side.arsenal });
    expect(r.events.some((e) => e.type === 'REJECTED')).toBe(false);
    m = r.state;
  }
  return m;
}

describe('the scripted demo match', () => {
  it('both fleets and every own-board item are legal', () => {
    expect(validateLayout(DEMO_OWN_FLEET).ok).toBe(true);
    expect(validateLayout(DEMO_ENEMY_FLEET).ok).toBe(true);
    for (const [ships, arsenal] of [
      [DEMO_OWN_FLEET, DEMO_OWN_ARSENAL],
      [DEMO_ENEMY_FLEET, DEMO_ENEMY_ARSENAL],
    ] as const) {
      const placed = arsenal.filter((i) => i.at);
      placed.forEach((item, n) => {
        const board = { ...emptyBoard(), ships, arsenal: placed.slice(0, n) };
        expect(validateArsenalPlacement(board, item).ok).toBe(true);
      });
    }
  });

  it('the presenter has the first turn', () => {
    expect(start().turn).toBe('p1');
  });

  it('B2-B5 sinks the battleship in four shots, keeping the turn', () => {
    let m = start();
    for (const at of ['B2', 'B3', 'B4']) {
      const r = reduce(m, { type: 'FIRE', playerId: 'p1', at: cell(at) });
      expect(r.events.map((e) => e.type)).toContain('HIT');
      m = r.state;
      expect(m.turn).toBe('p1');
    }
    const r = reduce(m, { type: 'FIRE', playerId: 'p1', at: cell('B5') });
    expect(r.events.map((e) => e.type)).toContain('SUNK');
  });

  it('a bomber dropped on row E flies into the AA gun at E9 — the set piece', () => {
    const m = start();
    const r = reduce(m, { type: 'USE_ARSENAL', playerId: 'p1', itemId: 'demo-bomber-1', at: cell('E5') });
    const downed = r.events.find((e) => e.type === 'AIRCRAFT_DOWNED');
    expect(downed).toBeDefined();
    expect(downed && 'gunAt' in downed ? downed.gunAt : null).toEqual(cell('E9'));
  });
});
