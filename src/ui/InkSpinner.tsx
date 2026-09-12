/**
 * A pen drawing a circle: a three-quarter rough arc that keeps turning. The
 * only spinner in the game — used for "Connecting" in the battle HUD corner
 * and, larger, as the radar dish on the searching screen.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { color } from './tokens';
import { RoughShape, hashString, useRough, type Point } from './useRough';

export interface InkSpinnerProps {
  /** Diameter, design units. */
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  /** One full turn, ms. */
  periodMs?: number;
  seedKey?: string;
  style?: ViewStyle;
}

export function InkSpinner({
  size = 28,
  stroke = color.ink,
  strokeWidth = 1.6,
  periodMs = 1100,
  seedKey = 'spinner',
  style,
}: InkSpinnerProps) {
  const { roughPath } = useRough();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(withTiming(360, { duration: periodMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [periodMs, reduceMotion, turn]);

  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const pad = 3;
  const r = (size - pad * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const points: Point[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 1.5 - Math.PI / 2;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const arc = roughPath(points, {
    seed: hashString(`spinner-${seedKey}`),
    stroke,
    strokeWidth,
    roughness: 0.9,
    bowing: 0.6,
    disableMultiStroke: true,
  });

  return (
    <Animated.View style={[{ width: size, height: size }, rotate, style]}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <RoughShape paths={arc} />
        </Svg>
      </View>
    </Animated.View>
  );
}
