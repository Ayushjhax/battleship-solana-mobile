/**
 * The Port City's HUD, drawn in canvas units inside <Scale> and fixed while the
 * map moves beneath it:
 *
 *   top-left      home — back to the menu, at any moment
 *   top-centre    the PORT CITY ribbon, "HARBOUR PREVIEW" pinned under it
 *   top-right     coins and gems, the player's real balances
 *   bottom-centre the exploring hint, or the selected building's card
 *   bottom-right  the compass — eases the map back to the opening frame
 *
 * The art is the supplied pieces (assets/city/ui); every word that can change
 * — balances, a building's name and description, its status — is live text.
 *
 * The map is full-bleed, so the HUD hugs the window's SAFE edges rather than
 * the letterboxed canvas: on a 16:9 phone or a 4:3 tablet the canvas sits
 * inset from the window and a canvas-anchored HUD would float over the middle
 * of the map. `useEdgeReach` is how far the safe area runs past the canvas on
 * each axis (canvas units); edge-anchored pieces move out by that much. The
 * canvas does not clip, and RN hit-tests children past an overflow-visible
 * parent, so they stay tappable.
 */
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/audio/haptics';
import { CITY_ART } from '@/ui/assets';
import { useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, cityColor, color, font, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

import type { Building } from './cityLayout';

const EDGE = 12;
export const HUD = {
  home: { x: EDGE, y: 10, size: 44 },
  title: { w: 206, h: (206 * 167) / 774, y: 3 },
  status: { w: 128, h: 20 },
  counter: { w: 88, h: (88 * 98) / 291, gap: 6, y: 10 },
  compass: { w: 50, h: (50 * 154) / 159 },
  hint: { w: 236, h: (236 * 96) / 621, bottom: 8 },
  card: { w: 318, h: 84, bottom: 8 },
} as const;

/** Card transitions: in 220 ms, out 180 ms — a new pick crossfades over the last. */
const CARD_IN_MS = 220;
const CARD_OUT_MS = 180;

/** How far the window's safe area reaches past the canvas, per axis, in canvas units. */
function useEdgeReach(): { x: number; y: number } {
  const { scale, ox, oy } = useScale();
  const insets = useSafeAreaInsets();
  return {
    x: Math.max(0, (ox - insets.left) / scale),
    y: Math.max(0, (oy - insets.top) / scale),
  };
}

export interface CityHudProps {
  coins: number;
  gems: number;
  selected: Building | null;
  /** 0..1, the entrance. */
  enter: SharedValue<number>;
  reduceMotion: boolean;
  onHome: () => void;
  onCompass: () => void;
  onCloseCard: () => void;
}

export function CityHud({
  coins,
  gems,
  selected,
  enter,
  reduceMotion,
  onHome,
  onCompass,
  onCloseCard,
}: CityHudProps) {
  const top = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: reduceMotion ? 0 : -10 * (1 - enter.value) }],
  }));
  const bottom = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: reduceMotion ? 0 : 10 * (1 - enter.value) }],
  }));
  const reach = useEdgeReach();

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <Animated.View style={[styles.fill, { top: -reach.y }, top]} pointerEvents="box-none">
        <HomeButton onPress={onHome} left={HUD.home.x - reach.x} />
        <View style={styles.title} pointerEvents="none" accessibilityRole="header">
          <Image
            source={CITY_ART.title}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel="Port City"
          />
        </View>
        <StatusPlaque />
        <View style={[styles.counters, { right: EDGE - reach.x }]} pointerEvents="none">
          <Counter icon={CITY_ART.coin} value={coins} label="coins" />
          <Counter icon={CITY_ART.gem} value={gems} label="gems" />
        </View>
      </Animated.View>

      <Animated.View style={[styles.fill, { top: reach.y }, bottom]} pointerEvents="box-none">
        <Pressable
          style={[styles.compass, { right: EDGE - reach.x }]}
          onPress={() => {
            haptic('buttonPress');
            onCompass();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Compass"
          accessibilityHint="Centres the map on the harbour"
        >
          <Image source={CITY_ART.compass} style={StyleSheet.absoluteFill} contentFit="contain" />
        </Pressable>
        {selected ? (
          <InfoCard
            key={selected.id}
            building={selected}
            reduceMotion={reduceMotion}
            onClose={onCloseCard}
          />
        ) : (
          <Animated.View
            key="hint"
            style={styles.hint}
            entering={reduceMotion ? undefined : FadeIn.duration(CARD_IN_MS)}
            exiting={reduceMotion ? undefined : FadeOut.duration(CARD_OUT_MS)}
            pointerEvents="none"
          >
            <Image
              source={CITY_ART.hint}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              accessibilityLabel="Drag to explore. Tap a landmark."
            />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

/** The red house on a pen-drawn paper tile, as in the reference. */
function HomeButton({ onPress, left }: { onPress: () => void; left: number }) {
  const { roughRect } = useRough();
  const { size } = HUD.home;
  const seed = hashString('city-home');
  const outer = roughRect(2, 2, size - 4, size - 4, {
    seed,
    stroke: cityColor.ink,
    strokeWidth: 1.6,
    fill: cityColor.paper,
    fillStyle: 'solid',
    roughness: 0.9,
  });
  const inner = roughRect(5, 5, size - 10, size - 10, {
    seed: seed + 1,
    stroke: cityColor.ink,
    strokeWidth: 0.8,
    roughness: 0.8,
  });
  return (
    <Pressable
      onPress={() => {
        haptic('buttonPress');
        onPress();
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Return home"
      style={({ pressed }) => [
        styles.home,
        { left },
        { transform: [{ scale: pressed ? 0.94 : 1 }, { translateY: pressed ? 1 : 0 }] },
      ]}
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
      <Image source={CITY_ART.home} style={styles.homeIcon} contentFit="contain" />
    </Pressable>
  );
}

/** "HARBOUR PREVIEW", on a double-ruled paper tag tucked under the title. */
function StatusPlaque() {
  const { roughRect } = useRough();
  const { w, h } = HUD.status;
  const seed = hashString('city-status');
  const outer = roughRect(1, 1, w - 2, h - 2, {
    seed,
    stroke: cityColor.ink,
    strokeWidth: 1.3,
    fill: cityColor.paper,
    fillStyle: 'solid',
    roughness: 0.7,
  });
  const inner = roughRect(3.5, 3.5, w - 7, h - 7, {
    seed: seed + 1,
    stroke: cityColor.ink,
    strokeWidth: 0.6,
    roughness: 0.6,
  });
  return (
    <View style={styles.status} pointerEvents="none">
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={outer} />
        <RoughShape paths={inner} />
      </Svg>
      <Text style={styles.statusText} numberOfLines={1}>
        HARBOUR PREVIEW
      </Text>
    </View>
  );
}

const Counter = memo(function Counter({
  icon,
  value,
  label,
}: {
  icon: (typeof CITY_ART)['coin'];
  value: number;
  label: string;
}) {
  const { w, h } = HUD.counter;
  return (
    <View
      style={{ width: w, height: h }}
      accessible
      accessibilityLabel={`${value.toLocaleString()} ${label}`}
    >
      <Image source={CITY_ART.counterFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
      <Image source={icon} style={styles.counterIcon} contentFit="contain" />
      <Text style={styles.counterValue} numberOfLines={1} adjustsFontSizeToFit>
        {value.toLocaleString()}
      </Text>
    </View>
  );
});

/**
 * The selected building: the red location flag, its name, one line about it
 * and that it is coming soon — on a double-ruled paper card drawn with the pen
 * (the same hand as the HARBOUR PREVIEW tag), with an offset stroke for depth.
 * Tap it (or the open map) to put it away.
 */
function InfoCard({
  building,
  reduceMotion,
  onClose,
}: {
  building: Building;
  reduceMotion: boolean;
  onClose: () => void;
}) {
  const { roughRect } = useRough();
  const { w, h } = HUD.card;
  const seed = hashString('city-card');
  const shadow = roughRect(5, 5, w - 7, h - 7, {
    seed: seed + 2,
    stroke: cityColor.ink,
    strokeWidth: 1.2,
    roughness: 0.8,
  });
  const outer = roughRect(1.5, 1.5, w - 7, h - 7, {
    seed,
    stroke: cityColor.ink,
    strokeWidth: 1.7,
    fill: cityColor.paper,
    fillStyle: 'solid',
    roughness: 0.8,
  });
  const inner = roughRect(5, 5, w - 14, h - 14, {
    seed: seed + 1,
    stroke: cityColor.ink,
    strokeWidth: 0.6,
    roughness: 0.7,
  });
  return (
    <Animated.View
      style={styles.card}
      entering={reduceMotion ? undefined : FadeInDown.duration(CARD_IN_MS)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(CARD_OUT_MS)}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`${building.name}. ${building.description} Coming soon.`}
        accessibilityHint="Closes the card"
        accessibilityLiveRegion="polite"
      >
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
          <RoughShape paths={shadow} opacity={0.35} />
          <RoughShape paths={outer} />
          <RoughShape paths={inner} />
        </Svg>
        <View style={styles.cardBody}>
          <View style={styles.cardHead}>
            <Image source={CITY_ART.flag} style={styles.cardFlag} contentFit="contain" />
            <Text style={styles.cardName} numberOfLines={1}>
              {building.name}
            </Text>
            <View style={styles.soon}>
              <Image source={CITY_ART.padlock} style={styles.padlock} contentFit="contain" />
              <Text style={styles.soonText}>Coming soon</Text>
            </View>
          </View>
          <Text style={styles.cardText} numberOfLines={2}>
            {building.description}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
  home: {
    position: 'absolute',
    left: HUD.home.x,
    top: HUD.home.y,
    width: HUD.home.size,
    height: HUD.home.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeIcon: { width: 28, height: (28 * 121) / 116 },
  title: {
    position: 'absolute',
    left: (CANVAS_W - HUD.title.w) / 2,
    top: HUD.title.y,
    width: HUD.title.w,
    height: HUD.title.h,
  },
  status: {
    position: 'absolute',
    left: (CANVAS_W - HUD.status.w) / 2,
    top: HUD.title.y + HUD.title.h - 3,
    width: HUD.status.w,
    height: HUD.status.h,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    color: cityColor.ink,
    fontFamily: font.label,
    fontSize: typeScale.xxs - 1,
    letterSpacing: 1.2,
    includeFontPadding: false,
  },
  counters: {
    position: 'absolute',
    right: EDGE,
    top: HUD.counter.y,
    flexDirection: 'row',
    gap: HUD.counter.gap,
  },
  counterIcon: {
    position: 'absolute',
    left: 10,
    top: (HUD.counter.h - 18) / 2,
    width: 18,
    height: 18,
  },
  counterValue: {
    position: 'absolute',
    left: 30,
    right: 11,
    top: 0,
    bottom: 0,
    textAlign: 'right',
    textAlignVertical: 'center',
    lineHeight: HUD.counter.h,
    color: cityColor.ink,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    includeFontPadding: false,
  },
  compass: {
    position: 'absolute',
    right: EDGE,
    bottom: 8,
    width: HUD.compass.w,
    height: HUD.compass.h,
  },
  hint: {
    position: 'absolute',
    left: (CANVAS_W - HUD.hint.w) / 2,
    bottom: HUD.hint.bottom,
    width: HUD.hint.w,
    height: HUD.hint.h,
  },
  card: {
    position: 'absolute',
    left: (CANVAS_W - HUD.card.w) / 2,
    bottom: HUD.card.bottom,
    width: HUD.card.w,
    height: HUD.card.h,
  },
  // Inside the inner rule (5 units in) with room to breathe; the shadow takes the last 5.
  cardBody: {
    position: 'absolute',
    left: 16,
    right: 18,
    top: 8,
    bottom: 12,
    justifyContent: 'center',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  cardFlag: { width: 13, height: (13 * 138) / 122, marginRight: 5 },
  cardName: {
    flex: 1,
    color: cityColor.ink,
    fontFamily: font.display,
    fontSize: typeScale.sm + 1,
    lineHeight: 22,
    includeFontPadding: false,
  },
  soon: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  padlock: { width: 10, height: (10 * 124) / 96 },
  soonText: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    includeFontPadding: false,
  },
  cardText: {
    marginTop: 3,
    color: cityColor.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 17,
    includeFontPadding: false,
  },
});
