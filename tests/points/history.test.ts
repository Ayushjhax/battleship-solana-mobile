/**
 * The points desk's history (src/features/points/history.ts): a pending
 * payment never reads as done, explorer links point at the server's network,
 * and recent unpaid orders are the ones reconciled.
 */
import { describe, expect, it } from 'vitest';

import { ordersToReconcile, tradeExplorerUrl, tradeLine } from '../../src/features/points/history';
import type { PointTrade } from '../../src/net/points';

const NOW = Date.parse('2026-10-10T12:00:00Z');

function trade(overrides: Partial<PointTrade> = {}): PointTrade {
  return {
    requestId: 'request-1',
    kind: 'buy',
    status: 'awaiting_payment',
    points: 100,
    lamports: 1_000_000,
    signature: null,
    payer: 'Payer11111111111111111111111111111111111111',
    destination: null,
    error: null,
    expiresAt: new Date(NOW + 60_000).toISOString(),
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

describe('trade history', () => {
  it.each([
    [{ kind: 'buy', status: 'awaiting_payment' }, 'Awaiting payment', 'pending'],
    [{ kind: 'buy', status: 'awaiting_payment', expiresAt: new Date(NOW - 1).toISOString() }, 'Not paid · expired', 'failed'],
    [{ kind: 'buy', status: 'confirmed' }, 'Credited', 'done'],
    [{ kind: 'sell', status: 'processing' }, 'Payout pending', 'pending'],
    [{ kind: 'sell', status: 'broadcasting' }, 'Payout pending', 'pending'],
    [{ kind: 'sell', status: 'confirmed' }, 'Paid out', 'done'],
    [{ kind: 'sell', status: 'refunded' }, 'Refunded · points returned', 'failed'],
  ] as const)('%o reads "%s"', (overrides, label, tone) => {
    expect(tradeLine(trade(overrides as Partial<PointTrade>), NOW)).toEqual({ label, tone });
  });

  it('links a transaction on the network the server checks', () => {
    const signed = trade({ signature: 'sig123', status: 'confirmed' });
    expect(tradeExplorerUrl(signed, 'devnet')).toBe('https://explorer.solana.com/tx/sig123?cluster=devnet');
    expect(tradeExplorerUrl(signed, 'mainnet-beta')).toBe('https://explorer.solana.com/tx/sig123');
    expect(tradeExplorerUrl(signed, 'unknown')).toBeNull();
    expect(tradeExplorerUrl(trade(), 'devnet')).toBeNull();
  });

  it('reconciles recent unpaid orders only, a few at a time', () => {
    const trades = [
      trade({ requestId: 'open-1' }),
      trade({ requestId: 'paid', status: 'confirmed' }),
      trade({ requestId: 'sale', kind: 'sell', status: 'processing' }),
      trade({ requestId: 'old', createdAt: new Date(NOW - 2 * 24 * 60 * 60_000).toISOString() }),
      trade({ requestId: 'open-2' }),
      trade({ requestId: 'open-3' }),
      trade({ requestId: 'open-4' }),
    ];
    expect(ordersToReconcile(trades, NOW)).toEqual(['open-1', 'open-2', 'open-3']);
  });
});
