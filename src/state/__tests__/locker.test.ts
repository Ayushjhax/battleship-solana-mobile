import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

import { STORE_COLOURS, STORE_ITEMS, unlockId, unlocksFrom } from '../../features/store/catalog';
import { spendableCoins, useLocker, walletFor } from '../locker';
import { DEFAULT_PROFILE, useProfile } from '../profile';

const wallet = (account: string | null) => walletFor(useLocker.getState().wallets, account);

describe('store purchases', () => {
  beforeEach(() => {
    values.clear();
    useProfile.setState({ ...DEFAULT_PROFILE });
    useLocker.getState().reset();
  });

  it('unlocks once, and takes the price off what can be spent', () => {
    const buy = useLocker.getState().purchase;
    expect(buy('u1', 'crimson:bomber', 200, 550)).toBe('unlocked');
    expect(buy('u1', 'crimson:bomber', 200, 550)).toBe('owned');
    expect(wallet('u1')).toEqual({ spent: 200, unlocks: ['crimson:bomber'] });
    expect(spendableCoins(550, wallet('u1'))).toBe(350);
  });

  it('refuses a price larger than the coins left, and records nothing', () => {
    const buy = useLocker.getState().purchase;
    expect(buy('u1', 'purple:battleship', 500, 700)).toBe('unlocked');
    expect(buy('u1', 'emerald:battleship', 500, 700)).toBe('short');
    expect(wallet('u1').unlocks).toEqual(['purple:battleship']);
    expect(wallet('u1').spent).toBe(500);
  });

  it('never shows a negative balance when the server total drops under what was spent', () => {
    useLocker.getState().purchase('u1', 'crimson:mine', 200, 200);
    expect(spendableCoins(120, wallet('u1'))).toBe(0);
  });

  it('keeps each account to itself on a shared device', () => {
    const buy = useLocker.getState().purchase;
    buy('u1', 'crimson:radar', 300, 1000);
    expect(wallet('u2')).toEqual({ spent: 0, unlocks: [] });
    expect(buy('u2', 'crimson:radar', 300, 300)).toBe('unlocked');
    expect(wallet('u1').spent).toBe(300);
    expect(wallet('u2').spent).toBe(300);
  });

  it('carries a guest purchase over to the first account that buys', () => {
    const buy = useLocker.getState().purchase;
    buy(null, 'emerald:boat', 200, 400);
    expect(wallet('u1').unlocks).toEqual(['emerald:boat']);
    expect(buy('u1', 'emerald:cruiser', 400, 400)).toBe('short');
    expect(buy('u1', 'emerald:mine', 200, 400)).toBe('unlocked');
    expect(wallet('u1')).toEqual({ spent: 400, unlocks: ['emerald:boat', 'emerald:mine'] });
    expect(useLocker.getState().wallets.guest).toBeUndefined();
  });

  // BUG-019: the guest wallet stayed unbound until an account bought
  // something, so it showed under every account that signed in on the device
  // afterwards — their items, and their coins spent — and the first of them to
  // buy anything kept it.
  it('gives guest purchases to the account that signs in, not to the next one on the device', () => {
    useLocker.getState().purchase(null, 'emerald:boat', 200, 400);
    useProfile.getState().setUserId('u1');
    useProfile.getState().clearAccount();
    useProfile.getState().setUserId('u2');

    expect(wallet('u2')).toEqual({ spent: 0, unlocks: [] });
    expect(wallet('u1')).toEqual({ spent: 200, unlocks: ['emerald:boat'] });
    expect(useLocker.getState().wallets.guest).toBeUndefined();
  });

  it('adds guest purchases to what the account already bought on this device', () => {
    const buy = useLocker.getState().purchase;
    buy('u1', 'crimson:radar', 300, 1000);
    buy(null, 'emerald:boat', 200, 400);
    useProfile.getState().setUserId('u1');

    expect(wallet('u1')).toEqual({ spent: 500, unlocks: ['crimson:radar', 'emerald:boat'] });
    expect(useLocker.getState().wallets.guest).toBeUndefined();
  });

  it('binds a guest wallet left over from an older version to the account signed in at launch', async () => {
    values.set(
      'eob.profile',
      JSON.stringify({ state: { ...DEFAULT_PROFILE, userId: 'u1' }, version: 1 }),
    );
    values.set(
      'eob.locker',
      JSON.stringify({
        state: { wallets: { guest: { spent: 200, unlocks: ['emerald:boat'] } } },
        version: 1,
      }),
    );
    vi.resetModules();
    const fresh = await import('../locker');
    const { useProfile: freshProfile } = await import('../profile');
    const walletOf = (account: string) => fresh.walletFor(fresh.useLocker.getState().wallets, account);

    expect(walletOf('u1')).toEqual({ spent: 200, unlocks: ['emerald:boat'] });
    freshProfile.getState().clearAccount();
    freshProfile.getState().setUserId('u2');
    expect(walletOf('u2')).toEqual({ spent: 0, unlocks: [] });
  });
});

describe('store catalogue', () => {
  it('reads recorded ids back in catalogue order and skips unknown ones', () => {
    const got = unlocksFrom(['purple:mine', 'crimson:bomber', 'gold:bomber', 'crimson:nothing']);
    expect(got.map((u) => u.id)).toEqual(['crimson:bomber', 'purple:mine']);
  });

  it('has a unique id for every item in every colour', () => {
    const ids = STORE_COLOURS.flatMap((c) => STORE_ITEMS.map((i) => unlockId(c, i.key)));
    expect(new Set(ids).size).toBe(STORE_COLOURS.length * STORE_ITEMS.length);
  });
});
