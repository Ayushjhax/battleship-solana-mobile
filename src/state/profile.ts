/**
 * The player's profile — the one source of truth every screen reads from.
 * Nothing renders from Supabase directly; the network only ever writes into
 * this store (docs/brief.md 4.5).
 *
 * Persisted through expo-sqlite's synchronous localStorage shim, so the store
 * is hydrated by the time the first screen renders.
 */
import 'expo-sqlite/localStorage/install';

import { REWARD } from '@engine/ranks';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { AVATAR_TINTS, type AvatarTint } from '@/ui/tokens';

export type AvatarId = 1 | 2 | 3 | 4;

export interface PendingResult {
  /** Stable across retries; the server uses it as its idempotency key. */
  readonly id: string;
  readonly mode: 'ai' | 'hotseat';
  readonly won: boolean;
  readonly completedAt: string;
}

export interface SyncedProfileTotals {
  readonly rankPoints: number;
  readonly battlesPlayed: number;
  readonly battlesWon: number;
  readonly coins: number;
}

export interface ProfileData {
  /** Supabase gameplay user id once verified Privy bootstrap finishes; null offline. */
  userId: string | null;
  name: string;
  avatarId: AvatarId;
  avatarColor: AvatarTint;
  countryCode: string;
  rankPoints: number;
  battlesPlayed: number;
  battlesWon: number;
  coins: number;
  gems: number;
  /** Port-city buildings (P15). Shown on the progress screen. */
  buildings: number;
  hasCompletedTutorial: boolean;
  /** The Captain's port-city welcome is a first-visit-only line (P15). */
  hasVisitedCity: boolean;
  /** Server-settled matches already reflected here, so a re-mounted result can't double count. */
  settledMatchIds: readonly string[];
  soundOn: boolean;
  musicOn: boolean;
  hapticsOn: boolean;
  soundVolume: number;
  musicVolume: number;
  pendingResults: readonly PendingResult[];
}

export type ProfileSetting = 'soundOn' | 'musicOn' | 'hapticsOn';
export type ProfileVolume = 'soundVolume' | 'musicVolume';

export interface ProfileActions {
  setUserId: (userId: string | null) => void;
  setIdentity: (
    identity: Partial<Pick<ProfileData, 'name' | 'avatarId' | 'avatarColor' | 'countryCode'>>,
  ) => void;
  setSetting: (key: ProfileSetting, value: boolean) => void;
  setVolume: (key: ProfileVolume, value: number) => void;
  /**
   * An offline AI or hot-seat result: applies its coins immediately and queues
   * an idempotent server sync. Only matches the server sees count toward the
   * ladder, so it never moves rank points or battles played/won (BUG-010).
   */
  queueResult: (result: PendingResult) => void;
  /**
   * An online match the SERVER settled (0008): mirror its rewards here so the
   * result screen and menu read right at once, without waiting on a sync.
   * Returns false if this match was already applied.
   */
  recordOnlineResult: (
    matchId: string,
    won: boolean,
    reward: { points: number; coins: number },
  ) => boolean;
  markCityVisited: () => void;
  /** Removes acknowledged results and reconciles the authoritative totals. */
  settleResults: (ids: readonly string[], totals?: SyncedProfileTotals) => void;
  markTutorialComplete: () => void;
  resetTutorial: () => void;
  /** Overwrites local fields with what the server holds (P11 sync). */
  mergeRemote: (remote: Partial<ProfileData>) => void;
  /** Clears identity/progress while keeping this device's audio preferences. */
  clearAccount: () => void;
  reset: () => void;
}

export type ProfileState = ProfileData & ProfileActions;

export const DEFAULT_PROFILE: ProfileData = {
  userId: null,
  name: '',
  avatarId: 1,
  avatarColor: AVATAR_TINTS[0],
  countryCode: 'IN',
  rankPoints: 0,
  battlesPlayed: 0,
  battlesWon: 0,
  coins: 0,
  gems: 0,
  buildings: 0,
  hasCompletedTutorial: false,
  hasVisitedCity: false,
  settledMatchIds: [],
  soundOn: true,
  musicOn: true,
  hapticsOn: true,
  soundVolume: 1,
  musicVolume: 0.35,
  pendingResults: [],
};

/** What an offline result pays: the match reward's coins, and nothing the ladder ranks by. */
export function offlineCoins(won: boolean): number {
  return (won ? REWARD.win : REWARD.loss).coins;
}

/** What results still waiting to sync have paid — on top of any cloud total. */
function unsyncedCoins(results: readonly PendingResult[]): number {
  return results.reduce((sum, result) => sum + offlineCoins(result.won), 0);
}

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PROFILE,
      setUserId: (userId) => set({ userId }),
      setIdentity: (identity) => set(identity),
      setSetting: (key, value) => set({ [key]: value }),
      setVolume: (key, value) => set({ [key]: Math.max(0, Math.min(1, value)) }),
      queueResult: (result) =>
        set((s) => {
          if (s.pendingResults.some((pending) => pending.id === result.id)) return s;
          return {
            coins: s.coins + offlineCoins(result.won),
            pendingResults: [...s.pendingResults, result],
          };
        }),
      recordOnlineResult: (matchId, won, reward) => {
        if (get().settledMatchIds.includes(matchId)) return false;
        set((s) => ({
          rankPoints: s.rankPoints + reward.points,
          coins: s.coins + reward.coins,
          battlesPlayed: s.battlesPlayed + 1,
          battlesWon: s.battlesWon + (won ? 1 : 0),
          settledMatchIds: [...s.settledMatchIds.slice(-19), matchId],
        }));
        return true;
      },
      markCityVisited: () => set({ hasVisitedCity: true }),
      settleResults: (ids, totals) =>
        set((s) => {
          const acknowledged = new Set(ids);
          const pendingResults = s.pendingResults.filter((result) => !acknowledged.has(result.id));
          if (!totals) return { pendingResults };
          // The server's totals, plus what the still-unsynced results pay —
          // which is coins only (BUG-010).
          return {
            pendingResults,
            rankPoints: totals.rankPoints,
            coins: totals.coins + unsyncedCoins(pendingResults),
            battlesPlayed: totals.battlesPlayed,
            battlesWon: totals.battlesWon,
          };
        }),
      markTutorialComplete: () => set({ hasCompletedTutorial: true }),
      resetTutorial: () => set({ hasCompletedTutorial: false }),
      // A cloud row's coins don't include the results still waiting to sync;
      // keep those on top, as settleResults does. Taken as they were, the
      // balance dipped on every launch until the next sync (BUG-022).
      mergeRemote: (remote) =>
        set((s) =>
          remote.coins === undefined
            ? remote
            : {
                ...remote,
                coins: remote.coins + unsyncedCoins(remote.pendingResults ?? s.pendingResults),
              },
        ),
      clearAccount: () =>
        set((state) => ({
          ...DEFAULT_PROFILE,
          soundOn: state.soundOn,
          musicOn: state.musicOn,
          hapticsOn: state.hapticsOn,
          soundVolume: state.soundVolume,
          musicVolume: state.musicVolume,
        })),
      reset: () => set(DEFAULT_PROFILE),
    }),
    {
      name: 'eob.profile',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        userId: s.userId,
        name: s.name,
        avatarId: s.avatarId,
        avatarColor: s.avatarColor,
        countryCode: s.countryCode,
        rankPoints: s.rankPoints,
        battlesPlayed: s.battlesPlayed,
        battlesWon: s.battlesWon,
        coins: s.coins,
        gems: s.gems,
        buildings: s.buildings,
        hasCompletedTutorial: s.hasCompletedTutorial,
        hasVisitedCity: s.hasVisitedCity,
        settledMatchIds: s.settledMatchIds,
        soundOn: s.soundOn,
        musicOn: s.musicOn,
        hapticsOn: s.hapticsOn,
        soundVolume: s.soundVolume,
        musicVolume: s.musicVolume,
        pendingResults: s.pendingResults,
      }),
    },
  ),
);

/** Resolves once persisted state has been read — immediately with a sync storage. */
export function waitForProfileHydration(): Promise<void> {
  if (useProfile.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useProfile.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}
