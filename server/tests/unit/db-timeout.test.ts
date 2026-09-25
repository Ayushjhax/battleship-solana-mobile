/**
 * A database that never answers must not hang the match server. A queue join
 * awaits the player's profile lookup; with no timeout, a stalled request kept
 * that player marked "joining" until the process restarted, so every later
 * try was "already queued" and nobody was ever matched.
 *
 * Real supabase-js against a local HTTP server that accepts every request and
 * never responds.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('database requests are bounded', () => {
  let server: Server;
  const held: ServerResponse<IncomingMessage>[] = [];
  const saved = { ...process.env };

  beforeEach(async () => {
    server = createServer((_request, response) => {
      held.push(response); // never answered
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only';
    process.env.SEABATTLE_DB_TIMEOUT_MS = '300';
    vi.resetModules();
  });

  afterEach(async () => {
    for (const response of held.splice(0)) response.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...saved };
  });

  it('gives up on a stalled profile lookup and falls back to a default profile', async () => {
    const { fetchOpponentSummary } = await import('../../src/db');
    const started = Date.now();
    const summary = await fetchOpponentSummary('11111111-2222-4333-8444-555555555555');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(summary).toMatchObject({ id: '11111111-2222-4333-8444-555555555555', rankPoints: 0 });
  });
});
