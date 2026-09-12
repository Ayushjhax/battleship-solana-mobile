/**
 * Match server entry point. Fastify for HTTP, ws for the live match socket.
 * Run it with `npm run server` from the repo root, or `npm run dev` here.
 */
try {
  // Local dev: server/.env (see .env.example). Deployed (Fly/Railway), the
  // platform injects real env vars and there is no file to load — a missing
  // file here is expected and silently skipped, never a startup failure.
  process.loadEnvFile();
} catch {
  /* no .env file — fine in production */
}

import Fastify from 'fastify';
import { z } from 'zod';

import { verifyAccessToken } from './auth';
import { applyOfflineResult, fetchProfileRewardTotals } from './db';
import { totalQueued } from './matchmaker';
import { rooms } from './room';
import { attachWebSocketServer } from './ws';

const port = Number(process.env.PORT ?? 8080);
const startedAt = Date.now();

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  ok: true,
  service: 'seabattle-match-server',
  rooms: rooms.size,
  queued: totalQueued(),
  uptime: Math.floor((Date.now() - startedAt) / 1000),
}));

const OfflineResultsBody = z.object({
  results: z
    .array(
      z.object({
        id: z.string().min(1).max(96),
        mode: z.enum(['ai', 'hotseat']),
        won: z.boolean(),
        completedAt: z.string().min(20).max(40),
      }),
    )
    .min(1)
    .max(50),
});

app.post('/offline-results', async (request, reply) => {
  const authorization = request.headers.authorization ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const verified = token
    ? await verifyAccessToken(token)
    : { ok: false as const, reason: 'missing bearer token' };
  if (!verified.ok) return reply.code(401).send({ error: verified.reason });

  const parsed = OfflineResultsBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid offline result batch' });

  try {
    for (const result of parsed.data.results) {
      await applyOfflineResult(verified.token.userId, result);
    }
    const profile = await fetchProfileRewardTotals(verified.token.userId);
    return {
      acknowledged: parsed.data.results.map((result) => result.id),
      profile,
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: 'could not sync offline results' });
  }
});

async function main(): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
  attachWebSocketServer(app.server, (msg) => app.log.info(msg));
  app.log.info(`ws listening on ws://0.0.0.0:${port}/ws`);
}

main().catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
