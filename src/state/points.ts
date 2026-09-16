import 'expo-sqlite/localStorage/install';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PendingPointBuy {
  readonly requestId: string;
  readonly signature: string;
}

/** The stake held for the match against this device's AI that is under way. */
export interface ActiveWager {
  readonly requestId: string;
  readonly stake: number;
}

/** That same wager once the match is decided, waiting on the server payout. */
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
  /**
   * Deliberately NOT persisted: a hold that outlives the process is handed
   * straight back by the next reservation (reserve_point_wager returns an
   * existing unmatched hold instead of taking a second stake), so there is
   * nothing here worth restoring.
   */
  activeWager: ActiveWager | null;
  /** Persisted: a won stake must still be paid out after a crash or a restart. */
  pendingWagerSettlement: PendingWagerSettlement | null;
  /** Why the last settlement attempt failed, so the result screen can stop claiming it paid. */
  wagerSettlementError: string | null;
  sync: (balance: number, welcomeAwarded?: boolean) => void;
  fail: (message: string) => void;
  dismissWelcome: () => void;
  setPendingBuy: (pending: PendingPointBuy | null) => void;
  setPendingSell: (requestId: string | null) => void;
  beginWager: (requestId: string) => void;
  /** Moves the live wager into the settlement queue. No-op without one. */
  finishWager: (won: boolean) => void;
  clearWagerSettlement: () => void;
  setWagerSettlementError: (message: string | null) => void;
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
      activeWager: null,
      pendingWagerSettlement: null,
      wagerSettlementError: null,
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
      beginWager: (requestId) =>
        set({ activeWager: { requestId, stake: WAGER_STAKE }, wagerSettlementError: null }),
      finishWager: (won) =>
        set((state) =>
          state.activeWager
            ? {
                activeWager: null,
                pendingWagerSettlement: { ...state.activeWager, won },
              }
            : state,
        ),
      clearWagerSettlement: () => set({ pendingWagerSettlement: null }),
      setWagerSettlementError: (wagerSettlementError) => set({ wagerSettlementError }),
      clear: () =>
        set({
          balance: 0,
          ready: false,
          error: null,
          welcomePending: false,
          pendingBuy: null,
          pendingSellId: null,
          activeWager: null,
          pendingWagerSettlement: null,
          wagerSettlementError: null,
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
