/**
 * Hardening — every PORT_CITY_* variable unset, server HTTP surface.
 *
 * "Default OFF" is the load-bearing guarantee of the whole Port City build:
 * a production deploy that forgets the flags must behave exactly like the
 * game before it. The existing suites check this service by service
 * (city-api, raid-api, flagOff, ...); this file is the end-to-end sweep of
 * the REAL Fastify app with every feature env var deleted:
 *
 *   - every Port City endpoint answers 409 with a typed `feature-off` code;
 *   - nothing answers 500 and nothing returns a stack;
 *   - /config reports every flag false and no season sea.
 *
 * The `db` seam throws. If any flag-off endpoint touched the database — the
 * one thing a dark feature must never do — the request would answer 503 and
 * the sweep would fail on that endpoint by name.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token
      ? { ok: true, token: { userId: '11111111-1111-4111-8111-111111111111', isAnonymous: false } }
      : { ok: false, reason: 'no token' },
  ),
}));

vi.mock('../../src/privy', () => ({
  verifyAndLoadPrivyUser: vi.fn(),
  normalizePrivyUser: vi.fn(),
}));
vi.mock('../../src/privySession', () => ({
  bootstrapPrivySession: vi.fn(),
  db: () => {
    throw new Error('db() called with every Port City flag off');
  },
  upsertPrivyAccount: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
  db: () => {
    throw new Error('db() called with every Port City flag off');
  },
  abandonMatch: vi.fn(),
  appendMatchEvent: vi.fn(),
  applyMatchResult: vi.fn(),
  applyOfflineResult: vi.fn(),
  beginPointSell: vi.fn(),
  cancelWageredMatchBeforeStart: vi.fn(),
  checkDatabaseSchema: vi.fn(),
  completePointBuy: vi.fn(),
  completePointSell: vi.fn(),
  dbEndReason: vi.fn(),
  fetchOpponentSummary: vi.fn(),
  fetchPointBalance: vi.fn(),
  fetchPointTrade: vi.fn(),
  fetchProfileRewardTotals: vi.fn(),
  fetchVerifiedWalletAddress: vi.fn(),
  insertMatch: vi.fn(),
  insertWageredMatch: vi.fn(),
  markPointSellBroadcast: vi.fn(),
  refundPointSell: vi.fn(),
  refundPointWager: vi.fn(),
  reservePointWager: vi.fn(),
  settleOfflineWager: vi.fn(),
  upsertPrivyAccount: vi.fn(),
  verifyAuthAdminAccess: vi.fn(),
  verifyDatabaseConnection: vi.fn(),
}));

vi.mock('../../src/ws', () => ({ attachWebSocketServer: vi.fn() }));

import { FEATURE_KEYS, envNameFor } from '../../src/features';

const USER = '11111111-1111-4111-8111-111111111111';
const RAID = 'aaaaaaaa-0000-4000-8000-000000000001';
const REQUEST = '99999999-0000-4000-8000-000000000001';
const AUTH = { authorization: `Bearer ${USER}` };

interface Endpoint {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly payload?: Record<string, unknown>;
}

/** Every Port City endpoint, with a valid body where parsing precedes the gate. */
const ENDPOINTS: readonly Endpoint[] = [
  // city — part-01
  { method: 'GET', url: '/city' },
  { method: 'POST', url: '/city/build', payload: { requestId: REQUEST, buildingId: 'fish_market' } },
  { method: 'POST', url: '/city/speedup', payload: { requestId: REQUEST, buildingId: 'fish_market' } },
  { method: 'POST', url: '/city/cancel', payload: { requestId: REQUEST, buildingId: 'fish_market' } },
  { method: 'POST', url: '/city/collect', payload: { requestId: REQUEST, buildingId: 'fish_market' } },
  { method: 'POST', url: '/city/collect-all', payload: { requestId: REQUEST } },
  { method: 'POST', url: '/city/workers/buy', payload: { requestId: REQUEST } },
  // city — part-05 research
  { method: 'GET', url: '/city/research' },
  { method: 'POST', url: '/city/research/start', payload: { requestId: REQUEST, item: 'sonar_net' } },
  { method: 'POST', url: '/city/research/rush', payload: { requestId: REQUEST } },
  // raid — part-06/07
  { method: 'GET', url: '/raid/harbour' },
  { method: 'POST', url: '/raid/harbour', payload: { layout: { ships: [], arsenal: [] } } },
  { method: 'POST', url: '/raid/search', payload: { requestId: REQUEST, searchesThisSession: 0 } },
  { method: 'POST', url: '/raid/open', payload: {} },
  { method: 'POST', url: '/raid/action', payload: { kind: 'retreat', raidId: RAID } },
  { method: 'POST', url: '/raid/settle', payload: { raidId: RAID } },
  { method: 'GET', url: '/raid/log' },
  { method: 'POST', url: '/raid/log/read', payload: { raidIds: [] } },
  { method: 'POST', url: '/raid/revenge', payload: { raidId: RAID } },
  { method: 'GET', url: `/raid/replay/${RAID}` },
  { method: 'GET', url: '/raid/status' },
  // fleet + war — part-08
  { method: 'GET', url: '/fleet' },
  { method: 'POST', url: '/fleet/create', payload: {} },
  { method: 'POST', url: '/fleet/leave', payload: {} },
  { method: 'POST', url: '/fleet/chat', payload: {} },
  { method: 'GET', url: '/fleet/chat' },
  { method: 'GET', url: '/fleet/flags' },
  { method: 'GET', url: '/fleet/donations' },
  { method: 'POST', url: '/fleet/donation/request', payload: {} },
  { method: 'POST', url: '/fleet/donation/fill', payload: {} },
  { method: 'POST', url: '/war/start', payload: {} },
  { method: 'POST', url: '/war/opt-in', payload: {} },
  { method: 'POST', url: '/war/harbour', payload: {} },
  { method: 'POST', url: '/war/raid', payload: {} },
  { method: 'GET', url: '/war' },
  { method: 'GET', url: `/visit/${USER}` },
  { method: 'GET', url: `/fleet/friendly/${USER}` },
  // bounties + log — part-04
  { method: 'GET', url: '/bounties' },
  { method: 'POST', url: '/bounties/claim', payload: {} },
  { method: 'POST', url: '/bounties/reroll', payload: {} },
  { method: 'GET', url: '/log' },
  { method: 'POST', url: '/log/claim', payload: {} },
  { method: 'POST', url: '/log/premium', payload: {} },
  // cosmetics — part-03
  { method: 'GET', url: '/cosmetics' },
  { method: 'POST', url: '/cosmetics/buy', payload: {} },
  { method: 'POST', url: '/cosmetics/equip', payload: {} },
  // daily: gazette, puzzle, voyages — part-09
  { method: 'GET', url: '/gazette' },
  { method: 'POST', url: '/gazette/read', payload: {} },
  { method: 'GET', url: '/puzzle' },
  { method: 'POST', url: '/puzzle/fire', payload: {} },
  { method: 'GET', url: '/puzzle/leaderboard' },
  { method: 'GET', url: '/voyage' },
  { method: 'POST', url: '/voyage/send', payload: {} },
  { method: 'POST', url: '/voyage/collect', payload: {} },
  { method: 'POST', url: '/voyage/skirmish', payload: {} },
  // world boss — part-10
  { method: 'GET', url: '/world-boss' },
  { method: 'POST', url: '/world-boss/shot', payload: {} },
  // empire — part-11
  { method: 'GET', url: '/empire' },
  { method: 'POST', url: '/empire/tribute', payload: {} },
  { method: 'POST', url: '/empire/complete', payload: {} },
];

let app: Awaited<typeof import('../../src/index')>['app'];

beforeAll(async () => {
  ({ app } = await import('../../src/index'));
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  for (const key of FEATURE_KEYS) delete process.env[envNameFor(key)];
});

describe('every Port City flag off', () => {
  it('/config reports every flag false and no season sea', async () => {
    const response = await app.inject({ method: 'GET', url: '/config' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      features: Record<string, boolean>;
      seasonSea: unknown;
    };
    for (const key of FEATURE_KEYS) {
      expect(body.features[key], key).toBe(false);
    }
    expect(Object.keys(body.features).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(body.seasonSea).toBeNull();
  });

  it('every Port City endpoint answers a typed feature-off, never a 500', async () => {
    const failures: string[] = [];

    for (const endpoint of ENDPOINTS) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url,
        headers: AUTH,
        ...(endpoint.payload ? { payload: endpoint.payload } : {}),
      });
      const body = response.json() as { code?: string; stack?: string };

      const label = `${endpoint.method} ${endpoint.url}`;
      if (response.statusCode !== 409) failures.push(`${label}: HTTP ${response.statusCode}`);
      else if (body.code !== 'feature-off') failures.push(`${label}: code ${String(body.code)}`);
      if (body.stack !== undefined) failures.push(`${label}: returned a stack`);
    }

    expect(failures).toEqual([]);
  }, 60_000);

  it('an unauthenticated caller still gets 401 first, not the flag state', async () => {
    const response = await app.inject({ method: 'GET', url: '/city' });
    expect(response.statusCode).toBe(401);
  });
});
