/**
 * Buying points (src/features/points/purchase.ts): the steps happen in the
 * order that never loses a payment, the order is checked before anything is
 * paid, and a purchase is finished — never paid twice — after a crash.
 */
import { describe, expect, it, vi } from 'vitest';

import { buyPoints, resumePurchase, type PurchaseDeps } from '../../src/features/points/purchase';
import type { PointBuyOrder } from '../../src/net/points';
import type { PendingPointBuy } from '../../src/state/points';

const EMBEDDED = 'Embedded1111111111111111111111111111111111';
const EXTERNAL = 'External1111111111111111111111111111111111';
const TREASURY = 'Treasury111111111111111111111111111111111';
const NOW = Date.parse('2026-10-10T12:00:00Z');

function order(overrides: Partial<PointBuyOrder> = {}): PointBuyOrder {
  return {
    requestId: 'request-1',
    status: 'awaiting_payment',
    points: 100,
    lamports: 1_000_000,
    sol: '0.001',
    treasuryAddress: TREASURY,
    network: 'devnet',
    payer: { address: EMBEDDED, kind: 'embedded' },
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    signature: null,
    ...overrides,
  };
}

function harness(overrides: Partial<PurchaseDeps> = {}) {
  const saved: (PendingPointBuy | null)[] = [];
  const deps: PurchaseDeps = {
    newRequestId: vi.fn(() => 'request-1'),
    savePending: vi.fn((pending) => saved.push(pending)),
    createOrder: vi.fn(async () => order()),
    signerAddress: EMBEDDED,
    appNetwork: 'devnet',
    pay: vi.fn(async () => 'signature-1'),
    confirmOnChain: vi.fn(async () => true),
    confirmCredit: vi.fn(async () => ({ balance: 300 })),
    reconcile: vi.fn(async () => ({ status: 'awaiting_payment' as const, balance: 200 })),
    legacyQuote: { treasuryAddress: TREASURY, lamports: 1_000_000 },
    now: () => NOW,
    ...overrides,
  };
  return { deps, saved, last: () => saved[saved.length - 1] };
}

describe('buying points', () => {
  it('saves the purchase before paying, pays the order’s exact transfer, then credits it', async () => {
    const { deps, saved, last } = harness();

    await expect(buyPoints(deps)).resolves.toEqual({ kind: 'credited', balance: 300 });

    expect(saved[0]).toEqual({ requestId: 'request-1', signature: null, expiresAt: null });
    expect(deps.pay).toHaveBeenCalledWith({ from: EMBEDDED, to: TREASURY, lamports: 1_000_000 });
    expect(saved).toContainEqual({ requestId: 'request-1', signature: 'signature-1', expiresAt: order().expiresAt });
    expect(deps.confirmCredit).toHaveBeenCalledWith('request-1', 'signature-1');
    expect(last()).toBeNull();
  });

  it('never pays an order made for an external payment wallet from the embedded wallet', async () => {
    const { deps, last } = harness({
      createOrder: vi.fn(async () => order({ payer: { address: EXTERNAL, kind: 'external' } })),
    });

    const outcome = await buyPoints(deps);

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'external_payment_wallet' });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it.each([
    ['another payer', { payer: { address: 'Someone111111111111111111111111111111111', kind: 'embedded' as const } }, 'payer_mismatch'],
    ['another network', { network: 'mainnet-beta' as const }, 'network_mismatch'],
    ['an unknown network', { network: 'unknown' as const }, 'network_mismatch'],
    ['an expired order', { expiresAt: new Date(NOW - 1).toISOString() }, 'order_expired'],
  ])('refuses %s with nothing paid', async (_name, overrides, reason) => {
    const { deps, last } = harness({ createOrder: vi.fn(async () => order(overrides)) });

    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('drops the purchase when the player declines in the wallet', async () => {
    const { deps, last } = harness({ pay: vi.fn(async () => Promise.reject(new Error('User rejected the request'))) });

    await expect(buyPoints(deps)).rejects.toThrow(/rejected/);
    expect(last()).toBeNull();
    expect(deps.confirmCredit).not.toHaveBeenCalled();
  });

  it('keeps the purchase when sending fails in a way that may still have sent it', async () => {
    const { deps, last } = harness({ pay: vi.fn(async () => Promise.reject(new Error('Network request failed'))) });

    await expect(buyPoints(deps)).rejects.toThrow(/Network/);
    expect(last()).toEqual({ requestId: 'request-1', signature: null, expiresAt: order().expiresAt });
  });

  it('keeps the signed purchase when the server cannot credit it yet', async () => {
    const { deps, last } = harness({
      confirmCredit: vi.fn(async () => Promise.reject(new Error('transaction is still confirming'))),
    });

    await expect(buyPoints(deps)).rejects.toThrow(/confirming/);
    expect(last()).toEqual({ requestId: 'request-1', signature: 'signature-1', expiresAt: order().expiresAt });
  });

  it('reports a transfer that failed on chain, and credits nothing', async () => {
    const { deps, last } = harness({ confirmOnChain: vi.fn(async () => false) });

    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'failed' });
    expect(deps.confirmCredit).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('makes no purchase when the order cannot be made', async () => {
    const { deps, last } = harness({ createOrder: vi.fn(async () => Promise.reject(new Error('Choose a payment wallet again.'))) });

    await expect(buyPoints(deps)).rejects.toThrow(/payment wallet/);
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('against a server without orders, pays the quote from the embedded wallet as before', async () => {
    const ids = ['ignored-order-id', 'legacy-id'];
    const { deps } = harness({
      createOrder: vi.fn(async () => null),
      newRequestId: vi.fn(() => ids.shift() as string),
    });

    await expect(buyPoints(deps)).resolves.toEqual({ kind: 'credited', balance: 300 });
    expect(deps.pay).toHaveBeenCalledWith({ from: EMBEDDED, to: TREASURY, lamports: 1_000_000 });
    expect(deps.confirmCredit).toHaveBeenCalledWith('legacy-id', 'signature-1');
  });
});

describe('finishing a saved purchase', () => {
  it('re-reports a saved signature instead of paying again', async () => {
    const { deps, last } = harness();

    await expect(resumePurchase({ requestId: 'request-1', signature: 'signature-1' }, deps)).resolves.toEqual({
      kind: 'credited',
      balance: 300,
    });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('without a signature, has the server look for the payment, and credits what it finds', async () => {
    const { deps, last } = harness({ reconcile: vi.fn(async () => ({ status: 'confirmed' as const, balance: 300 })) });

    await expect(resumePurchase({ requestId: 'request-1', signature: null }, deps)).resolves.toEqual({
      kind: 'credited',
      balance: 300,
    });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('keeps waiting while the order is open and nothing has arrived', async () => {
    const { deps, saved } = harness();

    await expect(
      resumePurchase({ requestId: 'request-1', signature: null, expiresAt: order().expiresAt }, deps),
    ).resolves.toMatchObject({ kind: 'waiting' });
    expect(saved).toEqual([]);
  });

  it('gives up an order that expired with no payment, well after any payment could land', async () => {
    const { deps, last } = harness();

    await expect(
      resumePurchase({ requestId: 'request-1', signature: null, expiresAt: new Date(NOW - 6 * 60_000).toISOString() }, deps),
    ).resolves.toMatchObject({ kind: 'refused', reason: 'order_expired' });
    expect(last()).toBeNull();
  });

  it('drops a purchase whose order was never made', async () => {
    const missing = Object.assign(new Error('purchase order was not found'), { status: 404 });
    const { deps, last } = harness({ reconcile: vi.fn(async () => Promise.reject(missing)) });

    await expect(resumePurchase({ requestId: 'request-1', signature: null }, deps)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'order_missing',
    });
    expect(last()).toBeNull();
  });
});

describe('paying from an external wallet', () => {
  const externalOrder = (overrides: Partial<PointBuyOrder> = {}) =>
    order({ network: 'mainnet-beta', payer: { address: EXTERNAL, kind: 'external' }, ...overrides });

  function external(overrides: Partial<PurchaseDeps> = {}) {
    const steps: string[] = [];
    const h = harness({
      createOrder: vi.fn(async () => externalOrder()),
      signerAddress: EXTERNAL,
      signerKind: 'external',
      appNetwork: 'mainnet-beta',
      expected: { treasuryAddress: TREASURY, lamports: 1_000_000 },
      approveOrder: vi.fn(async () => {
        steps.push('approved');
      }),
      pay: vi.fn(async () => {
        steps.push('paid');
        return 'wallet-signature';
      }),
      ...overrides,
    });
    return { ...h, steps };
  }

  it('shows the order, then has that wallet pay exactly the order, then credits it', async () => {
    const { deps, steps, last } = external();

    await expect(buyPoints(deps)).resolves.toEqual({ kind: 'credited', balance: 300 });

    expect(deps.approveOrder).toHaveBeenCalledWith(externalOrder());
    expect(steps).toEqual(['approved', 'paid']);
    expect(deps.pay).toHaveBeenCalledWith({ from: EXTERNAL, to: TREASURY, lamports: 1_000_000 });
    expect(deps.confirmCredit).toHaveBeenCalledWith('request-1', 'wallet-signature');
    expect(last()).toBeNull();
  });

  it('never pays an order made for the embedded wallet with the external one', async () => {
    const { deps, last } = external({ createOrder: vi.fn(async () => order({ network: 'mainnet-beta' })) });

    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'payment_wallet_changed' });
    expect(deps.approveOrder).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('refuses an order for another external wallet', async () => {
    const { deps } = external({
      createOrder: vi.fn(async () => externalOrder({ payer: { address: 'Other111111111111111111111111111111111111111', kind: 'external' } })),
    });
    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'payer_mismatch' });
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it.each([
    ['another treasury', { treasuryAddress: 'Elsewhere1111111111111111111111111111111111' }],
    ['another amount', { lamports: 2_000_000 as 1_000_000 }],
  ])('refuses an order to %s than the desk showed', async (_name, overrides) => {
    const { deps } = external({ createOrder: vi.fn(async () => externalOrder(overrides)) });
    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'order_mismatch' });
    expect(deps.approveOrder).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('refuses an order on another network than the app’s', async () => {
    const { deps } = external({ createOrder: vi.fn(async () => externalOrder({ network: 'devnet' })) });
    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'network_mismatch' });
    expect(deps.pay).not.toHaveBeenCalled();
  });

  it('pays nothing and keeps nothing when the player cancels the details', async () => {
    const { deps, last } = external({
      approveOrder: vi.fn(async () => Promise.reject(Object.assign(new Error('Payment cancelled.'), { nothingSent: true }))),
    });
    await expect(buyPoints(deps)).rejects.toThrow(/cancelled/);
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('pays nothing when the order expired while its details were open', async () => {
    let now = NOW;
    const { deps, last } = external({
      now: () => now,
      approveOrder: vi.fn(async () => {
        now = NOW + 11 * 60_000;
      }),
    });
    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'order_expired' });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('drops the purchase when the wallet says nothing was sent', async () => {
    const { deps, last } = external({
      pay: vi.fn(async () => Promise.reject(Object.assign(new Error('The wallet connected a different account.'), { nothingSent: true, mayHaveSent: false }))),
    });
    await expect(buyPoints(deps)).rejects.toThrow(/different account/);
    expect(last()).toBeNull();
  });

  it('keeps the purchase when the wallet may have sent it, and never pays again to finish it', async () => {
    // "rejected" in the words must not count as a decline once the wallet says it may have sent.
    const maybe = Object.assign(new Error('Session rejected by the system'), { nothingSent: false, mayHaveSent: true });
    const { deps, last } = external({ pay: vi.fn(async () => Promise.reject(maybe)) });

    await expect(buyPoints(deps)).rejects.toBe(maybe);
    const pending = last();
    expect(pending).toEqual({ requestId: 'request-1', signature: null, expiresAt: externalOrder().expiresAt });

    vi.mocked(deps.reconcile).mockResolvedValueOnce({ status: 'confirmed', balance: 300 });
    await expect(resumePurchase(pending!, deps)).resolves.toEqual({ kind: 'credited', balance: 300 });
    expect(deps.pay).toHaveBeenCalledOnce();
  });

  it('is refused against a server without orders: it would credit the embedded wallet only', async () => {
    const { deps } = external({ createOrder: vi.fn(async () => null) });
    await expect(buyPoints(deps)).resolves.toMatchObject({ kind: 'refused', reason: 'order_missing' });
    expect(deps.pay).not.toHaveBeenCalled();
  });
});

describe('a saved signature that never confirmed', () => {
  const stale = { requestId: 'request-1', signature: 'dropped-signature', expiresAt: new Date(NOW - 6 * 60_000).toISOString() };
  const notConfirmed = () => Promise.reject(new Error('transaction is still confirming'));

  it('keeps retrying while a transfer could still land', async () => {
    const { deps, saved } = harness({ confirmCredit: vi.fn(notConfirmed) });
    const fresh = { ...stale, expiresAt: new Date(NOW + 60_000).toISOString() };
    await expect(resumePurchase(fresh, deps)).rejects.toThrow(/confirming/);
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('long after the order expired, has the server look on chain and credits what it finds', async () => {
    const { deps, last } = harness({
      confirmCredit: vi.fn(notConfirmed),
      reconcile: vi.fn(async () => ({ status: 'confirmed' as const, balance: 300 })),
    });
    await expect(resumePurchase(stale, deps)).resolves.toEqual({ kind: 'credited', balance: 300 });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('long after the order expired, with nothing on chain, gives it up without paying', async () => {
    const { deps, last } = harness({ confirmCredit: vi.fn(notConfirmed) });
    await expect(resumePurchase(stale, deps)).resolves.toMatchObject({ kind: 'refused', reason: 'order_expired' });
    expect(deps.pay).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });

  it('a purchase from before orders, with no expiry, keeps retrying', async () => {
    const { deps } = harness({ confirmCredit: vi.fn(notConfirmed) });
    await expect(resumePurchase({ requestId: 'request-1', signature: 'sig' }, deps)).rejects.toThrow(/confirming/);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });
});
