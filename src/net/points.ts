import { z } from 'zod';

import { getAccessToken } from './api';
import { ensureSession } from './auth';

const NetworkSchema = z.enum(['mainnet-beta', 'devnet', 'testnet', 'unknown']);

/** 100 points cost exactly this (0.001 SOL); the server's quote and orders are held to it. */
export const POINT_PRICE_LAMPORTS = 1_000_000;

/**
 * The wallet that pays for points and receives a sale (0018): the embedded
 * wallet, or an external one Privy verified. `problem` set means none can be
 * used, and the server refuses payments until the player chooses again.
 */
const PaymentWalletSchema = z.object({
  address: z.string().nullable(),
  kind: z.enum(['embedded', 'external']).nullable(),
  chosen: z.boolean(),
  problem: z.enum(['payment_wallet_unavailable', 'payment_wallet_not_chosen', 'no_payment_wallet']).nullable(),
});

const QuoteSchema = z.object({
  quote: z.object({
    balance: z.number().int().nonnegative(),
    /**
     * What a sale may spend: the balance less welcome points, which are play
     * money (0014). Optional so an older server, which has no such split,
     * still parses; then the whole balance is sellable, as it is there.
     */
    sellableBalance: z.number().int().nonnegative().optional(),
    lockedBalance: z.number().int().nonnegative().optional(),
    points: z.literal(100),
    lamports: z.literal(POINT_PRICE_LAMPORTS),
    sol: z.string(),
    treasuryAddress: z.string().min(32),
    /** Optional: a server from before 0018 sends neither. */
    network: NetworkSchema.optional(),
    paymentWallet: PaymentWalletSchema.optional(),
  }),
});

const OrderSchema = z.object({
  order: z.object({
    requestId: z.string().uuid(),
    status: z.enum(['awaiting_payment', 'confirmed']),
    points: z.literal(100),
    lamports: z.literal(POINT_PRICE_LAMPORTS),
    sol: z.string(),
    treasuryAddress: z.string().min(32),
    network: NetworkSchema,
    payer: z.object({ address: z.string().min(32), kind: z.enum(['embedded', 'external']) }),
    expiresAt: z.string(),
    signature: z.string().nullable(),
  }),
});

const ReconcileSchema = z.object({
  status: z.enum(['confirmed', 'awaiting_payment']),
  balance: z.number().int().nonnegative(),
  signature: z.string().nullable(),
});

const TradeHistorySchema = z.object({
  trades: z.array(
    z.object({
      requestId: z.string(),
      kind: z.enum(['buy', 'sell']),
      status: z.enum(['awaiting_payment', 'processing', 'broadcasting', 'confirmed', 'refunded']),
      points: z.number().int(),
      lamports: z.number().int(),
      signature: z.string().nullable(),
      payer: z.string().nullable(),
      destination: z.string().nullable(),
      error: z.string().nullable(),
      expiresAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  network: NetworkSchema,
});

const WalletsSchema = z.object({
  wallets: z.array(
    z.object({
      address: z.string(),
      kind: z.enum(['embedded', 'external']),
      walletClient: z.string().nullable(),
      verifiedAt: z.string(),
    }),
  ),
  paymentWallet: PaymentWalletSchema,
  network: NetworkSchema,
});

const TradeSchema = z.object({
  status: z.enum(['confirmed', 'pending', 'refunded']),
  balance: z.number().int().nonnegative(),
  signature: z.string().nullable().optional(),
  /** Where a sale's SOL goes, fixed when its points were reserved (0018). */
  destination: z.string().nullable().optional(),
});

const WagerCancellationSchema = z.object({
  cancelled: z.boolean(),
  refunded: z.boolean(),
  balance: z.number().int().nonnegative().nullable(),
});

export type PointQuote = z.infer<typeof QuoteSchema>['quote'];
export type PointNetwork = z.infer<typeof NetworkSchema>;
export type PaymentWallet = z.infer<typeof PaymentWalletSchema>;
export type PointBuyOrder = z.infer<typeof OrderSchema>['order'];
export type PointPurchaseReconcile = z.infer<typeof ReconcileSchema>;
export type PointTradeHistory = z.infer<typeof TradeHistorySchema>;
export type PointTrade = PointTradeHistory['trades'][number];
export type AccountWallets = z.infer<typeof WalletsSchema>;

/** A refusal the server explained with a code the app can act on (409/422). */
export class PointsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'PointsRequestError';
  }
}
export type PointTradeResult = z.infer<typeof TradeSchema>;
export type WagerCancellation = z.infer<typeof WagerCancellationSchema>;

/** How many of the quoted points a sale may spend. */
export function sellableOf(quote: PointQuote): number {
  return quote.sellableBalance ?? quote.balance;
}

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

async function refusal(response: Response): Promise<PointsRequestError> {
  let body: { error?: unknown; code?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // An empty or non-JSON body still gets the status.
  }
  return new PointsRequestError(
    typeof body.error === 'string' ? body.error : `Server returned ${response.status}.`,
    response.status,
    typeof body.code === 'string' ? body.code : null,
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const sessionId = await ensureSession();
  if (!sessionId) {
    throw new Error('Your verified account is still syncing. Return home, then try again.');
  }
  const access = await getAccessToken();
  if (!access.ok) throw new Error('Your gameplay session is not ready. Please try again.');
  // Resolved outside the try: a missing or malformed server address is a build
  // configuration fault, and reporting it as "could not be reached" sends
  // people to restart a backend that was never the problem.
  const url = `${apiBase()}${path}`;
  try {
    return await fetch(url, {
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

/**
 * Makes (or fetches) the order a purchase pays: its payer and expiry are the
 * server's. Null when the server predates orders (0018) and only takes the
 * older pay-then-confirm purchase.
 */
export async function createPointBuyOrder(requestId: string): Promise<PointBuyOrder | null> {
  const response = await request('/points/buy/order', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await refusal(response);
  const parsed = OrderSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The purchase order was invalid.');
  return parsed.data.order;
}

/** Asks the server to find and credit an order's payment the app never reported. */
export async function reconcilePointBuy(requestId: string): Promise<PointPurchaseReconcile> {
  const response = await request('/points/buy/reconcile', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw await refusal(response);
  const parsed = ReconcileSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The purchase check was invalid.');
  return parsed.data;
}

/** The account's latest buys and sales, newest first. Null on a server without history. */
export async function fetchPointTrades(): Promise<PointTradeHistory | null> {
  const response = await request('/points/trades');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await message(response));
  const parsed = TradeHistorySchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The transaction history was invalid.');
  return parsed.data;
}

/** The account's verified wallets and its payment wallet, as the server has them from Privy. */
export async function fetchAccountWallets(): Promise<AccountWallets> {
  const response = await request('/wallets');
  if (!response.ok) throw await refusal(response);
  const parsed = WalletsSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The wallet list was invalid.');
  return parsed.data;
}

/** Chooses one of the account's verified wallets for payments, or null for the default. */
export async function choosePaymentWallet(address: string | null): Promise<PaymentWallet> {
  const response = await request('/wallets/payment', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
  if (!response.ok) throw await refusal(response);
  const parsed = z.object({ paymentWallet: PaymentWalletSchema }).safeParse(await response.json());
  if (!parsed.success) throw new Error('The payment wallet response was invalid.');
  return parsed.data.paymentWallet;
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
  if (!response.ok) throw await refusal(response);
  const parsed = TradeSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The sale response was invalid.');
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
