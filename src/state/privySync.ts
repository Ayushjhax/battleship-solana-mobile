import { create } from 'zustand';

export interface SyncedPrivyAccount {
  readonly profileId: string;
  readonly privyUserId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly authProvider: string;
  readonly solanaWalletAddress: string | null;
  readonly solanaWalletId: string | null;
  readonly privyCreatedAt: string;
  readonly pointBalance: number;
  readonly welcomeAwarded: boolean;
}

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

interface PrivySyncState {
  status: SyncStatus;
  error: string | null;
  account: SyncedPrivyAccount | null;
  retryNonce: number;
  start: () => void;
  succeed: (account: SyncedPrivyAccount) => void;
  fail: (message: string) => void;
  retry: () => void;
  clear: () => void;
}

export const usePrivySync = create<PrivySyncState>((set) => ({
  status: 'idle',
  error: null,
  account: null,
  retryNonce: 0,
  start: () => set({ status: 'syncing', error: null }),
  succeed: (account) => set({ status: 'synced', account, error: null }),
  fail: (error) => set({ status: 'error', error }),
  retry: () => set((state) => ({ retryNonce: state.retryNonce + 1 })),
  clear: () => set({ status: 'idle', error: null, account: null }),
}));
