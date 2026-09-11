/**
 * The shield rank chip — docs/brief.md 3.5 — with an optional progress bar
 * reading "current/total" (IMG_9754: 10/100 Seaman Recruit).
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { AssetSlot } from './AssetSlot';
import type { Asset } from './assets';
import { chevronPoints, shieldPoints } from './geometry';
import { color, font, space, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface RankBadgeProps {
  rank: string;
  /** Player name shown above the rank (menu, battle HUD). */
  name?: string;
  /** Avatar thumb to the left of the shield; tinted line art. */
  avatar?: { source?: Asset; tint: string };
  /** Points into the current rank band. Omit both to hide the bar. */
  current?: number;
  total?: number;
  seedKey?: string;
  style?: ViewStyle;
}

const SHIELD_W = 30;
const SHIELD_H = 36;
const BAR_W = 120;
const BAR_H = 9;

export function RankBadge({
  rank,
  name,
  avatar,
  current,
  total,
  seedKey = 'rank',
  style,
}: RankBadgeProps) {
  const { roughPolygon, roughRect } = useRough();
  const seed = hashString(`rank-${seedKey}`);

  const shield = roughPolygon(shieldPoints(SHIELD_W, SHIELD_H, 2), {
    seed,
    strokeWidth: 1.5,
    fill: color.inkFaint,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 1,
  });
  // A chevron across the shield, the way the reference shields carry stripes.
  const chevron = roughPolygon(chevronPoints(SHIELD_W), {
    seed: seed + 1,
    stroke: color.ink,
    strokeWidth: 1,
    fill: color.ink,
    fillStyle: 'solid',
  });

  const showBar = current !== undefined && total !== undefined && total > 0;
  const ratio = showBar ? Math.min(1, Math.max(0, current / total)) : 0;
  const barOutline = showBar
    ? roughRect(1, 1, BAR_W - 2, BAR_H - 2, { seed: seed + 2, strokeWidth: 1.2, roughness: 1 })
    : null;
  const barFill =
    showBar && ratio > 0
      ? roughRect(2, 2, Math.max(2, (BAR_W - 4) * ratio), BAR_H - 4, {
          seed: seed + 3,
          stroke: 'none',
          fill: color.inkGreen,
          fillStyle: 'solid',
        })
      : null;

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs }, style]}>
      {avatar ? (
        <AssetSlot source={avatar.source} w={40} h={40} label="avatar" tintColor={avatar.tint} />
      ) : null}
      <Svg width={SHIELD_W} height={SHIELD_H} viewBox={`0 0 ${SHIELD_W} ${SHIELD_H}`}>
        <RoughShape paths={shield} />
        <RoughShape paths={chevron} />
      </Svg>
      <View>
        {name ? (
          <Text
            numberOfLines={1}
            style={{ color: color.ink, fontFamily: font.display, fontSize: typeScale.sm }}
          >
            {name}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            color: name ? color.inkSoft : color.ink,
            fontFamily: font.label,
            fontSize: typeScale.xs,
          }}
        >
          {rank}
        </Text>
        {showBar ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}>
            <View style={{ width: BAR_W, height: BAR_H }}>
              <Svg
                width={BAR_W}
                height={BAR_H}
                viewBox={`0 0 ${BAR_W} ${BAR_H}`}
                style={StyleSheet.absoluteFill}
              >
                {barFill ? <RoughShape paths={barFill} /> : null}
                {barOutline ? <RoughShape paths={barOutline} /> : null}
              </Svg>
            </View>
            <Text style={{ color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs }}>
              {current}/{total}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
