/**
 * The profile's round trip, on top of src/net/api.ts. The store in
 * src/state/profile.ts is the source of truth on the device; this pulls the
 * cloud copy down and pushes the columns a player is allowed to write.
 * Best-effort: the game never waits on it.
 *
 * Scores never go up from here — RLS rejects them (0001_profiles.sql). The
 * match server writes those with the secret key.
 */
import type { ProfileData } from '@/state/profile';
import { hasInternet } from './connectivity';
import { getProfile, updateProfile, type Profile, type ProfileUpdate } from './api';

export interface CloudProfile {
  readonly id: string;
  readonly name: string;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string;
  readonly rankPoints: number;
  readonly battlesPlayed: number;
  readonly battlesWon: number;
  readonly coins: number;
  readonly gems: number;
  readonly steel: number;
  readonly buildings: number;
  readonly hasCompletedTutorial: boolean;
  /** ISO timestamp of the last save. */
  readonly updatedAt: string;
}

export type ProfilePatch = Partial<
  Pick<
    ProfileData,
    | 'name'
    | 'avatarId'
    | 'avatarColor'
    | 'countryCode'
    | 'rankPoints'
    | 'battlesPlayed'
    | 'battlesWon'
    | 'coins'
    | 'gems'
    | 'steel'
    | 'buildings'
    | 'hasCompletedTutorial'
  >
>;

function fromApi(p: Profile): CloudProfile {
  return {
    id: p.id,
    name: p.name,
    avatarId: p.avatar_id,
    avatarColor: p.avatar_color,
    countryCode: p.country_code ?? 'IN',
    rankPoints: p.rank_points,
    battlesPlayed: p.battles_played,
    battlesWon: p.battles_won,
    coins: p.coins,
    gems: p.gems,
    steel: p.steel,
    buildings: p.buildings,
    hasCompletedTutorial: p.has_completed_tutorial,
    updatedAt: p.updated_at ?? new Date(0).toISOString(),
  };
}

/** The signed-in user's row, or null (no row yet, offline, unconfigured). */
export async function pullCloudProfile(userId: string): Promise<CloudProfile | null> {
  if (!(await hasInternet())) return null;
  const result = await getProfile(userId);
  if (!result.ok) {
    if (result.error.code !== 'unconfigured')
      console.warn('[profile] pull failed:', result.error.message);
    return null;
  }
  return result.value ? fromApi(result.value) : null;
}

/** Writes the identity columns a player may change. Score fields are ignored. */
export async function pushProfile(userId: string, patch: ProfilePatch): Promise<boolean> {
  if (!(await hasInternet())) return false;
  const allowed: ProfileUpdate = {};
  if (patch.name !== undefined) allowed.name = patch.name;
  if (patch.avatarId !== undefined) allowed.avatarId = patch.avatarId;
  if (patch.avatarColor !== undefined) allowed.avatarColor = patch.avatarColor;
  if (patch.countryCode !== undefined) allowed.countryCode = patch.countryCode;
  if (patch.hasCompletedTutorial !== undefined)
    allowed.hasCompletedTutorial = patch.hasCompletedTutorial;
  if (Object.keys(allowed).length === 0) return true;

  const result = await updateProfile(userId, allowed);
  if (!result.ok) {
    if (result.error.code !== 'unconfigured')
      console.warn('[profile] push failed:', result.error.message);
    return false;
  }
  return true;
}

export {
  cloudAsLocal,
  cloudHasProgress,
  localAsPatch,
  profilesConflict,
  shouldRestoreCloudProfile,
} from './profileMerge';
