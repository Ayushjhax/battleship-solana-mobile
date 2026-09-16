/**
 * Match server entry point. Fastify for HTTP, ws for the live match socket.
 * Run it with `npm run server` from the repo root, or `npm run dev` here.
 */
try {
  // Local override: server/.env. Deployed platforms inject real env vars.
  process.loadEnvFile();
} catch {
  /* server-specific file is optional */
}
try {
  // Load shared values too: server/.env may intentionally contain only the
  // treasury while Supabase and Privy values live in Expo's .env.local.
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  /* root local file is optional */
}
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no env file — fine when the deployment platform injects variables */
}

import Fastify from 'fastify';
import { z } from 'zod';

import { verifyAccessToken } from './auth';
import {
  applyOfflineResult,
  fetchProfileRewardTotals,
  reservePointWager,
  settleOfflineWager,
  upsertPrivyAccount,
  verifyDatabaseConnection,
} from './db';
import { cancelBeforeMatchStart, totalQueued } from './matchmaker';
import { creditConfirmedPointPurchase, getPointQuote, sellPoints } from './points';
import { verifyAndLoadPrivyUser } from './privy';
import { bootstrapPrivySession } from './privySession';
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

app.post('/auth/privy/sync', async (request, reply) => {
  const authorization = request.headers.authorization ?? '';
  const privyToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supabaseHeader = request.headers['x-supabase-access-token'];
  const supabaseToken = Array.isArray(supabaseHeader) ? supabaseHeader[0] : supabaseHeader;
  if (!privyToken) return reply.code(401).send({ error: 'Privy access token is required' });

  try {
    const trustedAccount = await verifyAndLoadPrivyUser(privyToken);
    if (supabaseToken) {
      const verifiedProfile = await verifyAccessToken(supabaseToken);
      if (verifiedProfile.ok) {
        try {
          const account = await upsertPrivyAccount(verifiedProfile.token.userId, trustedAccount);
          request.log.info(
            {
              profileId: verifiedProfile.token.userId,
              pointBalance: account.pointBalance,
              welcomeAwarded: account.welcomeAwarded,
            },
            'Privy account synchronized with existing gameplay session',
          );
          return {
            account: { ...account, profileId: verifiedProfile.token.userId },
            session: null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (!/already linked to another Privy user/i.test(message)) throw error;
          request.log.info('Existing gameplay session belongs to a prior Privy sign-in; switching');
        }
      } else {
        request.log.warn(
          { reason: verifiedProfile.reason },
          'stale gameplay token ignored during Privy bootstrap',
        );
      }
    }

    const bootstrapped = await bootstrapPrivySession(trustedAccount);
    reply.header('Cache-Control', 'no-store');
    request.log.info(
      {
        profileId: bootstrapped.profileId,
        pointBalance: bootstrapped.account.pointBalance,
        welcomeAwarded: bootstrapped.account.welcomeAwarded,
      },
      'Privy gameplay account bootstrapped',
    );
    return {
      account: { ...bootstrapped.account, profileId: bootstrapped.profileId },
      session: bootstrapped.handoff,
    };
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '';
    if (/already linked to another Privy user/i.test(message)) {
      return reply.code(409).send({ error: 'This game profile belongs to another Privy sign-in.' });
    }
    if (/token|jwt|unauthorized|authentication/i.test(message)) {
      return reply.code(401).send({ error: 'invalid Privy access token' });
    }
    return reply.code(503).send({ error: 'could not sync Privy account' });
  }
});

const PointTradeBody = z.object({
  requestId: z.string().uuid(),
  signature: z.string().min(32).max(128).optional(),
});

const WagerCancelBody = z.object({ requestId: z.string().uuid() });
const WagerReserveBody = z.object({ requestId: z.string().uuid() });
const WagerSettleBody = z.object({ requestId: z.string().uuid(), won: z.boolean() });

async function verifiedProfileId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  if (!verified.ok) app.log.warn({ reason: verified.reason }, 'gameplay token rejected by points API');
  return verified.ok ? verified.token.userId : null;
}

app.get('/points/quote', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  try {
    return { quote: await getPointQuote(profileId) };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: 'points service is temporarily unavailable' });
  }
});

/**
 * Holds the stake for a wager played against the device's own AI. Online
 * wagers still reserve through the socket's `queue`, where the authoritative
 * room owns the hold; this route exists because an offline match never
 * reaches matchmaking. The reservation is idempotent by requestId, and an
 * abandoned hold is handed back by the next call rather than charged again.
 */
app.post('/points/wager/reserve', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  const parsed = WagerReserveBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid wager reservation' });
  try {
    const reservation = await reservePointWager(profileId, parsed.data.requestId);
    return {
      ok: reservation.ok,
      requestId: reservation.requestId,
      balance: reservation.balance,
      reason: reservation.reason,
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: 'could not reserve the wager stake' });
  }
});

/**
 * Settles that same offline wager. The verdict comes from the device, which
 * is the trade-off an offline wager makes: there is no server-side match to
 * check it against, unlike an online or matchmade bot game.
 */
app.post('/points/wager/settle', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  const parsed = WagerSettleBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid wager settlement' });
  try {
    const result = await settleOfflineWager(profileId, parsed.data.requestId, parsed.data.won);
    return { settled: result.settled, balance: result.balance };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: 'could not settle the wager' });
  }
});

app.post('/points/wager/cancel', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  const parsed = WagerCancelBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid wager cancellation' });
  try {
    const result = await cancelBeforeMatchStart(profileId, parsed.data.requestId);
    return {
      cancelled: result.cancelled,
      refunded: result.refunded,
      balance: result.pointBalance ?? null,
    };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ error: 'could not confirm the wager refund' });
  }
});

app.post('/points/buy', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  const parsed = PointTradeBody.required({ signature: true }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid point purchase' });
  try {
    const balance = await creditConfirmedPointPurchase(
      profileId,
      parsed.data.requestId,
      parsed.data.signature,
    );
    return { status: 'confirmed', balance };
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '';
    if (/not confirmed yet/i.test(message)) {
      return reply.code(409).send({ error: 'transaction is still confirming' });
    }
    if (/already credited|conflicts|does not match|failed/i.test(message)) {
      return reply.code(422).send({ error: message });
    }
    return reply.code(503).send({ error: 'could not verify the point purchase' });
  }
});

app.post('/points/sell', async (request, reply) => {
  const profileId = await verifiedProfileId(request.headers.authorization);
  if (!profileId) return reply.code(401).send({ error: 'valid gameplay session required' });
  const parsed = PointTradeBody.omit({ signature: true }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid point sale' });
  try {
    const result = await sellPoints(profileId, parsed.data.requestId);
    if (result.status === 'pending') return reply.code(202).send(result);
    if (result.status === 'refunded') return result;
    return result;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '';
    if (/insufficient points/i.test(message)) {
      return reply.code(409).send({ error: 'insufficient points' });
    }
    return reply.code(503).send({ error: 'could not process the point sale' });
  }
});

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

let wss: ReturnType<typeof attachWebSocketServer> | null = null;

/**
 * The host sends SIGTERM before it replaces a deploy or suspends an idle
 * instance, then kills the process shortly after. Closing the sockets first
 * means every connected client gets a real close frame and can start
 * reconnecting immediately, instead of holding a half-open socket until its
 * own 20-second liveness check notices. Rooms live in memory and go with the
 * process either way — this is about not leaving clients hanging.
 */
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — closing connections`);

  if (wss) {
    for (const client of wss.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        /* already gone */
      }
    }
    wss.close();
  }

  // Never outstay the platform's grace period; exit even if close() stalls.
  const hardStop = setTimeout(() => process.exit(0), 8_000);
  hardStop.unref?.();

  void app.close().then(
    () => process.exit(0),
    (error: unknown) => {
      app.log.error(error);
      process.exit(1);
    },
  );
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

async function main(): Promise<void> {
  await verifyDatabaseConnection();
  app.log.info('database connected: Supabase profiles, Privy accounts, and points schema ready');
  if (process.env.PRIVY_APP_ID?.trim() && process.env.PRIVY_APP_SECRET?.trim()) {
    app.log.info('Privy server authentication configured');
  } else {
    app.log.warn('Privy server authentication is not configured');
  }
  await app.listen({ port, host: '0.0.0.0' });
  wss = attachWebSocketServer(app.server, (msg) => app.log.info(msg));
  app.log.info(`ws listening on ws://0.0.0.0:${port}/ws`);
  app.log.info(`backend ready: HTTP and WebSocket live on port ${port}`);
}

main().catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
