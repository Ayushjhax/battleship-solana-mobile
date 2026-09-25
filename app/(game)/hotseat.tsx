/**
 * Two local captains, one device — drawn to its mockup on
 * BACKGROUNDS.chooseIcon: the rope-framed parchment with both names, and the
 * commissioned keyboard below. Tap a field to type into it; enter moves from
 * captain 1 to captain 2, then places the fleets. Names live only in the
 * placement session.
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ImageStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { usePlacement } from '@/state/placement';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtKeyboard, ART_KEYBOARD_H, ART_KEYBOARD_W } from '@/ui/ArtKeyboard';
import { BACKGROUNDS, MATCHMAKING_ART, NAME_ART, type Asset } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { SlicedImage } from '@/ui/SlicedImage';
import { CANVAS_H, CANVAS_W, artColor, font, menuFont } from '@/ui/tokens';

const MAX_LEN = 14;
/** rope-panel.webp is 1225 x 443; its top rope opens where the banner sits. */
const PANEL = { w: 500, h: 500 * (443 / 1225), y: -2 } as const;
const PANEL_X = (CANVAS_W - PANEL.w) / 2;
const FIELD = { w: 212, h: 32, y: 94, gap: 36 } as const;
const FIELDS_X = (CANVAS_W - FIELD.w * 2 - FIELD.gap) / 2;
const KEYBOARD_Y = CANVAS_H - ART_KEYBOARD_H - 4;

function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

function Caret() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 420 }), withTiming(1, { duration: 420 })),
      -1,
      true,
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.caret, style]} pointerEvents="none">
      <Image source={NAME_ART.cursor} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  );
}

function NameField({
  label,
  value,
  active,
  x,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  x: number;
  onPress: () => void;
}) {
  return (
    <View style={[styles.fieldGroup, { left: x }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'empty'}. Tap to edit.`}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        hitSlop={4}
        style={{ width: FIELD.w, height: FIELD.h }}
      >
        <SlicedImage
          slices={active ? MATCHMAKING_ART.inputActive : MATCHMAKING_ART.inputDefault}
          w={FIELD.w}
          h={FIELD.h}
          style={StyleSheet.absoluteFill}
        />
        <Image
          source={active ? MATCHMAKING_ART.anchorGreen : MATCHMAKING_ART.anchorBlue}
          style={styles.anchor}
          contentFit="contain"
        />
        <View pointerEvents="none" style={styles.fieldValueWrap}>
          <Text numberOfLines={1} style={styles.fieldValue}>
            {value}
          </Text>
          {active ? <Caret /> : null}
        </View>
      </Pressable>
    </View>
  );
}

export default function HotseatNamesScreen() {
  const router = useRouter();
  const stored = usePlacement.getState();
  const [one, setOne] = useState(stored.playerOneName || 'Player 1');
  const [two, setTwo] = useState(stored.playerTwoName || 'Player 2');
  const [active, setActive] = useState<1 | 2>(1);
  const valid = one.trim().length > 0 && two.trim().length > 0;

  const continueToPlacement = useCallback(() => {
    if (!valid) return;
    usePlacement.getState().setHotseatNames(one, two);
    router.push('/placement?mode=hotseat');
  }, [one, router, two, valid]);

  const submitKey = useCallback(() => {
    if (active === 1) setActive(2);
    else continueToPlacement();
  }, [active, continueToPlacement]);

  return (
    <Scale backgroundImage={BACKGROUNDS.chooseIcon}>
      <Art source={MATCHMAKING_ART.twoCaptainsQuote} style={styles.quoteRight} />
      <Art source={MATCHMAKING_ART.compass} style={styles.compass} />

      <ArtImageButton
        source={MATCHMAKING_ART.back}
        w={58}
        h={37}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />

      <Image
        source={MATCHMAKING_ART.ropePanel}
        style={styles.panel}
        contentFit="fill"
        cachePolicy="memory-disk"
        pointerEvents="none"
      />
      <Art source={MATCHMAKING_ART.banner} style={styles.banner} />
      <Image
        source={MATCHMAKING_ART.title}
        style={styles.title}
        contentFit="contain"
        accessibilityRole="header"
        accessibilityLabel="Name both captains"
      />

      <NameField label="Player 1" value={one} active={active === 1} x={FIELDS_X} onPress={() => setActive(1)} />
      <NameField
        label="Player 2"
        value={two}
        active={active === 2}
        x={FIELDS_X + FIELD.w + FIELD.gap}
        onPress={() => setActive(2)}
      />

      <Art source={MATCHMAKING_ART.greenDashLeft} style={styles.dashLeft} />
      <ArtImageButton
        source={MATCHMAKING_ART.placeFleets}
        w={132}
        h={132 * (109 / 394)}
        label="Place fleets"
        disabled={!valid}
        style={styles.placeFleets}
        onPress={continueToPlacement}
      />
      <Art source={MATCHMAKING_ART.greenDashRight} style={styles.dashRight} />
      <Art source={MATCHMAKING_ART.differentCaptainsSmall} style={styles.quoteInPanel} />

      <View style={styles.keyboard}>
        <ArtKeyboard
          value={active === 1 ? one : two}
          onChange={active === 1 ? setOne : setTwo}
          onSubmit={submitKey}
          maxLength={MAX_LEN}
        />
      </View>
    </Scale>
  );
}

const PLACE_Y = 131;

const styles = StyleSheet.create({
  // Below the background's own note in the top-left corner.
  back: { position: 'absolute', left: 12, top: 62 },
  quoteRight: { left: 712, top: 112, width: 64, height: 69 },
  compass: { left: 716, top: 56, width: 50, height: 52 },
  panel: { position: 'absolute', left: PANEL_X, top: PANEL.y, width: PANEL.w, height: PANEL.h },
  banner: { left: (CANVAS_W - 228) / 2, top: -3, width: 228, height: 228 * (135 / 593) },
  title: { position: 'absolute', left: (CANVAS_W - 250) / 2, top: 50, width: 250, height: 250 * (70 / 690) },
  fieldGroup: { position: 'absolute', top: FIELD.y - 17, width: FIELD.w },
  fieldLabel: {
    color: artColor.ink,
    fontFamily: menuFont.hand,
    fontSize: 15,
    lineHeight: 17,
    marginLeft: 4,
  },
  anchor: { position: 'absolute', left: 12, top: (FIELD.h - 17) / 2 - 1, width: 13, height: 17 },
  fieldValueWrap: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 30,
    paddingRight: 12,
    paddingBottom: 1,
  },
  fieldValue: { color: artColor.ink, fontFamily: font.display, fontSize: 18, maxWidth: FIELD.w - 60 },
  caret: { width: 6, height: 20, marginLeft: 2 },
  dashLeft: { left: (CANVAS_W - 132) / 2 - 16, top: PLACE_Y + 6, width: 12, height: 22 },
  dashRight: { left: (CANVAS_W + 132) / 2 + 4, top: PLACE_Y + 6, width: 12, height: 22 },
  placeFleets: { position: 'absolute', left: (CANVAS_W - 132) / 2, top: PLACE_Y },
  quoteInPanel: { left: PANEL_X + PANEL.w - 128, top: 128, width: 82, height: 40 },
  keyboard: { position: 'absolute', left: (CANVAS_W - ART_KEYBOARD_W) / 2, top: KEYBOARD_Y },
});
