/**
 * Ambient life — part-02 §9.
 *
 * "Three systems, all pausable, all off under reduced motion, total budget
 * <= 30 animated nodes and <= 2 ms per frame."
 *
 * Node budget, counted by __tests__ so it cannot drift:
 *   2 gulls  x 1 Animated.View each        =  2
 *   1 boat   x 1                           =  1
 *   1 crane arm x 1                        =  1
 *                                            --
 *                                             4   (well under 30)
 *
 * Everything lives INSIDE the map transform, so it pans and zooms with the
 * scene, and the whole layer is pointerEvents="none" — §9's "nothing ambient
 * may sit under a plot's tap target" is satisfied structurally rather than by
 * choosing coordinates carefully.
 */
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { color } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';
import { MAP_H, MAP_W } from './plots';
import { AMBIENT_NODE_BUDGET } from './budgets';

// Re-exported so the layer and its budget stay next to each other in code
// search, while the number itself lives in a renderer-free module.
export { AMBIENT_NODE_BUDGET };

const GULL_MS = 14_000;
const BOAT_MS = 40_000;
const CRANE_MS = 12_000;

const Gull = memo(function Gull({ index }: { index: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: GULL_MS + index * 2_600, easing: Easing.inOut(Easing.sin) }),
      -1,
      false,
    );
  }, [t, index]);

  // A looping bezier, evaluated on the UI thread.
  const p0 = { x: MAP_W * 0.35, y: MAP_H * 0.28 + index * 30 };
  const p1 = { x: MAP_W * 0.55, y: MAP_H * 0.18 + index * 20 };
  const p2 = { x: MAP_W * 0.78, y: MAP_H * 0.3 + index * 26 };

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const u = 1 - p;
    const x = u * u * p0.x + 2 * u * p * p1.x + p * p * p2.x;
    const y = u * u * p0.y + 2 * u * p * p1.y + p * p * p2.y;
    return {
      transform: [{ translateX: x }, { translateY: y }, { scaleX: p > 0.5 ? -1 : 1 }],
      opacity: 0.55,
    };
  });

  const { roughPath } = useRough();
  const wings = roughPath(
    [
      [0, 4],
      [4, 0],
      [8, 4],
    ],
    { seed: hashString(`gull-${index}`), strokeWidth: 1, stroke: color.inkSoft },
  );

  return (
    <Animated.View style={[styles.node, style]} pointerEvents="none">
      <Svg width={10} height={8}>
        <RoughShape paths={wings} />
      </Svg>
    </Animated.View>
  );
});

const Boat = memo(function Boat() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: BOAT_MS, easing: Easing.linear }), -1, false);
  }, [t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: MAP_W * 0.18 + t.value * MAP_W * 0.62 },
      { translateY: MAP_H * 0.24 - t.value * MAP_H * 0.05 },
    ],
    opacity: 0.6,
  }));

  const { roughPath } = useRough();
  const hull = roughPath(
    [
      [0, 6],
      [3, 10],
      [13, 10],
      [16, 6],
    ],
    { seed: hashString('ambient-boat'), strokeWidth: 1.1, stroke: color.inkSoft },
  );

  return (
    <Animated.View style={[styles.node, style]} pointerEvents="none">
      <Svg width={18} height={12}>
        <RoughShape paths={hull} />
      </Svg>
    </Animated.View>
  );
});

/** The Shipyard crane arm, swinging 8 degrees every ~12 s (§9). */
const CraneArm = memo(function CraneArm() {
  const swing = useSharedValue(0);
  useEffect(() => {
    swing.value = withRepeat(
      withSequence(
        withTiming(1, { duration: CRANE_MS / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: CRANE_MS / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [swing]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-4 + swing.value * 8}deg` }],
  }));

  const { roughLine } = useRough();
  const jib = roughLine(0, 22, 34, 4, {
    seed: hashString('crane-jib'),
    strokeWidth: 1.3,
    stroke: color.inkSoft,
  });

  return (
    <Animated.View
      style={[styles.node, { left: MAP_W * 0.8, top: MAP_H * 0.47 }, style]}
      pointerEvents="none"
    >
      <Svg width={36} height={26}>
        <RoughShape paths={jib} />
      </Svg>
    </Animated.View>
  );
});

export function AmbientLayer() {
  const reduceMotion = useReducedMotion();
  // §9: UNMOUNTED under reduced motion, not merely paused.
  if (reduceMotion) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Gull index={0} />
      <Gull index={1} />
      <Boat />
      <CraneArm />
    </View>
  );
}

const styles = StyleSheet.create({
  node: { position: 'absolute', left: 0, top: 0 },
});
