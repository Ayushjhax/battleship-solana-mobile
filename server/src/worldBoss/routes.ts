import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAccessToken } from '../auth';
import { isEnabled } from '../features';
import { SerializedWorldBoss } from './service';

const boss = new SerializedWorldBoss(Number.parseInt(process.env.WORLD_BOSS_SEED ?? '11011', 10) || 11011);
const Shot = z.object({
  requestId: z.string().min(1).max(128),
  row: z.number().int().min(0).max(29),
  col: z.number().int().min(0).max(29),
});

async function userId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

export function registerWorldBossRoutes(app: FastifyInstance): void {
  app.get('/world-boss', async (request, reply) => {
    const playerId = await userId(request.headers.authorization);
    if (!playerId) return reply.code(401).send({ code: 'unauthenticated' });
    if (!isEnabled('portCity.worldBoss')) return reply.code(409).send({ code: 'feature-off' });
    reply.header('Cache-Control', 'no-store');
    return reply.send({ board: boss.snapshot(), serverNow: Date.now() });
  });

  app.post('/world-boss/shot', async (request, reply) => {
    const playerId = await userId(request.headers.authorization);
    if (!playerId) return reply.code(401).send({ code: 'unauthenticated' });
    if (!isEnabled('portCity.worldBoss')) return reply.code(409).send({ code: 'feature-off' });
    const parsed = Shot.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'cell-out-of-bounds' });
    const now = new Date();
    const outcome = await boss.shoot({
      requestId: parsed.data.requestId,
      playerId,
      coord: { row: parsed.data.row, col: parsed.data.col },
      day: now.toISOString().slice(0, 10),
      // Production extras are deliberately never accepted from the body.
      gazetteBonus: false,
      fleetWarRaids: 0,
    });
    if (!outcome.ok) return reply.code(outcome.error === 'no-shots-left' ? 409 : 400).send({ code: outcome.error });
    return reply.send({ ...outcome, serverNow: now.getTime() });
  });
}

