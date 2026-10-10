/**
 * The points desk's history: every buy and sale the server has for the
 * account, pending ones included, with a plain status and an explorer link.
 * A pending payment is never shown as done — "Credited" and "Paid out" only
 * ever come from the server's settled state. Pure (tests/points/history.test.ts).
 */
import type { PointNetwork, PointTrade } from '@/net/points';
import { explorerTransactionUrl, type SolanaClusterName } from '@/wallet/solana';

export type TradeTone = 'pending' | 'done' | 'failed';

export interface TradeLine {
  readonly label: string;
  readonly tone: TradeTone;
}

/** How long an unpaid order is still worth asking the server about. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000;
const RECONCILE_LIMIT = 3;

export function tradeLine(trade: PointTrade, now: number): TradeLine {
  if (trade.kind === 'buy') {
    if (trade.status === 'confirmed') return { label: 'Credited', tone: 'done' };
    if (trade.status === 'awaiting_payment') {
      const expired = trade.expiresAt !== null && Date.parse(trade.expiresAt) < now;
      return expired ? { label: 'Not paid · expired', tone: 'failed' } : { label: 'Awaiting payment', tone: 'pending' };
    }
    return { label: 'Checking payment', tone: 'pending' };
  }
  if (trade.status === 'confirmed') return { label: 'Paid out', tone: 'done' };
  if (trade.status === 'refunded') return { label: 'Refunded · points returned', tone: 'failed' };
  return { label: 'Payout pending', tone: 'pending' };
}

/** The explorer page for a trade's transaction, on the network the server checks. */
export function tradeExplorerUrl(trade: PointTrade, network: PointNetwork): string | null {
  if (!trade.signature || network === 'unknown') return null;
  return explorerTransactionUrl(trade.signature, network as SolanaClusterName);
}

/** Recent unpaid orders to ask the server about: it finds payments the app never reported. */
export function ordersToReconcile(trades: readonly PointTrade[], now: number): string[] {
  return trades
    .filter(
      (trade) =>
        trade.kind === 'buy' &&
        trade.status === 'awaiting_payment' &&
        now - Date.parse(trade.createdAt) < RECONCILE_WINDOW_MS,
    )
    .slice(0, RECONCILE_LIMIT)
    .map((trade) => trade.requestId);
}
