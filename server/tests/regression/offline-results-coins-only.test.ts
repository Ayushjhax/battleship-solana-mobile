/**
 * BUG-010 / BUG-021: offline and hot-seat results are the device's word, so
 * they no longer count toward the ladder (0015) — and the coins they still pay
 * now come from src/engine/ranks.ts through the server, like a match
 * settlement's rewards, instead of being hard-coded in SQL.
 */
import { REWARD } from '@engine/ranks';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  applyOfflineResult: vi.fn(),
  fetchProfileRewardTotals: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock('../../src/privy', () => ({ verifyAndLoadPrivyUser: vi.fn(), normalizePrivyUser: vi.fn() }));
vi.mock('../../src/privySession', () => ({ bootstrapPrivySession: vi.fn() }));
vi.mock('../../src/ws', () => ({ attachWebSocketServer: vi.fn() }));
vi.mock('../../src/db', () => ({
  verifyDatabaseConnection: vi.fn(),
  verifyAuthAdminAccess: vi.fn(),
  checkDatabaseSchema: vi.fn(),
  upsertPrivyAccount: vi.fn(),
  applyOfflineResult: mocks.applyOfflineResult,
  fetchProfileRewardTotals: mocks.fetchProfileRewardTotals,
}));

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyAccessToken.mockResolvedValue({ ok: true, token: { userId: 'profile-1', isAnonymous: false } });
  mocks.applyOfflineResult.mockResolvedValue(undefined);
  mocks.fetchProfileRewardTotals.mockResolvedValue({ rankPoints: 0, battlesPlayed: 0, battlesWon: 0, coins: 50 });
});

describe('POST /offline-results', () => {
  it('passes the engine coin rewards to the settlement', async () => {
    const { app } = await import('../../src/index');
    await app.ready();
    const result = { id: 'hotseat-1', mode: 'hotseat', won: true, completedAt: '2026-10-05T00:00:00.000Z' };

    const response = await app.inject({
      method: 'POST',
      url: '/offline-results',
      headers: { authorization: 'Bearer gameplay-jwt' },
      payload: { results: [result] },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.applyOfflineResult).toHaveBeenCalledWith('profile-1', result, {
      win: REWARD.win.coins,
      loss: REWARD.loss.coins,
    });
  });
});
