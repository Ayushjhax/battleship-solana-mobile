/**
 * The shield rank chip — docs/brief.md 3.5 — with an optional progress bar
 * reading "current/total" (IMG_9754: 10/100 Seaman Recruit).
 *
 * With `onAvatarPress` the avatar thumb is the way into the profile: it gets
 * a rough portrait frame so it reads as a button, and presses like the other
 * ink buttons. The menu uses this instead of a separate profile icon.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { haptic } from '@/audio/haptics';

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
  /** Makes the avatar a button (framed, haptic) — the menu's way into the profile. */
  onAvatarPress?: () => void;
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
const AVATAR = 40;
/** The portrait frame runs this far outside the 40-unit thumb. */
const FRAME_PAD = 3;

function AvatarButton({
  avatar,
  seed,
  onPress,
}: {
  avatar: NonNullable<RankBadgeProps['avatar']>;
  seed: number;
  onPress: () => void;
}) {
  const { roughRect } = useRough();
  const [pressed, setPressed] = useState(false);
  const size = AVATAR + FRAME_PAD * 2;
  // The same double stroke as the battle HUD's avatar card, at thumb size.
  const outer = roughRect(1, 1, size - 2, size - 2, {
    seed: seed + 4,
    strokeWidth: 1.4,
    roughness: 1.1,
    fill: color.paper,
    fillStyle: 'solid',
  });
  const inner = roughRect(3.5, 3.5, size - 7, size - 7, {
    seed: seed + 5,
    stroke: color.inkSoft,
    strokeWidth: 0.9,
    roughness: 1,
  });
  const onPressIn = useCallback(() => {
    setPressed(true);
    haptic('buttonPress');
  }, []);
  const onPressOut = useCallback(() => setPressed(false), []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open your profile"
      hitSlop={6}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateY: pressed ? 1 : 0 }],
      }}
    >
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={StyleSheet.absoluteFill}
      >
        <RoughShape paths={outer} />
        <RoughShape paths={inner} />
      </Svg>
      <AssetSlot
        source={avatar.source}
        w={AVATAR}
        h={AVATAR}
        label="avatar"
        tintColor={avatar.tint}
      />
    </Pressable>
  );
}

export function RankBadge({
  rank,
  name,
  avatar,
  onAvatarPress,
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
      {avatar && onAvatarPress ? (
        <AvatarButton avatar={avatar} seed={seed} onPress={onAvatarPress} />
      ) : avatar ? (
        <AssetSlot
          source={avatar.source}
          w={AVATAR}
          h={AVATAR}
          label="avatar"
          tintColor={avatar.tint}
        />
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
