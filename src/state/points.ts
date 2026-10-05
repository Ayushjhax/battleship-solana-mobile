import 'expo-sqlite/localStorage/install';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PendingPointBuy {
  readonly requestId: string;
  readonly signature: string;
}

/**
 * A decided wager on a match against this device's AI, left behind by an older
 * version of the app. Offline wagers are gone (BUG-001); all that remains is to
 * hand this stake back. See src/net/offlineWager.ts.
 */
export interface PendingWagerSettlement {
  readonly requestId: string;
  readonly stake: number;
  readonly won: boolean;
}

export const WAGER_STAKE = 50;

interface PointState {
  balance: number;
  ready: boolean;
  error: string | null;
  welcomePending: boolean;
  pendingBuy: PendingPointBuy | null;
  pendingSellId: string | null;
  /** Persisted: the stake must still be refunded after a crash or a restart. */
  pendingWagerSettlement: PendingWagerSettlement | null;
  sync: (balance: number, welcomeAwarded?: boolean) => void;
  fail: (message: string) => void;
  dismissWelcome: () => void;
  setPendingBuy: (pending: PendingPointBuy | null) => void;
  setPendingSell: (requestId: string | null) => void;
  clearWagerSettlement: () => void;
  clear: () => void;
}

export const usePoints = create<PointState>()(
  persist(
    (set) => ({
      balance: 0,
      ready: false,
      error: null,
      welcomePending: false,
      pendingBuy: null,
      pendingSellId: null,
      pendingWagerSettlement: null,
      // Only the account sync knows whether the welcome was just granted; a
      // plain balance refresh must not dismiss a modal the player has not seen.
      sync: (balance, welcomeAwarded) =>
        set((state) => ({
          balance,
          ready: true,
          error: null,
          welcomePending: welcomeAwarded ?? state.welcomePending,
        })),
      fail: (error) => set({ error }),
      dismissWelcome: () => set({ welcomePending: false }),
      setPendingBuy: (pendingBuy) => set({ pendingBuy }),
      setPendingSell: (pendingSellId) => set({ pendingSellId }),
      clearWagerSettlement: () => set({ pendingWagerSettlement: null }),
      clear: () =>
        set({
          balance: 0,
          ready: false,
          error: null,
          welcomePending: false,
          pendingBuy: null,
          pendingSellId: null,
          pendingWagerSettlement: null,
        }),
    }),
    {
      name: 'eob.points',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        balance: state.balance,
        ready: state.ready,
        pendingBuy: state.pendingBuy,
        pendingSellId: state.pendingSellId,
        pendingWagerSettlement: state.pendingWagerSettlement,
      }),
    },
  ),
);
