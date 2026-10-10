/**
 * What the points desk shows before money moves (src/features/points/confirmations.ts):
 * every figure from the server's order or quote, and no network fee made up.
 */
import { describe, expect, it } from 'vitest';

import { purchaseApproval, saleConfirmation } from '../../src/features/points/confirmations';
import type { PointBuyOrder } from '../../src/net/points';

const PAYER = 'Ext1111111111111111111111111111111111111111';
const TREASURY = 'HfYqSJrCeWwzKU2JMboEb7dPmQhT23Trqat1ch4ZwiUd';

const order: PointBuyOrder = {
  requestId: '6f1c1a3e-6b1f-4f55-9b7b-8b0d3c1f2a10',
  status: 'awaiting_payment',
  points: 100,
  lamports: 1_000_000,
  sol: '0.001',
  treasuryAddress: TREASURY,
  network: 'mainnet-beta',
  payer: { address: PAYER, kind: 'external' },
  expiresAt: '2026-10-10T12:10:00.000Z',
  signature: null,
};

describe('the purchase details', () => {
  it('name the amount, the full payer and treasury addresses and the network', () => {
    const { title, body } = purchaseApproval(order, { feeLamports: 5000, walletLabel: 'Main' });
    expect(title).toBe('Pay 0.001 SOL for 100 points?');
    expect(body).toContain('0.001 SOL (1,000,000 lamports)');
    expect(body).toContain(PAYER);
    expect(body).toContain(TREASURY);
    expect(body).toContain('your external wallet “Main”');
    expect(body).toContain('Solana mainnet-beta');
    expect(body).toContain('about 0.000005 SOL');
  });

  it('leave the fee to the wallet when the network gave no estimate', () => {
    const { body } = purchaseApproval(order, { feeLamports: null, walletLabel: null });
    expect(body).toContain('Network fee: shown by your wallet');
    expect(body).not.toMatch(/about \d/);
  });
});

describe('the sale details', () => {
  const quote = { points: 100, sol: '0.001', lamports: 1_000_000, network: 'mainnet-beta' as const };

  it('name what is redeemed, what arrives and the full destination', () => {
    const confirmation = saleConfirmation(quote, { address: PAYER, kind: 'external', chosen: true, problem: null }, 'Embedded')!;
    expect(confirmation.title).toBe('Sell 100 points for 0.001 SOL?');
    expect(confirmation.body).toContain('Redeems: 100 points.');
    expect(confirmation.body).toContain('You receive: 0.001 SOL (1,000,000 lamports). The treasury pays the network fee.');
    expect(confirmation.body).toContain(`your external wallet\n${PAYER}`);
    expect(confirmation.body).toContain('Solana mainnet-beta');
  });

  it('has nothing to confirm without a destination', () => {
    expect(saleConfirmation(quote, { address: null, kind: null, chosen: true, problem: 'payment_wallet_unavailable' }, null)).toBeNull();
  });
});
