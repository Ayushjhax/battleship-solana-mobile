/**
 * THE CORE UTILITY — every border, frame, button, panel and hatch fill in the
 * game comes through here (docs/brief.md 5.3).
 *
 * rough.generator() needs no drawing context, so it works in React Native:
 * generator.toPaths(drawable) hands back PathInfo[] that <RoughShape> feeds
 * straight into react-native-svg <Path> elements, in order.
 *
 * Usage:
 *   const { roughRect } = useRough();
 *   const border = roughRect(0, 0, w, h, { seed: hashString('board-frame-own') });
 *   <Svg><RoughShape paths={border} /></Svg>
 *
 * Seeds are DETERMINISTIC — derive them from a stable string key with
 * hashString(), never Math.random. Every generated path array is memoised by
 * (shape, dims, seed, opts) in src/ui/roughCore.ts, so a full battle screen
 * generates paths on mount and never again.
 */
import { createElement, memo, useMemo } from 'react';
import { G, Path } from 'react-native-svg';

import { roughHelpers, type PathInfo, type RoughHelpers } from './roughCore';

export {
  ROUGH_DEFAULTS,
  hashString,
  roughCacheSize,
  roughCircle,
  roughLine,
  roughPath,
  roughPolygon,
  roughRect,
} from './roughCore';
export type { PathInfo, Point, RoughHelpers, RoughOpts } from './roughCore';

/**
 * Returns the memoised helpers. The identity is stable for the life of the
 * app, so it is safe in dependency arrays.
 */
export function useRough(): RoughHelpers {
  return useMemo(() => roughHelpers, []);
}

export interface RoughShapeProps {
  paths: readonly PathInfo[];
  opacity?: number;
  /** SVG dash pattern, e.g. [4, 3]. Applied to outline paths only. */
  dash?: readonly number[];
}

/**
 * PathInfo[] -> <Path> elements. Rough.js emits the fill sketch first and the
 * outline last; that order IS the drawing, so it is preserved exactly.
 * (createElement rather than JSX because this file is .ts on purpose — the
 * hook is the API, not a component.)
 */
export const RoughShape = memo(function RoughShape({ paths, opacity, dash }: RoughShapeProps) {
  return createElement(
    G,
    { opacity },
    paths.map((p, i) =>
      createElement(Path, {
        key: i,
        d: p.d,
        stroke: p.stroke,
        strokeWidth: p.strokeWidth,
        fill: p.fill ?? 'none',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        strokeDasharray: dash && p.fill === 'none' && p.stroke !== 'none' ? [...dash] : undefined,
      }),
    ),
  );
});
