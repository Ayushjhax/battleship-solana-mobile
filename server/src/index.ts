/**
 * Match server entry point. Fastify for HTTP, ws for the live match socket.
 * Run it with `npm run server` from the repo root.
 */
import Fastify from 'fastify';
import { attachWebSocketServer } from './ws';

const port = Number(process.env.PORT ?? 8080);

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, service: 'seabattle-match-server' }));

async function main(): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
  attachWebSocketServer(app.server);
  app.log.info(`ws listening on ws://0.0.0.0:${port}/ws`);
}

main().catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
