/**
 * The Gazette, puzzle and voyage endpoints — part-09 §4.
 *
 *   GET  /gazette              · GET  /puzzle
 *   POST /puzzle/fire {cell}   · GET  /puzzle/leaderboard
 *   POST /voyage/send {route, slot}
 *   POST /voyage/collect {id}  · POST /voyage/skirmish {id, log}
 *
 * Same shape as `server/src/raid/routes.ts`: the user id comes from a verified
 * Supabase token and never from the body, every failure is a typed code, and
 * every response is `no-store`.
 *
 * THE SECRECY BOUNDARY IS HERE AS WELL AS IN THE SERVICE. No handler in this
 * file reads `puzzle.layout` or `skirmish.layout`, and no handler returns a
 * value that could carry one — the puzzle answers with `PuzzleView`, the
 * skirmish with a verdict. `tests/integration/puzzle-db.test.ts` greps every
 * response for an un-hit ship cell, which is the assertion that actually holds
 * this true rather than the comment.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { CityState } from '@engine/city';

import { verifyAccessToken } from '../auth';
import { cityRepo } from '../city/repo';
import {
  collectVoyage,
  firePuzzle,
  gazette,
  gazetteEnabled,
  listVoyages,
  markGazetteRead,
  openPuzzle,
  puzzleLeaderboard,
  sendVoyage,
  statusFor,
  submitSkirmish,
  voyagesEnabled,
  type DailyError,
  type Outcome,
} from './service';
import { dayRecordsFor } from './summary';

const Cell = z.object({
  r: z.number().int().min(0).max(9),
  c: z.number().int().min(0).max(9),
});

const FireBody = z.object({ cell: Cell });

const SendBody = z.object({
  route: z.string().max(32),
  slot: z.number().int().min(0).max(2),
});

const CollectBody = z.object({ id: z.string().uuid() });

/**
 * The submitted log. `seed` is accepted and then IGNORED — the server replays
 * against its own. It is in the schema because the client sends what it played
 * with and a mismatch is worth seeing in the logs, not because it is trusted.
 */
const SkirmishBody = z.object({
  id: z.string().uuid(),
  log: z.object({
    seed: z.number().int(),
    shots: z
      .array(z.object({ r: z.number().int().min(0).max(4), c: z.number().int().min(0).max(4) }))
      .max(50),
    claimedWinner: z.enum(['player', 'pirate']),
  }),
});

async function verifiedUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

function levelOf(state: CityState | undefined, id: string): number {
  const buildings = state?.buildings as Record<string, { level?: number }> | undefined;
  return buildings?.[id]?.level ?? 0;
}

export function registerDailyRoutes(app: FastifyInstance): void {
  async function handle<T>(
    request: { headers: Record<string, unknown>; body?: unknown; query?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    enabled: () => boolean,
    run: (userId: string, body: unknown, now: number) => Promise<Outcome<T>>,
  ): Promise<unknown> {
    const userId = await verifiedUserId(request.headers.authorization as string | undefined);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    if (!enabled()) return reply.code(409).send({ code: 'feature-off' });

    const now = Date.now();
    try {
      const outcome = await run(userId, request.body ?? request.query, now);
      if (!outcome.ok) {
        return reply
          .code(statusFor(outcome.error))
          .send({ code: outcome.error, ...(outcome.detail ? { detail: outcome.detail } : {}) });
      }
      return reply.code(200).send({ ...(outcome.value as object), serverNow: now });
    } catch (error) {
      app.log.error(error, 'daily request failed');
      return reply.code(503).send({ code: 'internal' });
    }
  }

  const bad = <T>(error: DailyError): Outcome<T> => ({ ok: false, error });

  // -------------------------------------------------------------------------
  // The Gazette (§1)
  // -------------------------------------------------------------------------

  app.get('/gazette', async (request, reply) =>
    handle(request as never, reply as never, gazetteEnabled, async (userId, _body, now) => {
      const records = await dayRecordsFor(userId, now);
      return gazette(userId, records, now);
    }),
  );

  app.post('/gazette/read', async (request, reply) =>
    handle(request as never, reply as never, gazetteEnabled, async (userId, _body, now) =>
      markGazetteRead(userId, now),
    ),
  );

  // -------------------------------------------------------------------------
  // The daily puzzle (§2)
  // -------------------------------------------------------------------------

  app.get('/puzzle', async (request, reply) =>
    handle(request as never, reply as never, gazetteEnabled, async (userId, _body, now) =>
      openPuzzle(userId, now),
    ),
  );

  app.post('/puzzle/fire', async (request, reply) =>
    handle(request as never, reply as never, gazetteEnabled, async (userId, body, now) => {
      const parsed = FireBody.safeParse(body);
      if (!parsed.success) return bad('illegal-cell');
      return firePuzzle(userId, parsed.data.cell, now);
    }),
  );

  app.get('/puzzle/leaderboard', async (request, reply) =>
    handle(request as never, reply as never, gazetteEnabled, async (userId, _body, now) =>
      puzzleLeaderboard(userId, now),
    ),
  );

  // -------------------------------------------------------------------------
  // Trade voyages (§3)
  // -------------------------------------------------------------------------

  app.get('/voyage', async (request, reply) =>
    handle(request as never, reply as never, voyagesEnabled, async (userId, _body, now) =>
      listVoyages(userId, now),
    ),
  );

  app.post('/voyage/send', async (request, reply) =>
    handle(request as never, reply as never, voyagesEnabled, async (userId, body, now) => {
      const parsed = SendBody.safeParse(body);
      if (!parsed.success) return bad('unknown-route');

      // §3 — "Merchant ships = Trade Docks level". The level is the city's,
      // read here; a client cannot claim three slots by asking for slot 2.
      const city = await cityRepo().load(userId, now);
      const docks = levelOf(city?.state, 'trade_docks');

      return sendVoyage(userId, parsed.data.route, parsed.data.slot, docks, now);
    }),
  );

  app.post('/voyage/collect', async (request, reply) =>
    handle(request as never, reply as never, voyagesEnabled, async (userId, body, now) => {
      const parsed = CollectBody.safeParse(body);
      if (!parsed.success) return bad('not-found');
      return collectVoyage(userId, parsed.data.id, now);
    }),
  );

  app.post('/voyage/skirmish', async (request, reply) =>
    handle(request as never, reply as never, voyagesEnabled, async (userId, body, now) => {
      const parsed = SkirmishBody.safeParse(body);
      if (!parsed.success) return bad('not-found');
      return submitSkirmish(userId, parsed.data.id, parsed.data.log, now);
    }),
  );
}
