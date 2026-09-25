/**
 * The settings toggle, assembled from its art (SETTINGS_ART) so it can move:
 * the knob springs across, the track crossfades grey to green, and the green
 * dash marks pop out on either side when it turns on.
 *
 * Geometry is the art's own, in its pixels: the track's pill is 195 x 68 at
 * (5, 4) in its file; the knob is 50/68 of the pill's height, inset 8.5; the
 * dash clusters sit 3 above the pill and just past each end (toggle-on.png).
 * The crossfade is expo-image's own transition and every animated value is a
 * transform, so a native-stack reattach can never strand the toggle faded out.
 */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { SETTINGS_ART } from './assets';
import { font } from './tokens';

const PILL = { w: 195, h: 68, x: 5, y: 4 } as const;
const TRACK_FILE = { w: 203, h: 79 } as const;
const KNOB_D = 50;
const KNOB_FILE = { w: 80, h: 83, inset: 7, visible: 69 } as const;
const GAP = 8.5;

export function ArtToggle({
  on,
  onChange,
  label,
  h = 26,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** The pill's height in design units; everything else follows from it. */
  h?: number;
}) {
  const reduceMotion = useReducedMotion();
  const k = h / PILL.h;
  const w = PILL.w * k;
  const knobTravel = (PILL.w - KNOB_D - GAP * 2) * k;

  const x = useSharedValue(on ? 1 : 0);
  const dash = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      x.value = on ? 1 : 0;
      dash.value = on ? 1 : 0;
      return;
    }
    x.value = withSpring(on ? 1 : 0, { damping: 16, stiffness: 260, mass: 0.7 });
    dash.value = on
      ? withSpring(1, { damping: 9, stiffness: 240 })
      : withTiming(0, { duration: 120 });
  }, [dash, on, reduceMotion, x]);

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * knobTravel }] }));
  const dashStyle = useAnimatedStyle(() => ({ transform: [{ scale: dash.value }] }));

  const f = (KNOB_D * k) / KNOB_FILE.visible;
  const knob = {
    width: KNOB_FILE.w * f,
    height: KNOB_FILE.h * f,
    left: GAP * k - KNOB_FILE.inset * f,
    top: ((PILL.h - KNOB_D) / 2) * k - KNOB_FILE.inset * f,
  };
  const dashSize = { width: 30 * k, height: 88 * k, top: -3 * k };
  const labelSide = (PILL.w - KNOB_D - GAP) * k;

  return (
    <Pressable
      onPress={() => {
        haptic('buttonPress');
        onChange(!on);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={6}
      style={{ width: w, height: h }}
    >
      <Animated.View pointerEvents="none" style={[styles.abs, dashSize, { left: -31 * k }, dashStyle]}>
        <Image source={SETTINGS_ART.dashesLeft} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.abs, dashSize, { left: w + 1 * k }, dashStyle]}>
        <Image source={SETTINGS_ART.dashesRight} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
      <Image
        source={on ? SETTINGS_ART.trackOn : SETTINGS_ART.trackOff}
        style={[
          styles.abs,
          { left: -PILL.x * k, top: -PILL.y * k, width: TRACK_FILE.w * k, height: TRACK_FILE.h * k },
        ]}
        contentFit="fill"
        transition={{ duration: 180, effect: 'cross-dissolve' }}
        cachePolicy="memory-disk"
      />
      <View
        pointerEvents="none"
        style={[styles.abs, styles.centre, { top: 0, height: h, width: labelSide, left: on ? 0 : w - labelSide }]}
      >
        <Text style={[styles.label, { fontSize: h * 0.56 }]}>{on ? 'On' : 'Off'}</Text>
      </View>
      <Animated.View pointerEvents="none" style={[styles.abs, knob, knobStyle]}>
        <Image source={SETTINGS_ART.knob} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  label: { color: '#F2F7F2', fontFamily: font.display, marginTop: -1 },
});
