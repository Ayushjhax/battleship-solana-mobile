/**
 * An arsenal item's own card art (FLEET_ART.icons), contain-fit in a box —
 * the shop cards, the battle's weapon list, the targeting guide.
 */
import type { ArsenalKind } from '@engine/types';
import { Image } from 'expo-image';
import type { ImageStyle } from 'react-native';

import { FLEET_ART } from '@/ui/assets';

export function ArsenalIcon({
  kind,
  w,
  h,
  style,
}: {
  kind: ArsenalKind;
  w: number;
  h: number;
  style?: ImageStyle;
}) {
  return (
    <Image
      source={FLEET_ART.icons[kind]}
      style={[{ width: w, height: h }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}
