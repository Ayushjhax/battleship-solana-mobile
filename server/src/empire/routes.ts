import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyAccessToken } from '../auth';
import { isEnabled } from '../features';
import { EmpireService } from './service';

const empire = new EmpireService();
const Collect = z.object({ requestId: z.string().min(1).max(128) });
const Complete = z.object({ portId: z.string().regex(/^port-\d\d$/), shots: z.array(z.object({ row: z.number().int().min(0).max(9), col: z.number().int().min(0).max(9) })).max(100) });
async function player(authorization: string | undefined) { const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; if (!token) return null; const verified = await verifyAccessToken(token); return verified.ok ? verified.token.userId : null; }

export function registerEmpireRoutes(app: FastifyInstance): void {
  app.get('/empire', async (request, reply) => { const id = await player(request.headers.authorization); if (!id) return reply.code(401).send({ code: 'unauthenticated' }); if (!isEnabled('portCity.empire')) return reply.code(409).send({ code: 'feature-off' }); const now = Date.now(); return reply.send({ ...empire.view(id, now), serverNow: now }); });
  app.post('/empire/tribute', async (request, reply) => { const id = await player(request.headers.authorization); if (!id) return reply.code(401).send({ code: 'unauthenticated' }); if (!isEnabled('portCity.empire')) return reply.code(409).send({ code: 'feature-off' }); const parsed = Collect.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ code: 'invalid-request' }); const now = Date.now(); const collected = await empire.collect(id, parsed.data.requestId, now); return reply.send({ collected, ...empire.view(id, now), serverNow: now }); });
  app.post('/empire/complete', async (request, reply) => { const id = await player(request.headers.authorization); if (!id) return reply.code(401).send({ code: 'unauthenticated' }); if (!isEnabled('portCity.empire')) return reply.code(409).send({ code: 'feature-off' }); const parsed = Complete.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ code: 'invalid-transcript' }); const now = Date.now(); try { return reply.send({ ...empire.completeTranscript(id, parsed.data.portId, parsed.data.shots, now), serverNow: now }); } catch { return reply.code(404).send({ code: 'unknown-port' }); } });
}
