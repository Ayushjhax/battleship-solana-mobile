/**
 * The big triangle between the boards. Points at whoever's board is live.
 * Green hachure when it's yours, red when theirs, a faint outline when idle.
 * With `seconds` set it shows the countdown in Bitter 700 and, under 5 s,
 * pulses the fill once a second.
 *
 * A change of direction is a 180 ms rotate-and-recolour: the shape is always
 * drawn pointing right and the container turns. `snap` skips the rotation —
 * the hard flip after a mine.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { trianglePoints } from './geometry';
import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export type TurnState = 'yours' | 'theirs' | 'idle';

export interface TurnTriangleProps {
  direction: 'left' | 'right';
  state: TurnState;
  seconds?: number;
  /** Flip without the 180 ms rotation. */
  snap?: boolean;
  /** Height in design units; width follows at 0.8 unless `width` is given. */
  size?: number;
  width?: number;
  seedKey?: string;
  style?: ViewStyle;
}

const PULSE_BELOW = 5;
const FLIP_MS = 180;

export function TurnTriangle({
  direction,
  state,
  seconds,
  snap = false,
  size = 48,
  width,
  seedKey = 'turn',
  style,
}: TurnTriangleProps) {
  const { roughPolygon } = useRough();
  const h = size;
  const w = width ?? Math.round(size * 0.8);
  const pad = 3;

  // Always drawn pointing right; the container rotates for 'left'.
  const points = trianglePoints(w, h, 'right', pad);
  const seed = hashString(`tri-${seedKey}`);
  const tone =
    state === 'yours' ? color.inkGreen : state === 'theirs' ? color.inkRed : color.inkFaint;

  const fill =
    state === 'idle'
      ? null
      : roughPolygon(points, {
          seed,
          stroke: 'none',
          fill: tone,
          fillStyle: 'hachure',
          hachureGap: 3.8,
          fillWeight: 1.2,
        });
  const outline = roughPolygon(points, {
    seed,
    stroke: tone,
    strokeWidth: state === 'idle' ? 1.2 : 1.8,
  });

  const rotation = useSharedValue(direction === 'left' ? 180 : 0);
  const previous = useRef(direction);
  useEffect(() => {
    if (previous.current === direction) return;
    previous.current = direction;
    const target = direction === 'left' ? 180 : 0;
    rotation.value = snap
      ? target
      : withTiming(target, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) });
  }, [direction, snap, rotation]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  const fillOpacity = useSharedValue(1);
  useEffect(() => {
    if (seconds !== undefined && seconds > 0 && seconds < PULSE_BELOW && state !== 'idle') {
      fillOpacity.value = withSequence(
        withTiming(0.2, { duration: 110 }),
        withTiming(1, { duration: 420 }),
      );
    }
  }, [seconds, state, fillOpacity]);
  const pulse = useAnimatedStyle(() => ({ opacity: fillOpacity.value }));

  // The visual centre of a triangle sits a third of the way from its base.
  const labelX = direction === 'right' ? w * 0.36 : w * 0.64;

  return (
    <View style={[{ width: w, height: h }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, spin]}>
        {fill ? (
          <Animated.View style={[StyleSheet.absoluteFill, pulse]}>
            <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
              <RoughShape paths={fill} />
            </Svg>
          </Animated.View>
        ) : null}
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
          <RoughShape paths={outline} />
        </Svg>
      </Animated.View>
      {seconds !== undefined ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: labelX - 20,
            top: 0,
            width: 40,
            height: h,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: state === 'idle' ? color.inkFaint : color.ink,
              fontFamily: font.display,
              fontSize: size >= 44 ? typeScale.sm : typeScale.xs,
            }}
          >
            {seconds}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
