/**
 * The first 1.8 seconds — docs/brief.md 5.5. The only non-interactive motion
 * in the game, so every value below is driven on the UI thread by Reanimated
 * and nothing re-renders while it plays.
 *
 * The page itself is the illustrated backdrop app/index.tsx hands <Scale>
 * (BACKGROUNDS.splash, crossfading to BACKGROUNDS.logoReveal as the logo
 * lands), so this draws only what moves over it:
 *
 *   t=0     the first page, nothing else
 *   t=800   the logo fades/scales in (0.94 -> 1, 320ms) as the backdrop turns
 *   t=1400  hold
 *   t=1800  the logo slides left off-canvas over 260ms ('exit') while the next
 *           screen slides in from the right
 *
 * `mode` is the only input: 'play' runs the timeline, 'end' snaps to the held
 * end state (skip / reduce-motion), 'exit' slides the logo away.
 */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { BRAND } from '@/ui/assets';
import { CANVAS_H, CANVAS_W } from '@/ui/tokens';

export type BootMode = 'play' | 'end' | 'exit';

export interface BootSequenceProps {
  mode: BootMode;
}

export const BOOT_TIMELINE = {
  paperDrop: 120,
  logo: 800,
  logoDuration: 320,
  hold: 1400,
  exit: 1800,
  exitDuration: 260,
  reduceMotionHold: 900,
} as const;

const W = CANVAS_W;
const H = CANVAS_H;
const LOGO_W = 320;
const LOGO_H = 128;

export function BootSequence({ mode }: BootSequenceProps) {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.94);
  const exitX = useSharedValue(0);

  useEffect(() => {
    const t = BOOT_TIMELINE;

    if (mode === 'play') {
      logoOpacity.value = withDelay(
        t.logo,
        withTiming(1, { duration: t.logoDuration, easing: Easing.out(Easing.quad) }),
      );
      logoScale.value = withDelay(
        t.logo,
        withTiming(1, { duration: t.logoDuration, easing: Easing.out(Easing.cubic) }),
      );
      return;
    }

    // 'end' and 'exit' both start from the logo fully in.
    for (const v of [logoOpacity, logoScale, exitX]) cancelAnimation(v);
    logoOpacity.value = 1;
    logoScale.value = 1;

    if (mode === 'exit') {
      exitX.value = withTiming(-W - 20, {
        duration: t.exitDuration,
        easing: Easing.in(Easing.cubic),
      });
    } else {
      exitX.value = 0;
    }
  }, [mode, logoOpacity, logoScale, exitX]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ translateX: exitX.value }, { scale: logoScale.value }],
  }));

  return (
    <Animated.View style={[styles.logo, logoStyle]} pointerEvents="none">
      <Image
        source={BRAND.wordmark}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logo: {
    position: 'absolute',
    left: (W - LOGO_W) / 2,
    top: (H - LOGO_H) / 2 - 8,
    width: LOGO_W,
    height: LOGO_H,
  },
});
