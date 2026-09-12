/**
 * Select your avatar — IMG_9756. Four cards in one large InkPanel: a framed
 * portrait, a 5 x 2 grid of colour swatches and a Choose button each.
 *
 * ONE image per avatar, not ten: the portraits are black line art and the
 * swatch recolours them with <Image tintColor>. The same source stays
 * mounted, so a recolour is a tint change with no reload and no flicker.
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import { pushProfile } from '@/net/profileSync';
import { useProfile, type AvatarId } from '@/state/profile';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, type Asset } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import {
  AVATAR_TINTS,
  CANVAS_W,
  color,
  font,
  space,
  type as typeScale,
  type AvatarTint,
} from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

const IDS: AvatarId[] = [1, 2, 3, 4];
const CARD = { w: 156, h: 262 } as const;
const PORTRAIT = { w: 112, h: 130 } as const;
const SWATCH = 20;
const SWATCH_GAP = 4;

function Swatch({
  tint,
  selected,
  seed,
  onPress,
}: {
  tint: AvatarTint;
  selected: boolean;
  seed: number;
  onPress: () => void;
}) {
  const { roughRect } = useRough();
  const fill = roughRect(2, 2, SWATCH - 4, SWATCH - 4, {
    seed,
    stroke: tint,
    strokeWidth: 1,
    fill: tint,
    fillStyle: 'hachure',
    hachureGap: 2.2,
    fillWeight: 1.2,
  });
  const ring = selected
    ? roughRect(1, 1, SWATCH - 2, SWATCH - 2, {
        seed: seed + 1,
        stroke: color.inkRed,
        strokeWidth: 2,
        roughness: 0.8,
      })
    : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`colour ${tint}`}
      style={{ width: SWATCH, height: SWATCH }}
    >
      <Svg width={SWATCH} height={SWATCH} viewBox={`0 0 ${SWATCH} ${SWATCH}`}>
        <RoughShape paths={fill} />
        {ring ? <RoughShape paths={ring} /> : null}
      </Svg>
    </Pressable>
  );
}

function AvatarCard({
  id,
  onChoose,
}: {
  id: AvatarId;
  onChoose: (id: AvatarId, tint: AvatarTint) => void;
}) {
  const { roughRect } = useRough();
  const [tint, setTint] = useState<AvatarTint>(
    AVATAR_TINTS[(id - 1) % AVATAR_TINTS.length] as AvatarTint,
  );
  const seed = hashString(`avatar-card-${id}`);
  const frame = roughRect(2, 2, PORTRAIT.w - 4, PORTRAIT.h - 4, {
    seed,
    strokeWidth: 2,
    roughness: 2,
    bowing: 0.5,
  });
  const source: Asset = AVATARS[id];

  return (
    <InkPanel w={CARD.w} h={CARD.h} seedKey={`avatar-${id}`} padding={space.xs}>
      <View style={styles.cardInner}>
        <View style={{ width: PORTRAIT.w, height: PORTRAIT.h }}>
          <Svg
            width={PORTRAIT.w}
            height={PORTRAIT.h}
            viewBox={`0 0 ${PORTRAIT.w} ${PORTRAIT.h}`}
            style={StyleSheet.absoluteFill}
          >
            <RoughShape paths={frame} />
          </Svg>
          <View style={{ position: 'absolute', left: 6, top: 6 }}>
            <AssetSlot
              source={source}
              w={PORTRAIT.w - 12}
              h={PORTRAIT.h - 12}
              label={`avatar-${id}`}
              tintColor={tint}
            />
          </View>
        </View>
        <View style={styles.swatches}>
          {AVATAR_TINTS.map((t, i) => (
            <Swatch
              key={t}
              tint={t}
              selected={t === tint}
              seed={seed + 10 + i}
              onPress={() => setTint(t)}
            />
          ))}
        </View>
        <InkButton
          label="Choose"
          tone="confirm"
          w={120}
          h={32}
          size="sm"
          seedKey={`choose-${id}`}
          onPress={() => onChoose(id, tint)}
        />
      </View>
    </InkPanel>
  );
}

export default function AvatarScreen() {
  const router = useRouter();
  const choose = useCallback(
    (avatarId: AvatarId, avatarColor: AvatarTint) => {
      const profile = useProfile.getState();
      profile.setIdentity({ avatarId, avatarColor });
      if (profile.userId) void pushProfile(profile.userId, { avatarId, avatarColor });
      router.replace('/menu');
    },
    [router],
  );

  const rowW = CARD.w * 4 + 12 * 3;
  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.outer}>
        <InkPanel w={CANVAS_W - 48} h={330} seedKey="avatar-outer" padding={space.sm}>
          <Text style={styles.title}>Select your avatar:</Text>
          <View style={[styles.row, { width: rowW, alignSelf: 'center' }]}>
            {IDS.map((id) => (
              <AvatarCard key={id} id={id} onChoose={choose} />
            ))}
          </View>
        </InkPanel>
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'absolute', left: 24, top: 14 },
  title: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
    marginBottom: 6,
  },
  row: { flexDirection: 'row', gap: 12 },
  cardInner: { alignItems: 'center', gap: 8 },
  swatches: {
    width: SWATCH * 5 + SWATCH_GAP * 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SWATCH_GAP,
  },
});
