import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RANKS, REWARD, rankFor, rankProgress } from '../ranks';

describe('ranks', () => {
  it('matches the brief thresholds', () => {
    expect(RANKS.map((r) => r.points)).toEqual([0, 100, 400, 1000, 3000, 10000]);
  });

  it('reads like the reference screenshots', () => {
    const recruit = rankProgress(10);
    expect(recruit.rank.name).toBe('Seaman Recruit');
    expect(`${recruit.current}/${recruit.total}`).toBe('10/100');

    const apprentice = rankProgress(239);
    expect(apprentice.rank.name).toBe('Seaman Apprentice');
    expect(`${apprentice.current}/${apprentice.total}`).toBe('139/300');
  });

  it('holds at the top rank without a next band', () => {
    const top = rankProgress(12000);
    expect(top.rank.name).toBe('Vice-admiral');
    expect(top.next).toBeNull();
    expect(top.total).toBeGreaterThan(0);
  });

  it('rewards a loss less than a win but never zero', () => {
    expect(REWARD.win.points).toBeGreaterThan(REWARD.loss.points);
    expect(REWARD.loss.points).toBeGreaterThan(0);
    expect(rankFor(99).name).toBe('Seaman Recruit');
    expect(rankFor(100).name).toBe('Seaman Apprentice');
  });
});

describe('the ranks table (supabase/migrations/0003_ranks.sql)', () => {
  // The engine is the source of truth in code; the migration is the copy the
  // leaderboard and server join against. Crossing a threshold triggers the
  // rank-up beat (app/(game)/result.tsx), so the two may never drift.
  const sql = readFileSync(new URL('../../../supabase/migrations/0003_ranks.sql', import.meta.url), 'utf8');
  const rows = [...sql.matchAll(/\((\d+),\s*'([^']+)',\s*(\d+)\)/g)].map((m) => ({
    id: Number(m[1]),
    name: m[2],
    points: Number(m[3]),
  }));

  it('lists exactly the engine ladder, in order, with the same thresholds', () => {
    expect(rows.map((r) => ({ name: r.name, points: r.points }))).toEqual(
      RANKS.map((r) => ({ name: r.name, points: r.points })),
    );
    expect(rows.map((r) => r.id)).toEqual(RANKS.map((_, i) => i + 1));
  });

  it('every threshold in the table is where rankFor() changes rank', () => {
    for (const row of rows) {
      expect(rankFor(row.points).name).toBe(row.name);
      if (row.points > 0) expect(rankFor(row.points - 1).name).not.toBe(row.name);
    }
  });
});
