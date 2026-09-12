/**
 * The cloud copy of the profile as last fetched at boot — what the progress
 * screen compares against. Not persisted; refetched every launch.
 */
import { create } from 'zustand';

import type { CloudProfile } from '@/net/profileSync';

interface CloudState {
  profile: CloudProfile | null;
  checkedAt: number | null;
  setProfile: (profile: CloudProfile | null) => void;
}

export const useCloud = create<CloudState>((set) => ({
  profile: null,
  checkedAt: null,
  setProfile: (profile) => set({ profile, checkedAt: Date.now() }),
}));
