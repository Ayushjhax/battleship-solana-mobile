import { describe, expect, it } from 'vitest';
import {
  WORLD_BOSS_SHIP_LENGTHS, bossCoordKey, dailyShotAllowance, generateBossLayout,
  publicBossBoard, reachedMilestones, resolveBossCell,
} from '@engine/worldBoss';

describe('11B seeded Great Armada', () => {
  it('builds the same 30x30, 40-ship wave from the same seed', () => {
    const a = generateBossLayout(42);
    expect(a).toEqual(generateBossLayout(42));
    expect(a.size).toBe(30);
    expect(a.ships).toHaveLength(40);
    expect(a.ships.map((ship) => ship.cells.length)).toEqual(WORLD_BOSS_SHIP_LENGTHS);
    expect(a.ships[0]).toMatchObject({ id: 'flagship', kind: 'flagship' });
    expect(a.ships[0]?.cells).toHaveLength(6);
  });

  it('obeys the one-cell halo', () => {
    const layout = generateBossLayout(99);
    for (let a = 0; a < layout.ships.length; a++) for (let b = a + 1; b < layout.ships.length; b++) {
      for (const x of layout.ships[a]!.cells) for (const y of layout.ships[b]!.cells) {
        expect(Math.max(Math.abs(x.row - y.row), Math.abs(x.col - y.col))).toBeGreaterThan(1);
      }
    }
  });

  it('never sends unresolved ship cells to the public client', () => {
    const layout = generateBossLayout(7);
    const target = layout.ships[0]!.cells[0]!;
    const board = publicBossBoard(layout, { [bossCoordKey(target)]: resolveBossCell(layout, target) });
    const wire = JSON.stringify(board);
    for (const ship of layout.ships) for (const cell of ship.cells) {
      if (bossCoordKey(cell) !== bossCoordKey(target)) expect(wire).not.toContain(`\"${bossCoordKey(cell)}\"`);
    }
    expect(wire).not.toContain('ships');
    expect(wire).not.toContain('mines');
  });

  it('grants five base shots and caps extras at ten', () => {
    expect(dailyShotAllowance(false, 0)).toBe(5);
    expect(dailyShotAllowance(true, 0)).toBe(6);
    expect(dailyShotAllowance(true, 99)).toBe(10);
  });

  it('reports each crossed milestone once', () => {
    expect(reachedMilestones(24, 76)).toEqual([25, 50, 75]);
    expect(reachedMilestones(75, 100)).toEqual([100]);
  });
});
