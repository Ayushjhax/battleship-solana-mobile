/**
 * Demo safety (P17). `forceOffline` is the hard offline toggle from the
 * hidden demo menu: while it is on, every network path in the app behaves as
 * if the device had no connection — no socket, no Supabase call, no presence,
 * no result flush — so a hostile venue wifi cannot make the demo hang on a
 * spinner. It persists, so it survives a restart on stage.
 *
 * The gate is checked in exactly four places, which together cover every
 * request the app can make: src/net/connectivity.ts (hasInternet /
 * subscribeConnectivity), src/net/api.ts (guard()), src/net/match-client.ts
 * (connect()) and the two Realtime hooks (presence.ts, chat.ts).
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

// The expo-sqlite localStorage shim is installed by src/net/supabase.ts and
// src/state/profile.ts before any screen renders. Under vitest (the match
// client imports this module) there is no shim, and memory is fine.
const memory = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

interface DemoData {
  forceOffline: boolean;
  /** The hidden menu is open (not persisted). */
  open: boolean;
}

interface DemoActions {
  setForceOffline: (on: boolean) => void;
  setOpen: (open: boolean) => void;
}

export type DemoState = DemoData & DemoActions;

export const useDemo = create<DemoState>()(
  persist(
    (set) => ({
      forceOffline: false,
      open: false,
      setForceOffline: (forceOffline) => set({ forceOffline }),
      setOpen: (open) => set({ open }),
    }),
    {
      name: 'eob.demo',
      version: 1,
      storage: createJSONStorage(() =>
        typeof localStorage === 'undefined' ? memoryStorage : localStorage,
      ),
      partialize: (s) => ({ forceOffline: s.forceOffline }),
    },
  ),
);

/** True while the demo menu's hard offline toggle is on. Safe to call anywhere. */
export function isForcedOffline(): boolean {
  return useDemo.getState().forceOffline;
}
