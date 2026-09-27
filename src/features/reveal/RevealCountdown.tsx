/**
 * The reveal's five seconds: the badge's live number (5 down to 1), "Results
 * in Ns", and the green bar draining from full to empty — then `onDone`, once.
 *
 * Everything is read off `deadline` (see clock.ts), so a late timer, a dropped
 * frame or a trip to the background can neither stretch nor restart it: back
 * from the background after the deadline, it finishes at once. Only this small
 * component re-renders, and only when the number changes — one timeout to the
 * next change, no per-frame JS. The bar is one linear withTiming on the UI
 * thread, re-aimed only when the app comes back; with reduced motion it steps
 * once a second instead.
 */
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { REVEAL_ART } from '@/ui/assets';
import { artColor, font } from '@/ui/tokens';

import { fractionLeft, msToNextChange, secondsShown } from './clock';
import { BADGE, BAR_GAP, BAR_H, BAR_W, COUNT_LABEL } from './revealLayout';

const BAR_K = BAR_W / 320;
/**
 * Where the green runs inside the bar, in its 320 x 42 pixels: x 11..309,
 * y 10..32 — scripts/reveal-assets.sh prints the fill's bbox (277 x 22 at
 * 11,10); the fill is stretched to the track's full inside, so "full" is full.
 */
const BAR_FILL ={ x: 11 * BAR_K, y: 10 * BAR_K, w: 298 * BAR_K, h: 22 * BAR_K } as const;

function RevealCountdownInner({ deadline, onDone }: { deadline: number; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const [seconds, setSeconds] = useState(() => secondsShown(deadline, Date.now()));
  const fill = useSharedValue(fractionLeft(deadline, Date.now()));
  // The latest onDone without re-arming the clock when a parent re-renders.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    const aimBar = (now: number) => {
      cancelAnimation(fill);
      fill.value = fractionLeft(deadline, now);
      if (!reduceMotion) {
        fill.value = withTiming(0, { duration: Math.max(0, deadline - now), easing: Easing.linear });
      }
    };
    const tick = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (finished) return;
      const now = Date.now();
      if (now >= deadline) {
        finished = true;
        cancelAnimation(fill);
        fill.value = 0;
        done.current();
        return;
      }
      setSeconds(secondsShown(deadline, now));
      if (reduceMotion) fill.value = fractionLeft(deadline, now);
      timer = setTimeout(tick, msToNextChange(deadline, now));
    };
    aimBar(Date.now());
    tick();
    // Timers may not have run in the background: catch up on the way back.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || finished) return;
      aimBar(Date.now());
      tick();
    });
    return () => {
      finished = true;
      if (timer) clearTimeout(timer);
      sub.remove();
      cancelAnimation(fill);
    };
  }, [deadline, fill, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - fill.value) * BAR_FILL.w }],
  }));

  const shown = Math.max(1, seconds);
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`Results in ${shown} ${shown === 1 ? 'second' : 'seconds'}`}
    >
      <View style={styles.badge}>
        <Image source={REVEAL_ART.countdownBadge} style={StyleSheet.absoluteFill} contentFit="contain" />
        <Text style={styles.number} allowFontScaling={false}>
          {shown}
        </Text>
      </View>
      <Text style={styles.label} allowFontScaling={false}>
        Results in {shown}s
      </Text>
      <View style={styles.bar}>
        <Image source={REVEAL_ART.barTrack} style={StyleSheet.absoluteFill} contentFit="fill" />
        <View style={styles.fillClip}>
          <Animated.View style={[styles.fill, fillStyle]}>
            <Image source={REVEAL_ART.barFill} style={StyleSheet.absoluteFill} contentFit="fill" />
          </Animated.View>
        </View>
        <Image source={REVEAL_ART.barFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
      </View>
    </View>
  );
}

export const RevealCountdown = memo(RevealCountdownInner);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: { width: BADGE, height: BADGE, alignItems: 'center', justifyContent: 'center' },
  number: {
    color: artColor.revealInk,
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  label: {
    marginTop: COUNT_LABEL.gap,
    height: COUNT_LABEL.h,
    color: artColor.revealInk,
    fontFamily: font.label,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  bar: { marginTop: BAR_GAP, width: BAR_W, height: BAR_H },
  fillClip: {
    position: 'absolute',
    left: BAR_FILL.x,
    top: BAR_FILL.y,
    width: BAR_FILL.w,
    height: BAR_FILL.h,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, width: BAR_FILL.w, height: BAR_FILL.h },
});
