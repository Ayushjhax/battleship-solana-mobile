/**
 * The raid store — part-07 §3.
 *
 * Holds the last payload the SERVER sent, and nothing it worked out for
 * itself. Same rule as the city store (Part 1 §5): "The app may render an
 * optimistic animation, but never a balance it computed itself."
 *
 * What IS persisted: the defence log (so the dog-ears survive a restart) and
 * the harbour's own layout (so the editor opens instantly). What is NOT: the
 * live raid. A raid is four minutes long and lives on the server; persisting
 * it would let a restarted app render a board for a raid that has since
 * settled, which is exactly the dead screen §9.3 forbids. On restart the
 * client asks `/raid/status` instead.
 */
import 'expo-sqlite/localStorage/install';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { orderLog } from './ui/defenceLog';
import type {
  DefenceLogEntry,
  RaidApiErrorCode,
  SessionTarget,
  Settlement,
  RaidView,
} from './types';

export interface HarbourLayoutSnapshot {
  readonly ships: readonly unknown[];
  readonly arsenal: readonly unknown[];
  /** Part 10B — the sea this harbour defends on. */
  readonly sea?: string;
}

export interface RaidData {
  /** The player's own harbour, as last read. Safe to persist: it is theirs. */
  harbour: HarbourLayoutSnapshot | null;
  /** True once the player has saved a harbour themselves (§1's Captain line). */
  harbourEdited: boolean;
  /** serverNow - Date.now() at the last response. */
  serverOffset: number;
  /** The live raid, in memory only — never persisted. */
  raidId: string | null;
  target: SessionTarget | null;
  view: RaidView | null;
  settlement: Settlement | null;
  /** Renown and shield, from the last harbour read. */
  renown: number;
  shieldUntil: number | null;
  /** §4 — the last 30, newest first. */
  log: DefenceLogEntry[];
  loading: boolean;
  error: RaidApiErrorCode | null;
}

export interface RaidActions {
  setHarbour: (layout: HarbourLayoutSnapshot, serverNow: number) => void;
  markHarbourEdited: () => void;
  openedRaid: (raidId: string, target: SessionTarget, view: RaidView, serverNow: number) => void;
  setView: (view: RaidView, serverNow: number) => void;
  setSettlement: (settlement: Settlement) => void;
  clearRaid: () => void;
  setLog: (entries: readonly DefenceLogEntry[], serverNow: number) => void;
  markRead: (raidIds: readonly string[]) => void;
  patchLogEntry: (raidId: string, patch: Partial<DefenceLogEntry>) => void;
  setRenown: (renown: number, shieldUntil: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: RaidApiErrorCode | null) => void;
  reset: () => void;
}

export type RaidStore = RaidData & RaidActions;

const EMPTY: RaidData = {
  harbour: null,
  harbourEdited: false,
  serverOffset: 0,
  raidId: null,
  target: null,
  view: null,
  settlement: null,
  renown: 0,
  shieldUntil: null,
  log: [],
  loading: false,
  error: null,
};

export const useRaid = create<RaidStore>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      setHarbour: (harbour, serverNow) =>
        set({ harbour, serverOffset: serverNow - Date.now(), error: null }),

      markHarbourEdited: () => set({ harbourEdited: true }),

      openedRaid: (raidId, target, view, serverNow) =>
        set({
          raidId,
          target,
          view,
          settlement: null,
          serverOffset: serverNow - Date.now(),
          error: null,
        }),

      setView: (view, serverNow) => set({ view, serverOffset: serverNow - Date.now() }),

      setSettlement: (settlement) =>
        set({ settlement, view: settlement.view, serverOffset: settlement.serverNow - Date.now() }),

      clearRaid: () => set({ raidId: null, target: null, view: null, settlement: null }),

      setLog: (entries, serverNow) =>
        set({ log: orderLog(entries), serverOffset: serverNow - Date.now() }),

      markRead: (raidIds) => {
        const ids = new Set(raidIds);
        set({
          log: get().log.map((entry) =>
            ids.has(entry.raidId) ? { ...entry, read: true } : entry,
          ),
        });
      },

      patchLogEntry: (raidId, patch) =>
        set({
          log: get().log.map((entry) =>
            entry.raidId === raidId ? { ...entry, ...patch } : entry,
          ),
        }),

      setRenown: (renown, shieldUntil) => set({ renown, shieldUntil }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      reset: () => set(EMPTY),
    }),
    {
      name: 'raid-v1',
      storage: createJSONStorage(() => localStorage),
      /**
       * The allow-list is the point. `raidId`, `view` and `settlement` are
       * absent on purpose: a persisted live raid is a board with no server
       * behind it, and rendering one is the dead screen §9.3 forbids.
       */
      partialize: (state) => ({
        harbour: state.harbour,
        harbourEdited: state.harbourEdited,
        renown: state.renown,
        shieldUntil: state.shieldUntil,
        log: state.log,
      }),
    },
  ),
);

/** Rules time, the same way the city does it (Part 1 §5). */
export function raidNow(): number {
  return Date.now() + useRaid.getState().serverOffset;
}

/** §1 — the shield timer in the header, or null when unshielded. */
export function shieldMsLeft(): number | null {
  const until = useRaid.getState().shieldUntil;
  if (until === null) return null;
  const left = until - raidNow();
  return left > 0 ? left : null;
}
