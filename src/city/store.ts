/**
 * The city store — part-01 §5.
 *
 * Holds the last snapshot the SERVER sent, the clock offset, and nothing it
 * worked out for itself. §2 of the design package: "The app may render an
 * optimistic animation, but never a balance it computed itself."
 *
 * Timers are rendered locally, from `serverNow` plus elapsed device time, so
 * a wrong device clock cannot earn anything — it can only make a countdown
 * look briefly wrong, and the next response repairs it.
 *
 * Persisted through the same expo-sqlite localStorage shim the profile uses,
 * so the city opens instantly from cache and is readable when hard-offline
 * mode is on (§5, §10).
 */
import 'expo-sqlite/localStorage/install';

import {
  CITY_CATALOGUE,
  isBuildingId,
  nextLevelSpec,
  type BuildingId,
  type CityState,
} from '@engine/city';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CityResponse, CitySnapshot, CityApiErrorCode } from './types';

export interface CityData {
  snapshot: CitySnapshot | null;
  /** serverNow - Date.now() at the last response. Added to Date.now() for rules time. */
  serverOffset: number;
  /** When the cached snapshot was taken, in device time. */
  fetchedAt: number | null;
  loading: boolean;
  error: CityApiErrorCode | null;
  /** True once a response has arrived in this session; a cache-only view is stale. */
  fresh: boolean;
}

export interface CityActions {
  applyResponse: (response: CityResponse) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: CityApiErrorCode | null) => void;
  reset: () => void;
}

export type CityStore = CityData & CityActions;

const EMPTY: CityData = {
  snapshot: null,
  serverOffset: 0,
  fetchedAt: null,
  loading: false,
  error: null,
  fresh: false,
};

export const useCity = create<CityStore>()(
  persist(
    (set) => ({
      ...EMPTY,
      applyResponse: (response) =>
        set({
          snapshot: response.city,
          serverOffset: response.serverNow - Date.now(),
          fetchedAt: Date.now(),
          loading: false,
          error: null,
          fresh: true,
        }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error, loading: false }),
      reset: () => set({ ...EMPTY }),
    }),
    {
      name: 'eob.city',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // `fresh`, `loading` and `error` are session facts, not cache.
      partialize: (s) => ({
        snapshot: s.snapshot,
        serverOffset: s.serverOffset,
        fetchedAt: s.fetchedAt,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors. Pure functions of (state, now) so they can be tested under Node.
// ---------------------------------------------------------------------------

/** The server's idea of now, reconstructed on the device. */
export function serverNow(state: Pick<CityData, 'serverOffset'>, now = Date.now()): number {
  return now + state.serverOffset;
}

export function freeWorkers(state: Pick<CityData, 'snapshot'>): number {
  return state.snapshot?.freeWorkers ?? 0;
}

export function collectable(state: Pick<CityData, 'snapshot'>): {
  total: number;
  ids: readonly BuildingId[];
} {
  return state.snapshot?.collectable ?? { total: 0, ids: [] };
}

/**
 * Seconds left on a job, clamped at 0 — §6: "the client clamps a negative
 * remaining time to 0". A job whose endsAt has passed but which the server has
 * not settled yet reads as 0, which the UI shows as "Finishing…", never as a
 * negative timer.
 */
export function secondsLeft(
  state: Pick<CityData, 'snapshot' | 'serverOffset'>,
  buildingId: BuildingId,
  now = Date.now(),
): number {
  const job = state.snapshot?.city.buildings[buildingId]?.upgrading;
  if (!job) return 0;
  return Math.max(0, Math.ceil((job.endsAt - serverNow(state, now)) / 1000));
}

/** 0..1 through the current job, clamped. The pen-drawing progress in Part 2. */
export function buildProgress(
  state: Pick<CityData, 'snapshot' | 'serverOffset'>,
  buildingId: BuildingId,
  now = Date.now(),
): number {
  const job = state.snapshot?.city.buildings[buildingId]?.upgrading;
  if (!job) return 0;
  const span = job.endsAt - job.startedAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (serverNow(state, now) - job.startedAt) / span));
}

export interface Affordability {
  readonly ok: boolean;
  /** How much is missing, per resource. Zero when there is enough. */
  readonly shortSteel: number;
  readonly shortCoins: number;
}

/**
 * Whether the next level is affordable RIGHT NOW, for greying a button and
 * showing "380 steel short". It is a hint, never a decision: the server still
 * re-checks and can still answer `not-enough-steel`.
 */
export function canAfford(
  state: Pick<CityData, 'snapshot'>,
  buildingId: BuildingId,
): Affordability {
  const snapshot = state.snapshot;
  if (!snapshot) return { ok: false, shortSteel: 0, shortCoins: 0 };
  const next = nextLevelSpec(snapshot.city, buildingId);
  if (!next) return { ok: false, shortSteel: 0, shortCoins: 0 };
  const shortSteel = Math.max(0, next.steel - snapshot.wallet.steel);
  const shortCoins = Math.max(0, next.coins - snapshot.wallet.coins);
  return { ok: shortSteel === 0 && shortCoins === 0, shortSteel, shortCoins };
}

/** Plot features the server has enabled, for hiding gated plots entirely. */
export function plotVisible(state: Pick<CityData, 'snapshot'>, buildingId: BuildingId): boolean {
  const spec = CITY_CATALOGUE[buildingId];
  if (!spec?.feature) return true;
  return (state.snapshot?.features ?? []).includes(spec.feature);
}

/** Convenience for the dev screen and Part 2's plot layer. */
export function buildingIdsFrom(city: CityState | null | undefined): BuildingId[] {
  if (!city) return [];
  return Object.keys(city.buildings).filter(isBuildingId);
}
