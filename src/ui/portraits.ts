/**
 * The captain a player chose, as a portrait: AVATAR_SCREEN_ART's variant for
 * their avatar id in their saved tint. Every screen that shows a captain (the
 * avatar picker, the match reveal, the profile) reads it from here, so a
 * colour picked once shows the same everywhere.
 */
import { AVATAR_SCREEN_ART, type Asset } from './assets';
import { AVATAR_TINTS, type AvatarTint } from './tokens';

export type PortraitId = 1 | 2 | 3 | 4;

/** The tint each portrait is drawn in: its source art, untouched. */
export const NATIVE_TINT: Record<PortraitId, number> = { 1: 0, 2: 0, 3: 2, 4: 0 };

function portraitId(avatarId: number): PortraitId {
  return (avatarId >= 1 && avatarId <= 4 ? avatarId : 1) as PortraitId;
}

/**
 * A stored colour's tint index. A colour outside AVATAR_TINTS (a bot, or an
 * account from before the palette) falls back to the portrait as drawn.
 */
export function tintIndex(avatarId: number, avatarColor: string): number {
  const i = AVATAR_TINTS.indexOf(avatarColor as AvatarTint);
  return i >= 0 ? i : NATIVE_TINT[portraitId(avatarId)];
}

export function portraitFor(avatarId: number, avatarColor: string): Asset {
  const id = portraitId(avatarId);
  return AVATAR_SCREEN_ART.portraits[id][tintIndex(id, avatarColor)] ?? null;
}
