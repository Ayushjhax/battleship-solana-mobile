import { z } from 'zod';

import { getAccessToken } from './api';
import { ensureSession } from './auth';

const QuoteSchema = z.object({
  quote: z.object({
    balance: z.number().int().nonnegative(),
    points: z.literal(100),
    lamports: z.literal(1_000_000),
    sol: z.string(),
    treasuryAddress: z.string().min(32),
  }),
});

const TradeSchema = z.object({
  status: z.enum(['confirmed', 'pending', 'refunded']),
  balance: z.number().int().nonnegative(),
  signature: z.string().nullable().optional(),
});

const WagerCancellationSchema = z.object({
  cancelled: z.boolean(),
  refunded: z.boolean(),
  balance: z.number().int().nonnegative().nullable(),
});

const WagerReservationSchema = z.object({
  ok: z.boolean(),
  requestId: z.string().uuid(),
  balance: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});

const WagerSettlementSchema = z.object({
  settled: z.boolean(),
  balance: z.number().int().nonnegative(),
});

export type PointQuote = z.infer<typeof QuoteSchema>['quote'];
export type PointTradeResult = z.infer<typeof TradeSchema>;
export type WagerCancellation = z.infer<typeof WagerCancellationSchema>;
export type WagerReservation = z.infer<typeof WagerReservationSchema>;
export type WagerSettlement = z.infer<typeof WagerSettlementSchema>;

function apiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const ws = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (!ws) throw new Error('The game server is not configured.');
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('The game server address is invalid.');
  }
}

async function message(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : `Server returned ${response.status}.`;
  } catch {
    return `Server returned ${response.status}.`;
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const sessionId = await ensureSession();
  if (!sessionId) {
    throw new Error('Your verified account is still syncing. Return home, then try again.');
  }
  const access = await getAccessToken();
  if (!access.ok) throw new Error('Your gameplay session is not ready. Please try again.');
  try {
    return await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access.value}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('The game server could not be reached. Start the backend and try again.');
  }
}

export async function fetchPointQuote(): Promise<PointQuote> {
  const response = await request('/points/quote');
  if (!response.ok) throw new Error(await message(response));
  const parsed = QuoteSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The points quote was invalid.');
  return parsed.data.quote;
}

export async function confirmPointBuy(
  requestId: string,
  signature: string,
): Promise<PointTradeResult> {
  const response = await request('/points/buy', {
    method: 'POST',
    body: JSON.stringify({ requestId, signature }),
  });
  if (!response.ok) throw new Error(await message(response));
  const parsed = TradeSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The purchase confirmation was invalid.');
  return parsed.data;
}

export async function requestPointSell(requestId: string): Promise<PointTradeResult> {
  const response = await request('/points/sell', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(await message(response));
  const parsed = TradeSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The sale response was invalid.');
  return parsed.data;
}

/**
 * Holds the 50-point stake for a match against this device's AI. Online
 * wagers reserve through the match socket instead — there the room owns the
 * hold — so this is the offline path only. Idempotent by requestId.
 */
export async function reserveOfflineWager(requestId: string): Promise<WagerReservation> {
  const response = await request('/points/wager/reserve', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(await message(response));
  const parsed = WagerReservationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The wager reservation response was invalid.');
  return parsed.data;
}

/** Pays out (or keeps) that stake once the local match is over. Idempotent. */
export async function settleOfflineWager(
  requestId: string,
  won: boolean,
): Promise<WagerSettlement> {
  const response = await request('/points/wager/settle', {
    method: 'POST',
    body: JSON.stringify({ requestId, won }),
  });
  if (!response.ok) throw new Error(await message(response));
  const parsed = WagerSettlementSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The wager settlement response was invalid.');
  return parsed.data;
}

/** Idempotently confirms a pre-game wager refund with the backend. */
export async function cancelPointWager(requestId: string): Promise<WagerCancellation> {
  const response = await request('/points/wager/cancel', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(await message(response));
  const parsed = WagerCancellationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The wager cancellation response was invalid.');
  return parsed.data;
}
