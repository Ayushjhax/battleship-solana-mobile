/**
 * The Bounty Board and Captain's Log endpoints — part-04 §3.
 *
 * `GET /bounties` · `POST /bounties/claim {slot}` · `POST /bounties/reroll
 * {slot}` · `GET /log` · `POST /log/claim {page}` · `POST /log/premium
 * {requestId}`.
 *
 * THERE IS NO PROGRESS ENDPOINT, and that is the point. §3: "Progress is never
 * accepted from the client." Contracts advance from `settleMatchExtras`, which
 * the match settlement calls with facts the server built itself. A client
 * cannot reach `contracts_advance` because nothing routes to it.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { verifyAccessToken } from '../auth';
import { cityRepo } from '../city/repo';
import { enabledPlotFeatures, isEnabled } from '../features';
import {
  bountiesEnabled,
  buyPremium,
  claimContract,
  claimLogPages,
  readBoard,
  readLog,
  rerollContract,
  type Outcome,
} from './service';

const SlotBody = z.object({ requestId: z.string().uuid(), slot: z.number().int().min(0).max(255) });
const PageBody = z.object({ requestId: z.string().uuid(), page: z.number().int().min(1).max(30) });
const PremiumBody = z.object({ requestId: z.string().uuid() });

async function verifiedUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

/**
 * The flags a contract's `requires` is checked against, at ISSUE time (§4).
 * A raid contract is never DRAWN for a player whose raids flag is off, rather
 * than drawn and hidden — a hidden one would leave a slot showing nothing.
 */
function flagSet(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const feature of enabledPlotFeatures()) out.add(`portCity.${feature}`);
  if (isEnabled('portCity.raids')) out.add('portCity.raids');
  return out;
}

export function registerBountyRoutes(app: FastifyInstance): void {
  async function handle<T>(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown, now: number) => Promise<Outcome<T>>,
  ): Promise<unknown> {
    const userId = await verifiedUserId(request.headers.authorization as string | undefined);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    if (!bountiesEnabled()) return reply.code(409).send({ code: 'feature-off' });

    const now = Date.now();
    try {
      const outcome = await run(userId, request.body, now);
      return outcome.ok
        ? reply.code(200).send({ ...(outcome.body as object), serverNow: now })
        : reply.code(outcome.error === 'internal' ? 503 : 409).send({ code: outcome.error });
    } catch (error) {
      app.log.error(error, 'bounty request failed');
      return reply.code(503).send({ code: 'internal' });
    }
  }

  app.get('/bounties', async (request, reply) =>
    handle(request as never, reply as never, (userId, _body, now) =>
      readBoard(userId, now, flagSet()),
    ),
  );

  app.post('/bounties/claim', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = SlotBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'unknown-slot' as const };
      return claimContract(userId, parsed.data.slot, now);
    }),
  );

  app.post('/bounties/reroll', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = SlotBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'unknown-slot' as const };
      const city = await cityRepo().load(userId, now);
      return rerollContract(userId, parsed.data.slot, now, city?.gems ?? 0, flagSet());
    }),
  );

  app.get('/log', async (request, reply) =>
    handle(request as never, reply as never, (userId, _body, now) => readLog(userId, now)),
  );

  app.post('/log/claim', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = PageBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-claimable' as const };
      // ONE page per call, and the service still checks it was earned — a
      // client asking for page 30 on zero ink gets nothing.
      return claimLogPages(userId, [parsed.data.page], now);
    }),
  );

  app.post('/log/premium', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = PremiumBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-claimable' as const };
      return buyPremium(userId, now);
    }),
  );
}
