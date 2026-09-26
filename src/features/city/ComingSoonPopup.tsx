/**
 * The Coming Soon popup, built from the supplied art so that exactly one
 * button and one countdown are ever on screen:
 *
 * - the panel is ui/coming_soon_popup.png with its baked Return Home ribbon and
 *   its sample "Returning home in 5s" painted out (scripts/city-assets.py) —
 *   the title, the harbour drawing and the three lines stay as drawn;
 * - the button is popup_parts/return_home_button.png, an exact crop of the
 *   ribbon it replaces, put back on the same spot as a real Pressable;
 * - the countdown is live text on the sample line's spot, counting down from
 *   the moment the popup has finished arriving (PortCityVisit owns the clock).
 *
 * The violet wash covers the whole window (the map runs past the canvas), and
 * swallows every touch: the city underneath is not interactive while this is up.
 */
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { CITY_ART } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, cityColor, font, type as typeScale } from '@/ui/tokens';

import { POPUP_ART } from './cityLayout';
import type { PopupStage } from './visit';

const PANEL_H = 318;
const K = PANEL_H / POPUP_ART.h;
const PANEL_W = POPUP_ART.w * K;
const BUTTON = {
  x: POPUP_ART.button.x * K,
  y: POPUP_ART.button.y * K,
  w: POPUP_ART.button.w * K,
  h: POPUP_ART.button.h * K,
};
const LINE = {
  x: POPUP_ART.countdown.x * K,
  y: POPUP_ART.countdown.y * K,
  w: POPUP_ART.countdown.w * K,
  h: POPUP_ART.countdown.h * K,
};

export const POPUP_COPY = [
  'Coming soon.',
  'Your harbour is taking shape.',
  'Build your city. Defend your waters.',
  'A new chapter is on the horizon.',
].join(' ');

export function ComingSoonPopup({
  stage,
  countdown,
  enterMs,
  reduceMotion,
  onReturnHome,
}: {
  stage: PopupStage;
  /** Whole seconds left; null until the entrance has finished. */
  countdown: number | null;
  enterMs: number;
  reduceMotion: boolean;
  onReturnHome: () => void;
}) {
  const t = useSharedValue(0);
  const button = useRef<View>(null);

  useEffect(() => {
    t.value = withTiming(1, { duration: enterMs, easing: Easing.out(Easing.cubic) });
  }, [enterMs, t]);

  // A screen reader lands on the one thing to do.
  useEffect(() => {
    if (stage !== 'open' || !button.current) return;
    // Not every platform implements it (react-native-web doesn't); never let
    // a focus hint take the popup down.
    if (typeof AccessibilityInfo.sendAccessibilityEvent !== 'function') return;
    try {
      AccessibilityInfo.sendAccessibilityEvent(button.current, 'focus');
    } catch {
      /* focus is a courtesy */
    }
  }, [stage]);

  const wash = useAnimatedStyle(() => ({ opacity: t.value }));
  const panel = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: reduceMotion
      ? []
      : [{ translateY: 16 * (1 - t.value) }, { scale: 0.96 + 0.04 * t.value }],
  }));

  const line =
    countdown === null
      ? ' '
      : countdown > 0
        ? `Returning home in ${countdown}s`
        : 'Returning home…';

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.wash, wash]}
        // Swallows touches: the city below is not interactive under the popup.
        onStartShouldSetResponder={() => true}
        accessible={false}
      />
      <Scale transparent>
        <Animated.View style={[styles.panel, panel]}>
          <Image
            source={CITY_ART.popupPanel}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessible
            accessibilityLabel={POPUP_COPY}
          />
          <Pressable
            ref={button}
            onPress={() => {
              haptic('buttonPress');
              onReturnHome();
            }}
            hitSlop={{ top: 6, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Return home"
            style={({ pressed }) => [
              styles.button,
              { transform: [{ scale: pressed ? 0.965 : 1 }, { translateY: pressed ? 1 : 0 }] },
            ]}
          >
            <Image
              source={CITY_ART.returnHome}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
            />
          </Pressable>
          <Text
            style={styles.countdown}
            numberOfLines={1}
            accessibilityLiveRegion="polite"
            accessibilityLabel={countdown === null ? undefined : line}
          >
            {line}
          </Text>
        </Animated.View>
      </Scale>
    </View>
  );
}

const styles = StyleSheet.create({
  wash: { backgroundColor: cityColor.dim },
  panel: {
    position: 'absolute',
    left: (CANVAS_W - PANEL_W) / 2,
    top: (CANVAS_H - PANEL_H) / 2,
    width: PANEL_W,
    height: PANEL_H,
  },
  button: {
    position: 'absolute',
    left: BUTTON.x,
    top: BUTTON.y,
    width: BUTTON.w,
    height: BUTTON.h,
  },
  countdown: {
    position: 'absolute',
    left: LINE.x - 20,
    width: LINE.w + 40,
    top: LINE.y,
    height: LINE.h,
    lineHeight: LINE.h,
    textAlign: 'center',
    color: cityColor.ink,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    includeFontPadding: false,
  },
});
