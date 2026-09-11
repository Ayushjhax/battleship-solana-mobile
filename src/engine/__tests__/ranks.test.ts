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
