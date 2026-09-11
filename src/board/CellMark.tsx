/**
 * Per-cell marks, each drawn rather than stamped:
 *   miss      a small ink dot with four short radiating splash ticks
 *   hit       an irregular filled blob in ink, six debris ticks, two inkRed flecks
 *   sunk      the hit blob with a heavier outline
 *   revealed  rough hachure fill only
 *   mine      a small spiked circle in inkRed
 *
 * Each mark is its own leaf: an Animated.View (entrance pop, 160 ms) around a
 * tiny SVG. The parent board never animates. Memoised on (state, r, c) so
 * only a changed cell re-renders; paths are generated once per cell and
 * served from the rough cache after that.
 */
import type { CellState, Coord } from '@engine/types';
import { memo, useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { RoughShape, hashString } from '@/ui/useRough';
import { MARK_BLEED, MARK_SIZE, markPaths } from './art';
import { CELL } from './layout';

export interface CellMarkProps {
  state: CellState;
  coord: Coord;
  /** Pop in on mount. Off for a board that is restored from a saved match. */
  animate?: boolean;
}

function CellMarkInner({ state, coord, animate = true }: CellMarkProps) {
  const seed = hashString(`mark-${state}-${coord.r},${coord.c}`);
  const layers = markPaths(state, seed);

  const scale = useSharedValue(animate ? 0.4 : 1);
  const rotate = useSharedValue(animate ? -14 + (seed % 28) : 0);
  useEffect(() => {
    if (!animate) return;
    scale.value = withSequence(
      withTiming(1.15, { duration: 100, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 60, easing: Easing.inOut(Easing.quad) }),
    );
    rotate.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [animate, scale, rotate]);
  const entrance = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }],
  }));

  if (layers.length === 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: coord.c * CELL - MARK_BLEED,
          top: coord.r * CELL - MARK_BLEED,
          width: MARK_SIZE,
          height: MARK_SIZE,
        },
        entrance,
      ]}
    >
      <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}>
        {layers.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
    </Animated.View>
  );
}

export const CellMark = memo(
  CellMarkInner,
  (a, b) =>
    a.state === b.state && a.coord.r === b.coord.r && a.coord.c === b.coord.c && a.animate === b.animate,
);
