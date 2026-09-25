/**
 * Warms expo-image's memory cache with the battle's art — every effect
 * strip, the fleet, the HUD and the flag badges — so the first explosion of a match plays
 * from memory instead of decoding mid-animation. Placement calls it on
 * mount (the battle is the next screen); the battle calls it again, which
 * costs nothing once the cache holds them. Never awaited: a miss only means
 * that image decodes when it is first drawn.
 */
import { Image } from 'expo-image';
import { Image as RNImage } from 'react-native';

import {
  BATTLE_ART,
  EMOTES,
  FLAG_ART,
  FLAG_BLANK,
  FLEET_ART,
  FX_ART,
  type Asset,
} from '@/ui/assets';

function battleArt(): Asset[] {
  const fx: Asset[] = [];
  for (const value of Object.values(FX_ART)) {
    if ('source' in value) fx.push(value.source);
    else for (const inner of Object.values(value)) fx.push(inner.source);
  }
  return [
    ...fx,
    ...Object.values(FLEET_ART.ships),
    ...Object.values(FLEET_ART.sunk),
    ...Object.values(FLEET_ART.wrecks),
    ...Object.values(FLEET_ART.icons),
    FLEET_ART.aaGun,
    FLEET_ART.mine,
    FLEET_ART.radar,
    BATTLE_ART.boardFrame,
    BATTLE_ART.portraitFrame,
    BATTLE_ART.infoFrame,
    BATTLE_ART.arsenalButton,
    BATTLE_ART.logo,
    BATTLE_ART.weaponModal,
    BATTLE_ART.weaponRow,
    BATTLE_ART.emoteMenu,
    BATTLE_ART.emoteTile,
    ...EMOTES.map((emote) => emote.source),
    ...Object.values(FLAG_ART),
    FLAG_BLANK,
  ];
}

let warmed = false;

export function prefetchBattleArt(): void {
  if (warmed) return;
  warmed = true;
  const uris = battleArt().flatMap((asset) =>
    typeof asset === 'number' ? [RNImage.resolveAssetSource(asset).uri] : [],
  );
  void Image.prefetch(uris, 'memory-disk').catch(() => {
    warmed = false;
    return false;
  });
}
