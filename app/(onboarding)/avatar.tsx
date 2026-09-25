/**
 * Select your avatar — drawn to its mockup on BACKGROUNDS.chooseIcon: the logo,
 * the rope-crowned panel, and one card per captain with a portrait, the ten
 * colour swatches and a Choose button.
 *
 * A swatch recolours that captain's uniform. Every portrait exists in every
 * AVATAR_TINTS colour (AVATAR_SCREEN_ART.portraits, built ahead of time), so a
 * tap is a crossfade to a picture that is already there — never a render-time
 * filter. The profile stores the tint itself, exactly as before, so the battle
 * HUD and the match server see nothing new.
 *
 * Motion, all on the UI thread and all transform-only (no animated opacity on
 * anything pressable — see menu.tsx): the cards settle in one after another,
 * a portrait gives a small ink-press as its colour changes, the selection frame
 * springs onto the swatch, and the chosen card lifts before the screen moves on.
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { pushProfile } from '@/net/profileSync';
import { useProfile, type AvatarId } from '@/state/profile';
import { AVATAR_SCREEN_ART, BACKGROUNDS, BRAND } from '@/ui/assets';
import { NATIVE_TINT, tintIndex } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { AVATAR_TINTS, CANVAS_W, artColor, font, type AvatarTint } from '@/ui/tokens';

const IDS: readonly AvatarId[] = [1, 2, 3, 4];

const PANEL = { x: 96, y: 72, w: 608, h: 284 } as const;
const ROPE = { w: 372, h: 372 * (113 / 1120) } as const;
const CARD = { w: 132, h: 216, gap: 12, top: 123 } as const;
const PORTRAIT = { x: 10, y: 9, w: 112, h: 111 } as const;
/** The swatch art's paint is ~75% of its file; SWATCH is the paint, the file draws larger. */
const SWATCH = { size: 17, pitch: 22, top: 126, file: 17 / 0.75 } as const;
const CHOOSE = { w: 88, h: 30, top: 173 } as const;
const CHOOSE_DELAY_MS = 260;

// ---------------------------------------------------------------------------
// One swatch
// ---------------------------------------------------------------------------

const Swatch = memo(function Swatch({
  index,
  selected,
  onPress,
}: {
  index: number;
  selected: boolean;
  onPress: (index: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(1);
  useEffect(() => {
    ring.value = reduceMotion
      ? selected ? 1 : 0
      : withSpring(selected ? 1 : 0, { damping: 13, stiffness: 320, mass: 0.6 });
  }, [reduceMotion, ring, selected]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: [{ scale: 1.45 - 0.45 * ring.value }],
  }));
  const paintStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const pad = (SWATCH.file - SWATCH.size) / 2;
  return (
    <Pressable
      onPress={() => onPress(index)}
      onPressIn={() => {
        press.value = withTiming(0.86, { duration: 70 });
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 10, stiffness: 380 });
      }}
      hitSlop={2}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`Colour ${index + 1} of ${AVATAR_TINTS.length}`}
      style={{ width: SWATCH.size, height: SWATCH.size }}
    >
      <Animated.View style={[styles.swatchPaint, { left: -pad, top: -pad }, paintStyle]}>
        <Image source={AVATAR_SCREEN_ART.swatches[index]} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.swatchRing, ringStyle]}>
        <Image source={AVATAR_SCREEN_ART.selection} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// One captain
// ---------------------------------------------------------------------------

interface CardProps {
  id: AvatarId;
  order: number;
  initialTint: number;
  chosen: boolean;
  onChoose: (id: AvatarId, tint: number) => void;
}

const AvatarCard = memo(function AvatarCard({ id, order, initialTint, chosen, onChoose }: CardProps) {
  const reduceMotion = useReducedMotion();
  const [tint, setTint] = useState(initialTint);

  // Settle in: a short rise and a hair of scale, one card after another.
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    enter.value = withDelay(80 + order * 75, withSpring(1, { damping: 15, stiffness: 150, mass: 0.8 }));
  }, [enter, order, reduceMotion]);

  // The chosen card lifts; the rest stay put.
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = reduceMotion ? (chosen ? 1 : 0) : withSpring(chosen ? 1 : 0, { damping: 12, stiffness: 260 });
  }, [chosen, lift, reduceMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: (1 - enter.value) * 18 - lift.value * 4 },
      { scale: 0.95 + 0.05 * enter.value + 0.035 * lift.value },
    ],
  }));

  // A new colour lands like a stamp: the portrait dips, then springs back.
  const stamp = useSharedValue(1);
  const portraitStyle = useAnimatedStyle(() => ({ transform: [{ scale: stamp.value }] }));

  const pick = useCallback(
    (next: number) => {
      if (next === tint) return;
      haptic('buttonPress');
      playSfx('penScratchShort');
      setTint(next);
      if (!reduceMotion) {
        stamp.value = withSequence(
          withTiming(0.955, { duration: 80, easing: Easing.out(Easing.quad) }),
          withSpring(1, { damping: 9, stiffness: 300 }),
        );
      }
    },
    [reduceMotion, stamp, tint],
  );

  const [pressed, setPressed] = useState(false);
  const swatchLeft = (CARD.w - (SWATCH.pitch * 4 + SWATCH.size)) / 2;

  return (
    <Animated.View style={[{ width: CARD.w, height: CARD.h }, cardStyle]}>
      <VSlicedImage slices={AVATAR_SCREEN_ART.card} w={CARD.w} h={CARD.h} style={StyleSheet.absoluteFill} />

      <Animated.View style={[styles.portrait, portraitStyle]}>
        <Image
          source={AVATAR_SCREEN_ART.portraits[id][tint]}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={{ duration: 220, effect: 'cross-dissolve' }}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>

      <View
        style={[styles.swatches, { left: swatchLeft }]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Uniform colour"
      >
        {AVATAR_TINTS.map((_, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (i % 5) * SWATCH.pitch,
              top: Math.floor(i / 5) * SWATCH.pitch,
            }}
          >
            <Swatch index={i} selected={i === tint} onPress={pick} />
          </View>
        ))}
      </View>

      <Image source={AVATAR_SCREEN_ART.greenEmphasis} style={[styles.dash, styles.dashLeft]} contentFit="contain" />
      <Image source={AVATAR_SCREEN_ART.greenEmphasis} style={[styles.dash, styles.dashRight]} contentFit="contain" />
      <Pressable
        onPress={() => onChoose(id, tint)}
        onPressIn={() => {
          setPressed(true);
          haptic('buttonPress');
        }}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel="Choose"
        style={styles.choose}
      >
        <Image
          source={AVATAR_SCREEN_ART.chooseButton}
          style={[StyleSheet.absoluteFill, { transform: [{ translateY: pressed ? 1 : 0 }] }]}
          contentFit="contain"
        />
      </Pressable>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** Where a captain's card starts: the saved colour for the saved captain, else as drawn. */
function initialTintFor(id: AvatarId, savedId: AvatarId, savedTint: string): number {
  return id === savedId ? tintIndex(id, savedTint) : NATIVE_TINT[id];
}

export default function AvatarScreen() {
  const router = useRouter();
  const name = useProfile((state) => state.name);
  const savedId = useProfile((state) => state.avatarId);
  const savedTint = useProfile((state) => state.avatarColor);
  const [chosen, setChosen] = useState<AvatarId | null>(null);
  const leaving = useRef(false);

  // Warm every variant, so the first tap on a swatch is as instant as the rest.
  useEffect(() => {
    const uris = IDS.flatMap((id) =>
      AVATAR_SCREEN_ART.portraits[id].flatMap((asset) =>
        typeof asset === 'number' ? [RNImage.resolveAssetSource(asset).uri] : [],
      ),
    );
    void Image.prefetch(uris, 'memory-disk').catch(() => false);
  }, []);

  const choose = useCallback(
    (avatarId: AvatarId, tintIndex: number) => {
      if (leaving.current) return;
      leaving.current = true;
      const avatarColor = AVATAR_TINTS[tintIndex] as AvatarTint;
      haptic('shipPlaced');
      playSfx('shipPlace');
      setChosen(avatarId);
      const profile = useProfile.getState();
      profile.setIdentity({ avatarId, avatarColor });
      if (profile.userId) void pushProfile(profile.userId, { avatarId, avatarColor });
      setTimeout(() => router.replace('/menu'), CHOOSE_DELAY_MS);
    },
    [router],
  );

  const cardsLeft = (CANVAS_W - (CARD.w * IDS.length + CARD.gap * (IDS.length - 1))) / 2;

  return (
    <Scale backgroundImage={BACKGROUNDS.chooseIcon}>
      <Image source={BRAND.wordmark} style={styles.logo} contentFit="contain" pointerEvents="none" />

      <VSlicedImage
        slices={AVATAR_SCREEN_ART.panel}
        w={PANEL.w}
        h={PANEL.h}
        style={{ position: 'absolute', left: PANEL.x, top: PANEL.y }}
      />
      <Image source={AVATAR_SCREEN_ART.ropeDivider} style={styles.rope} contentFit="contain" pointerEvents="none" />

      <View style={styles.titleRow} accessibilityRole="header">
        <Image source={AVATAR_SCREEN_ART.emphasisLeft} style={styles.titleMark} contentFit="contain" />
        <Image
          source={AVATAR_SCREEN_ART.title}
          style={styles.titleLabel}
          contentFit="contain"
          accessibilityLabel="Select your avatar,"
        />
        <Text style={styles.titleName} numberOfLines={1}>
          {name.trim() || 'Captain'}
        </Text>
        <Image source={AVATAR_SCREEN_ART.emphasisRight} style={styles.titleMark} contentFit="contain" />
      </View>

      <View style={[styles.cards, { left: cardsLeft }]}>
        {IDS.map((id, order) => (
          <AvatarCard
            key={id}
            id={id}
            order={order}
            initialTint={initialTintFor(id, savedId, savedTint)}
            chosen={chosen === id}
            onChoose={choose}
          />
        ))}
      </View>
    </Scale>
  );
}

const TITLE_H = 22;

const styles = StyleSheet.create({
  logo: { position: 'absolute', left: (CANVAS_W - 136) / 2, top: -2, width: 136, height: 54 },
  rope: {
    position: 'absolute',
    left: (CANVAS_W - ROPE.w) / 2,
    top: PANEL.y - ROPE.h / 2 + 2,
    width: ROPE.w,
    height: ROPE.h,
  },
  titleRow: {
    position: 'absolute',
    left: PANEL.x,
    width: PANEL.w,
    top: PANEL.y + 25,
    height: TITLE_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleMark: { width: 14, height: TITLE_H - 2, marginHorizontal: 6 },
  titleLabel: { width: TITLE_H * (605 / 93), height: TITLE_H },
  titleName: {
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 19,
    lineHeight: TITLE_H + 2,
    marginLeft: 5,
    maxWidth: 190,
  },
  cards: { position: 'absolute', top: CARD.top, flexDirection: 'row', gap: CARD.gap },
  portrait: {
    position: 'absolute',
    left: PORTRAIT.x,
    top: PORTRAIT.y,
    width: PORTRAIT.w,
    height: PORTRAIT.h,
  },
  swatches: {
    position: 'absolute',
    top: SWATCH.top,
    width: SWATCH.pitch * 4 + SWATCH.size,
    height: SWATCH.pitch + SWATCH.size,
  },
  swatchPaint: { position: 'absolute', width: SWATCH.file, height: SWATCH.file },
  swatchRing: {
    position: 'absolute',
    left: -4,
    top: -4,
    width: SWATCH.size + 8,
    height: SWATCH.size + 8,
  },
  choose: {
    position: 'absolute',
    left: (CARD.w - CHOOSE.w) / 2,
    top: CHOOSE.top,
    width: CHOOSE.w,
    height: CHOOSE.h,
  },
  dash: { position: 'absolute', top: CHOOSE.top + 6, width: 10, height: 17 },
  dashLeft: { left: (CARD.w - CHOOSE.w) / 2 - 12, transform: [{ scaleX: -1 }] },
  dashRight: { left: (CARD.w + CHOOSE.w) / 2 + 2 },
});
