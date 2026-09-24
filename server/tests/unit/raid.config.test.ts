/**
 * `raid.shells` — part-06 §2.
 *
 * The instruction for this part was explicit: do not change the 30-shell
 * budget, but make it server-configurable. So there are two things to prove —
 * that the default really is still 30, and that an override actually reaches
 * a raid.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { RAID_DEFAULTS, startRaid, type HarbourLayout } from '@engine/raid';
import { generateDefaultHarbour } from '@engine/raid';

import { RAID_ENGINE_VERSION, envNameFor, raidConfig, raidLimits } from '../../src/raid/config';

const KEYS = [
  'RAID_SHELLS',
  'RAID_MINE_PENALTY',
  'RAID_TIME_LIMIT_MS',
  'RAID_LOCK_MINUTES',
  'RAID_REPEAT_HOURS',
  'RAID_DISCONNECT_GRACE_MS',
  'RAID_ACTIONS_PER_SECOND',
  'RAID_MAX_REJECTS',
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

const layout = (): HarbourLayout =>
  generateDefaultHarbour(1, {
    admiraltyLevel: 5,
    coastalCommandLevel: 5,
    unlocks: ['sonar_net', 'decoy', 'minesweeper'],
  });

describe('the env name mapping', () => {
  it('turns raid.shells into RAID_SHELLS', () => {
    expect(envNameFor('raid.shells')).toBe('RAID_SHELLS');
    expect(envNameFor('raid.minePenalty')).toBe('RAID_MINE_PENALTY');
    expect(envNameFor('raid.timeLimitMs')).toBe('RAID_TIME_LIMIT_MS');
  });
});

describe('raidConfig', () => {
  it('defaults to the calibrated budget, unchanged', () => {
    expect(raidConfig().shells).toBe(30);
    expect(raidConfig()).toEqual(RAID_DEFAULTS);
  });

  it('an override reaches the raid', () => {
    process.env.RAID_SHELLS = '45';
    expect(raidConfig().shells).toBe(45);
    expect(startRaid(layout(), {}, 0, raidConfig()).shells).toBe(45);
  });

  it('the mine penalty and the clock are configurable too', () => {
    process.env.RAID_MINE_PENALTY = '4';
    process.env.RAID_TIME_LIMIT_MS = '120000';
    expect(raidConfig().minePenalty).toBe(4);
    expect(raidConfig().timeLimitMs).toBe(120_000);
  });

  it('a mine penalty of zero is legal — it is the one value that may be 0', () => {
    process.env.RAID_MINE_PENALTY = '0';
    expect(raidConfig().minePenalty).toBe(0);
  });

  it('falls back on anything unparseable rather than handing out 0 shells', () => {
    for (const bad of ['', '  ', 'thirty', '30.5', '-5', '0', 'NaN', 'Infinity']) {
      process.env.RAID_SHELLS = bad;
      expect(raidConfig().shells, `RAID_SHELLS="${bad}"`).toBe(30);
    }
  });

  it('is read fresh every time, so a deploy-time change needs no restart hook', () => {
    expect(raidConfig().shells).toBe(30);
    process.env.RAID_SHELLS = '12';
    expect(raidConfig().shells).toBe(12);
  });
});

describe('raidLimits', () => {
  it('carries §5 and §10 defaults', () => {
    expect(raidLimits()).toMatchObject({
      lockMinutes: 6,
      repeatHours: 24,
      disconnectGraceMs: 60_000,
      clockGraceMs: 10_000,
      actionsPerSecond: 4,
      maxRejects: 5,
    });
  });

  it('is overridable', () => {
    process.env.RAID_LOCK_MINUTES = '2';
    process.env.RAID_MAX_REJECTS = '3';
    expect(raidLimits().lockMinutes).toBe(2);
    expect(raidLimits().maxRejects).toBe(3);
  });
});

describe('the engine version stamp', () => {
  it('is a non-empty string, stored on every raid_log row', () => {
    expect(RAID_ENGINE_VERSION).toBeTruthy();
    expect(typeof RAID_ENGINE_VERSION).toBe('string');
  });
});
