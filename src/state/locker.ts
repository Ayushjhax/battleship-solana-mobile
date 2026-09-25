/**
 * The store's purchases. Coins belong to the server — every sync overwrites
 * `profile.coins` with the server's total, and clients may not write score
 * columns — so a purchase can't take coins off that number. It is recorded
 * here instead, on this device, per account: `spent` comes off the server's
 * total wherever a balance is shown (`spendableCoins`), `unlocks` are the
 * items bought. Moving this onto the server needs a table and an RPC that
 * deducts atomically; until then a reinstall forgets what was bought.
 *
 * A player with no account id yet (offline, before the first sync) buys as
 * the device's guest; the first purchase under a real id carries that over.
 */
import 'expo-sqlite/localStorage/install';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useProfile } from './profile';

export interface StoreWallet {
  readonly spent: number;
  readonly unlocks: readonly string[];
}

export type PurchaseResult = 'unlocked' | 'owned' | 'short';

interface LockerState {
  wallets: Readonly<Record<string, StoreWallet>>;
  /** `coins` is the account's server total; the price must fit in what's left of it. */
  purchase: (account: string | null, id: string, price: number, coins: number) => PurchaseResult;
  reset: () => void;
}

const GUEST = 'guest';
const EMPTY: StoreWallet = { spent: 0, unlocks: [] };

export function walletFor(
  wallets: Readonly<Record<string, StoreWallet>>,
  account: string | null,
): StoreWallet {
  return (account ? wallets[account] : undefined) ?? wallets[GUEST] ?? EMPTY;
}

export function spendableCoins(coins: number, wallet: StoreWallet): number {
  return Math.max(0, coins - wallet.spent);
}

export const useLocker = create<LockerState>()(
  persist(
    (set, get) => ({
      wallets: {},
      purchase: (account, id, price, coins) => {
        const { wallets } = get();
        const wallet = walletFor(wallets, account);
        if (wallet.unlocks.includes(id)) return 'owned';
        if (spendableCoins(coins, wallet) < price) return 'short';
        const next = {
          ...wallets,
          [account ?? GUEST]: { spent: wallet.spent + price, unlocks: [...wallet.unlocks, id] },
        };
        // A guest wallet adopted by an account is the account's now.
        if (account && !wallets[account]) delete next[GUEST];
        set({ wallets: next });
        return 'unlocked';
      },
      reset: () => set({ wallets: {} }),
    }),
    {
      name: 'eob.locker',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ wallets: s.wallets }),
    },
  ),
);

/** The signed-in account's purchases. */
export function useStoreWallet(): StoreWallet {
  const account = useProfile((s) => s.userId);
  return useLocker((s) => walletFor(s.wallets, account));
}

/** Coins earned minus coins spent in the store: the balance every screen shows. */
export function useSpendableCoins(): number {
  const coins = useProfile((s) => s.coins);
  return spendableCoins(coins, useStoreWallet());
}
