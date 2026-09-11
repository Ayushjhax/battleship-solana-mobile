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

export interface ProfileData {
  /** Supabase auth user id once anonymous sign-in has happened; null offline. */
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
  hasCompletedTutorial: boolean;
  soundOn: boolean;
  musicOn: boolean;
  hapticsOn: boolean;
}

export type ProfileSetting = 'soundOn' | 'musicOn' | 'hapticsOn';

export interface ProfileActions {
  setUserId: (userId: string | null) => void;
  setIdentity: (
    identity: Partial<Pick<ProfileData, 'name' | 'avatarId' | 'avatarColor' | 'countryCode'>>,
  ) => void;
  setSetting: (key: ProfileSetting, value: boolean) => void;
  /** Applies docs/brief.md 3.5 rewards: win +25/+50, loss +5/+10. */
  recordResult: (won: boolean) => void;
  markTutorialComplete: () => void;
  /** Overwrites local fields with what the server holds (P11 sync). */
  mergeRemote: (remote: Partial<ProfileData>) => void;
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
  hasCompletedTutorial: false,
  soundOn: true,
  musicOn: true,
  hapticsOn: true,
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      ...DEFAULT_PROFILE,
      setUserId: (userId) => set({ userId }),
      setIdentity: (identity) => set(identity),
      setSetting: (key, value) => set({ [key]: value }),
      recordResult: (won) =>
        set((s) => {
          const reward = won ? REWARD.win : REWARD.loss;
          return {
            rankPoints: s.rankPoints + reward.points,
            coins: s.coins + reward.coins,
            battlesPlayed: s.battlesPlayed + 1,
            battlesWon: s.battlesWon + (won ? 1 : 0),
          };
        }),
      markTutorialComplete: () => set({ hasCompletedTutorial: true }),
      mergeRemote: (remote) => set(remote),
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
        hasCompletedTutorial: s.hasCompletedTutorial,
        soundOn: s.soundOn,
        musicOn: s.musicOn,
        hapticsOn: s.hapticsOn,
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
