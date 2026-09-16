/**
 * The pure half of the profile round trip: what a cloud row looks like as
 * store fields, what the store looks like as a patch, and the one rule that
 * decides whether the progress chooser appears. No client here, so it runs
 * under plain Node.
 */
import type { AvatarId, ProfileData } from '@/state/profile';
import { AVATAR_TINTS, type AvatarTint } from '@/ui/tokens';

import type { CloudProfile, ProfilePatch } from './profileSync';

/** Everything the store holds that the cloud row also holds. */
export function localAsPatch(local: ProfileData): ProfilePatch {
  return {
    name: local.name,
    avatarId: local.avatarId,
    avatarColor: local.avatarColor,
    countryCode: local.countryCode,
    rankPoints: local.rankPoints,
    battlesPlayed: local.battlesPlayed,
    battlesWon: local.battlesWon,
    coins: local.coins,
    gems: local.gems,
    buildings: local.buildings,
    hasCompletedTutorial: local.hasCompletedTutorial,
  };
}

function asAvatarId(n: number): AvatarId {
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

function asTint(hex: string): AvatarTint {
  return (AVATAR_TINTS as readonly string[]).includes(hex) ? (hex as AvatarTint) : AVATAR_TINTS[0];
}

/** A cloud row as store fields, for mergeRemote(). Unknown values fall back to defaults. */
export function cloudAsLocal(cloud: CloudProfile): ProfilePatch {
  return {
    name: cloud.name,
    avatarId: asAvatarId(cloud.avatarId),
    avatarColor: asTint(cloud.avatarColor),
    countryCode: cloud.countryCode,
    rankPoints: cloud.rankPoints,
    battlesPlayed: cloud.battlesPlayed,
    battlesWon: cloud.battlesWon,
    coins: cloud.coins,
    gems: cloud.gems,
    buildings: cloud.buildings,
    hasCompletedTutorial: cloud.hasCompletedTutorial,
  };
}

/**
 * A cloud row that has actually been played on. Sign-up creates every row
 * with a generated "Sailor 4821" name, so a name alone is not progress.
 */
export function cloudHasProgress(cloud: CloudProfile): boolean {
  return cloud.battlesPlayed > 0 || cloud.rankPoints > 0 || cloud.buildings > 0;
}

/**
 * Does this cloud row belong to a captain who already exists, so a sign-in
 * should restore it over the cleared local profile?
 *
 * `welcomeAwarded` is the server's answer to "did THIS sync create the points
 * account", so it is true exactly once per Privy identity — a truly new Gmail,
 * which must keep the blank local profile and go through onboarding. Its row
 * does exist by then (the sign-up trigger writes a generated "Sailor 4821"),
 * which is why the row's presence alone cannot decide this.
 *
 * The progress check is the safety net for a profile that predates the points
 * table: its first sync also reports `welcomeAwarded`, and restoring it is far
 * better than sending a played-on captain back through onboarding.
 */
export function shouldRestoreCloudProfile(
  cloud: CloudProfile | null,
  welcomeAwarded: boolean,
): cloud is CloudProfile {
  if (!cloud) return false;
  return !welcomeAwarded || cloudHasProgress(cloud);
}

/**
 * The progress screen appears ONLY when both sides exist and differ. "Exist"
 * means played on: a local profile with a name, a cloud row with progress.
 */
export function profilesConflict(local: ProfileData, cloud: CloudProfile | null): boolean {
  if (!cloud || !cloudHasProgress(cloud)) return false;
  if (local.name.trim().length === 0) return false;
  return (
    local.name !== cloud.name ||
    local.rankPoints !== cloud.rankPoints ||
    local.battlesPlayed !== cloud.battlesPlayed ||
    local.coins !== cloud.coins ||
    local.gems !== cloud.gems ||
    local.buildings !== cloud.buildings ||
    local.avatarId !== cloud.avatarId ||
    local.avatarColor !== cloud.avatarColor
  );
}
