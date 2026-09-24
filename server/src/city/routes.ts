/**
 * The seven city endpoints — part-01 §4.
 *
 * Every one is authenticated as the current user: the profile id comes from a
 * verified Supabase token, never from the body, so user A cannot touch user
 * B's city (§8.2.15) by construction — there is no parameter that would let
 * them try.
 *
 * Every response is `{ city, serverNow }`. Every failure is a typed code with
 * HTTP 409 (404 for a missing profile), never free text.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { verifyAccessToken } from '../auth';
import { actOnCity, readCity, statusFor, type CityAction, type CityOutcome } from './service';
import {
  beginResearch,
  readResearch,
  rushResearchNow,
  statusForResearch,
  type ResearchOutcome,
} from './research';

const RequestBody = z.object({ requestId: z.string().uuid() });
const BuildingBody = RequestBody.extend({ buildingId: z.string().min(1).max(64) });
const ResearchBody = RequestBody.extend({ item: z.string().min(1).max(32) });

async function verifiedUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

export function registerCityRoutes(app: FastifyInstance): void {
  /** Shared plumbing: verify, parse, run, answer. */
  async function handle(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown, now: number) => Promise<CityOutcome>,
  ): Promise<unknown> {
    const authorization = request.headers.authorization as string | undefined;
    const userId = await verifiedUserId(authorization);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    const now = Date.now();
    try {
      const outcome = await run(userId, request.body, now);
      if (!outcome.ok) {
        return reply.code(statusFor(outcome.error)).send({ code: outcome.error });
      }
      return reply.code(200).send(outcome.body);
    } catch (error) {
      app.log.error(error, 'city request failed');
      return reply.code(503).send({ code: 'internal' });
    }
  }

  /**
   * part-05 §5 — the Naval Academy's research queue. Its OWN queue: it does
   * not take a dock worker, so these three do not touch `freeWorkers`.
   *
   * Behind `portCity.academy`, not `portCity.core`: the items are Part 5's.
   */
  async function research(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown, now: number) => Promise<ResearchOutcome>,
  ): Promise<unknown> {
    const userId = await verifiedUserId(request.headers.authorization as string | undefined);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    const now = Date.now();
    try {
      const outcome = await run(userId, request.body, now);
      return outcome.ok
        ? reply.code(200).send(outcome.body)
        : reply.code(statusForResearch(outcome.error)).send({ code: outcome.error });
    } catch (error) {
      app.log.error(error, 'research request failed');
      return reply.code(503).send({ code: 'internal' });
    }
  }

  app.get('/city/research', async (request, reply) =>
    research(request as never, reply as never, (userId, _body, now) => readResearch(userId, now)),
  );

  app.post('/city/research/start', async (request, reply) =>
    research(request as never, reply as never, async (userId, body, now) => {
      const parsed = ResearchBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'unknown-item' as const };
      return beginResearch(userId, parsed.data.item as never, now);
    }),
  );

  app.post('/city/research/rush', async (request, reply) =>
    research(request as never, reply as never, (userId, _body, now) => rushResearchNow(userId, now)),
  );

  app.get('/city', async (request, reply) =>
    handle(request as never, reply as never, (userId, _body, now) => readCity(userId, now)),
  );

  const mutation = (
    path: string,
    schema: typeof RequestBody | typeof BuildingBody,
    toAction: (body: z.infer<typeof BuildingBody>) => CityAction,
  ) => {
    app.post(path, async (request, reply) =>
      handle(request as never, reply as never, async (userId, body, now) => {
        const parsed = schema.safeParse(body);
        if (!parsed.success) return { ok: false as const, error: 'unknown-building' as const };
        const data = parsed.data as z.infer<typeof BuildingBody>;
        return actOnCity(userId, toAction(data), data.requestId, now);
      }),
    );
  };

  mutation('/city/build', BuildingBody, (b) => ({ kind: 'build', buildingId: b.buildingId }));
  mutation('/city/speedup', BuildingBody, (b) => ({ kind: 'speedup', buildingId: b.buildingId }));
  mutation('/city/cancel', BuildingBody, (b) => ({ kind: 'cancel', buildingId: b.buildingId }));
  mutation('/city/collect', BuildingBody, (b) => ({ kind: 'collect', buildingId: b.buildingId }));
  mutation('/city/collect-all', RequestBody, () => ({ kind: 'collect-all' }));
  mutation('/city/workers/buy', RequestBody, () => ({ kind: 'buy-worker' }));
}
