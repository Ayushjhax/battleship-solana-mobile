/**
 * The wallets screen's model (src/features/wallet/paymentWallets.ts): only the
 * server's verified wallets are listed and choosable, and a just-linked wallet
 * is reported verified, held by another account, or not yet synced.
 */
import { describe, expect, it, vi } from 'vitest';

import { awaitLinkedWallet, walletClientName, walletRows } from '../../src/features/wallet/paymentWallets';
import type { AccountWallets } from '../../src/net/points';

const EMBEDDED = 'Emb1111111111111111111111111111111111111111';
const EXTERNAL = 'Ext1111111111111111111111111111111111111111';

function wallets(overrides: Partial<AccountWallets> = {}): AccountWallets {
  return {
    wallets: [
      { address: EMBEDDED, kind: 'embedded', walletClient: 'privy', verifiedAt: '2026-10-01T00:00:00Z' },
      { address: EXTERNAL, kind: 'external', walletClient: 'solflare', verifiedAt: '2026-10-02T00:00:00Z' },
    ],
    paymentWallet: { address: EXTERNAL, kind: 'external', chosen: true, problem: null },
    network: 'mainnet-beta',
    ...overrides,
  };
}

describe('wallet rows', () => {
  it('lists the paying wallet first and names wallets by what the wallet reported', () => {
    const rows = walletRows(wallets(), { address: EXTERNAL, label: null });
    expect(rows.map((row) => [row.name, row.paying, row.connectedHere])).toEqual([
      ['Solflare', true, true],
      ['Game wallet (Privy)', false, false],
    ]);
  });

  it('prefers the account label the wallet app gave this phone', () => {
    expect(walletRows(wallets(), { address: EXTERNAL, label: 'Savings' })[0]?.name).toBe('Savings');
  });

  it('marks nothing as paying when the chosen wallet is no longer usable', () => {
    const rows = walletRows(
      wallets({ paymentWallet: { address: 'Gone111111111111111111111111111111111111111', kind: null, chosen: true, problem: 'payment_wallet_unavailable' } }),
      null,
    );
    expect(rows.some((row) => row.paying)).toBe(false);
  });

  it('never calls an unnamed wallet a Seeker', () => {
    expect(walletClientName('unknown')).toBeNull();
    expect(walletClientName(null)).toBeNull();
    expect(walletRows(wallets({ wallets: [{ address: EXTERNAL, kind: 'external', walletClient: null, verifiedAt: '' }] }), null)[0]?.name).toBe(
      'External wallet',
    );
  });
});

describe('after linking', () => {
  const sleep = vi.fn(async () => undefined);

  it('reports the wallet once the server lists it', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(wallets({ wallets: [] }))
      .mockResolvedValueOnce(wallets());
    await expect(awaitLinkedWallet({ address: EXTERNAL, load, conflicts: () => [], sleep })).resolves.toMatchObject({ state: 'verified' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports a wallet the server holds for another account', async () => {
    const load = vi.fn(async () => wallets({ wallets: [] }));
    await expect(awaitLinkedWallet({ address: EXTERNAL, load, conflicts: () => [EXTERNAL], sleep })).resolves.toMatchObject({
      state: 'conflict',
    });
  });

  it('gives up waiting, without failing, when the sync has not run yet', async () => {
    const load = vi.fn(async () => wallets({ wallets: [] }));
    await expect(awaitLinkedWallet({ address: EXTERNAL, load, conflicts: () => [], sleep, attempts: 3 })).resolves.toMatchObject({
      state: 'pending',
    });
    expect(load).toHaveBeenCalledTimes(3);
  });
});
