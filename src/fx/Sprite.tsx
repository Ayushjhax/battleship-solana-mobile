/**
 * Frame animation from one FxStrip (FX_ART): the whole strip is a single
 * image under a clipping box and a frame is shown by sliding the strip left
 * by whole cells — a transform, so it runs on the UI thread and nothing
 * re-renders while it plays. The frame is a shared value (fractional values
 * floor), so a caller can drive it from any clock: `useFrameClock` for a
 * straight run, or its own timeline (the aircraft's bay opens mid-flight).
 * FxLayer places each one.
 */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { FxStrip } from '@/ui/assets';

export function SpriteStrip({
  strip,
  width,
  frame,
  style,
}: {
  strip: FxStrip;
  /** One cell's width in canvas units; the height follows the cell's aspect. */
  width: number;
  frame: SharedValue<number>;
  style?: ViewStyle;
}) {
  const height = width / strip.aspect;
  const last = strip.frames - 1;
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: -Math.min(last, Math.max(0, Math.floor(frame.value))) * width }],
  }));
  return (
    <View pointerEvents="none" style={[{ width, height, overflow: 'hidden' }, style]}>
      <Animated.View style={[{ width: width * strip.frames, height }, slide]}>
        <Image
          source={strip.source}
          style={{ width: width * strip.frames, height }}
          contentFit="fill"
          cachePolicy="memory-disk"
        />
      </Animated.View>
    </View>
  );
}

export interface FrameClock {
  /** Frames per run of the strip. */
  frames: number;
  durationMs: number;
  delayMs?: number;
  /** Play last frame to first. */
  reverse?: boolean;
  /** Repeat forever (a sweep, a turning propeller). */
  loop?: boolean;
  onDone?: () => void;
}

/**
 * A frame value that runs 0 -> frames once (or forever), started on mount.
 * Under reduce-motion it rests on the run's last frame at once.
 */
export function useFrameClock({ frames, durationMs, delayMs = 0, reverse = false, loop = false, onDone }: FrameClock) {
  const reduceMotion = useReducedMotion();
  const start = reverse ? frames - 0.001 : 0;
  const end = reverse ? 0 : frames - 0.001;
  const frame = useSharedValue(start);
  useEffect(() => {
    if (reduceMotion) {
      frame.value = end;
      if (onDone) onDone();
      return;
    }
    const run = withTiming(end, { duration: durationMs, easing: Easing.linear }, (finished) => {
      if (finished && onDone && !loop) runOnJS(onDone)();
    });
    frame.value = start;
    frame.value = withDelay(delayMs, loop ? withRepeat(run, -1, false) : run);
    return () => cancelAnimation(frame);
    // A clock is started once per mount; a new run is a new component.
  }, []);
  return frame;
}
