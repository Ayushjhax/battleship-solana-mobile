/**
 * The account-switch rules. These decide what a returning Gmail sees after a
 * sign-out on a device whose local profile has been cleared, so a regression
 * here is a captain silently dropped into blank onboarding.
 */
import { describe, expect, it, vi } from 'vitest';

// The profile store only contributes DEFAULT_PROFILE here; its persistence
// layer is a native module, so it gets the same shim as profile.test.ts.
vi.mock('expo-sqlite/localStorage/install', () => ({}));
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
});

import { profilesConflict, shouldRestoreCloudProfile } from '../profileMerge';
import type { CloudProfile } from '../profileSync';
import { DEFAULT_PROFILE, type ProfileData } from '@/state/profile';

function cloud(patch: Partial<CloudProfile> = {}): CloudProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    // What public.handle_new_user() writes for every brand-new sign-up.
    name: 'Sailor 4821',
    avatarId: 1,
    avatarColor: '#3E2FB8',
    countryCode: 'IN',
    rankPoints: 0,
    battlesPlayed: 0,
    battlesWon: 0,
    coins: 0,
    gems: 0,
    steel: 0,
    buildings: 0,
    hasCompletedTutorial: false,
    updatedAt: new Date(0).toISOString(),
    ...patch,
  };
}

function local(patch: Partial<ProfileData> = {}): ProfileData {
  return { ...DEFAULT_PROFILE, ...patch };
}

describe('shouldRestoreCloudProfile', () => {
  it('restores an existing Gmail: the points account already existed', () => {
    const existing = cloud({ name: 'Nelson', rankPoints: 275, battlesPlayed: 9 });

    expect(shouldRestoreCloudProfile(existing, false)).toBe(true);
  });

  it('restores an existing Gmail that has not played but did pick a name', () => {
    // welcomeAwarded is false, so this identity has synced before whatever the
    // row holds — the row is theirs and must come back.
    expect(shouldRestoreCloudProfile(cloud({ name: 'Drake' }), false)).toBe(true);
  });

  it('leaves a truly new Gmail on the blank profile so onboarding runs', () => {
    // The trigger has already written a "Sailor 4821" row; adopting it would
    // skip name and avatar entry for a first-time captain.
    expect(shouldRestoreCloudProfile(cloud(), true)).toBe(false);
  });

  it('still restores a played-on profile whose points account is new', () => {
    // A profile older than the points table: its first sync reports the welcome
    // too, and onboarding would wipe a real ladder position off the screen.
    const veteran = cloud({ name: 'Hornblower', rankPoints: 400, battlesPlayed: 21 });

    expect(shouldRestoreCloudProfile(veteran, true)).toBe(true);
  });

  it('restores nothing when the row could not be read', () => {
    expect(shouldRestoreCloudProfile(null, false)).toBe(false);
    expect(shouldRestoreCloudProfile(null, true)).toBe(false);
  });
});

describe('profilesConflict after an account switch', () => {
  it('never asks a freshly signed-in device to choose', () => {
    // clearAccount() ran on sign-out, so there is no local side to conflict.
    expect(profilesConflict(local(), cloud({ rankPoints: 275 }))).toBe(false);
  });

  it('still asks when a played-on device meets a different played-on row', () => {
    expect(
      profilesConflict(local({ name: 'Nelson', rankPoints: 50 }), cloud({ rankPoints: 275 })),
    ).toBe(true);
  });
});
