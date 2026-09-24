/**
 * A building, inked — part-02 §4. "Construction IS the drawing."
 *
 * Every stroke from buildingArt() becomes rough paths through the shared
 * generator, then each is revealed with strokeDashoffset in proportion to how
 * far the build has got. Paths come from src/ui/roughCore.ts's cache, so a
 * plot generates its geometry once and never again.
 *
 * The dash trick: with strokeDasharray [L, L] and strokeDashoffset L*(1-share),
 * a share of 0 sits entirely in the "off" half and a share of 1 in the "on"
 * half — so long as L is at least the path's real length. react-native-svg has
 * no reliable getTotalLength, so L is the geometric length with a generous
 * margin for how far a rough stroke wanders.
 */
import { memo, useMemo } from 'react';
import Svg, { G, Path } from 'react-native-svg';

import { color } from '@/ui/tokens';
import { COIN_GOLD } from '@/ui/CurrencyChip';
import { hashString, roughCircle, roughLine, roughPath, roughPolygon, type PathInfo } from '@/ui/useRough';
import { buildingArt, strokeReveal, type BuildingArt, type Stroke } from './buildingArt';
import type { BuildingId } from '@engine/city';

/** Rough strokes wander; over-estimate the dash length so a full reveal is full. */
const DASH_MARGIN = 1.9;

export interface BuildingDrawingProps {
  readonly buildingId: BuildingId;
  readonly tier: 1 | 2 | 3 | 4;
  readonly w: number;
  readonly h: number;
  /** 0..1. 1 draws the finished building. */
  readonly progress: number;
  /** Max level swaps the ink for gold (§4). */
  readonly gold?: boolean;
  /** Scaffold strokes over the old tier while upgrading (§3). */
  readonly scaffold?: boolean;
  readonly opacity?: number;
}

function pathsFor(stroke: Stroke, id: BuildingId, index: number, w: number, h: number): readonly PathInfo[] {
  const seed = hashString(`plot-${id}-${index}`);
  const px = (p: readonly [number, number]): [number, number] => [p[0] * w, p[1] * h];
  const opts = {
    seed,
    strokeWidth: stroke.weight,
    roughness: 1.25,
    bowing: 1,
    stroke: color.ink,
    ...(stroke.fill
      ? { fill: color.ink, fillStyle: 'hachure' as const, hachureGap: 3.2, fillWeight: 0.6 }
      : {}),
  };

  switch (stroke.shape) {
    case 'polygon':
      return roughPolygon(stroke.points.map(px), opts);
    case 'path':
      return roughPath(stroke.points.map(px), opts);
    case 'line': {
      const a = stroke.points[0];
      const b = stroke.points[1];
      if (!a || !b) return [];
      return roughLine(a[0] * w, a[1] * h, b[0] * w, b[1] * h, opts);
    }
    case 'circle': {
      const c = stroke.circle;
      if (!c) return [];
      return roughCircle(c.cx * w, c.cy * h, c.d * Math.min(w, h), opts);
    }
  }
}

function lengthEstimate(stroke: Stroke, w: number, h: number): number {
  if (stroke.shape === 'circle') return Math.PI * (stroke.circle?.d ?? 0) * Math.min(w, h);
  let total = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    if (!a || !b) continue;
    total += Math.hypot((b[0] - a[0]) * w, (b[1] - a[1]) * h);
  }
  if (stroke.shape === 'polygon' && stroke.points.length > 2) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    if (first && last) total += Math.hypot((first[0] - last[0]) * w, (first[1] - last[1]) * h);
  }
  return Math.max(8, total);
}

export const BuildingDrawing = memo(function BuildingDrawing({
  buildingId,
  tier,
  w,
  h,
  progress,
  gold = false,
  scaffold = false,
  opacity = 1,
}: BuildingDrawingProps) {
  const art: BuildingArt = useMemo(() => buildingArt(buildingId, tier), [buildingId, tier]);
  const reveal = useMemo(() => strokeReveal(art, progress), [art, progress]);

  const rendered = useMemo(
    () =>
      art.strokes.map((stroke, index) => ({
        stroke,
        paths: pathsFor(stroke, buildingId, index, w, h),
        dash: lengthEstimate(stroke, w, h) * DASH_MARGIN,
      })),
    [art, buildingId, w, h],
  );

  const scaffoldPaths = useMemo(() => {
    if (!scaffold) return [];
    const seed = hashString(`scaffold-${buildingId}`);
    return [
      roughLine(w * 0.08, h * 0.95, w * 0.08, h * 0.15, { seed, strokeWidth: 1, stroke: color.inkSoft }),
      roughLine(w * 0.92, h * 0.95, w * 0.92, h * 0.15, { seed: seed + 1, strokeWidth: 1, stroke: color.inkSoft }),
      roughLine(w * 0.05, h * 0.45, w * 0.95, h * 0.42, { seed: seed + 2, strokeWidth: 0.9, stroke: color.inkSoft }),
      roughLine(w * 0.05, h * 0.72, w * 0.95, h * 0.7, { seed: seed + 3, strokeWidth: 0.9, stroke: color.inkSoft }),
    ];
  }, [scaffold, buildingId, w, h]);

  const ink = gold ? COIN_GOLD : color.ink;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} pointerEvents="none">
      <G opacity={opacity}>
        {rendered.map(({ paths, dash }, index) => {
          const share = reveal[index] ?? 0;
          if (share <= 0) return null;
          return (
            <G key={index}>
              {paths.map((p, i) => (
                <Path
                  key={i}
                  d={p.d}
                  stroke={p.stroke === 'none' ? 'none' : ink}
                  strokeWidth={p.strokeWidth}
                  fill={p.fill ? ink : 'none'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...(share < 1
                    ? { strokeDasharray: [dash, dash], strokeDashoffset: dash * (1 - share) }
                    : {})}
                />
              ))}
            </G>
          );
        })}
        {scaffoldPaths.map((paths, index) => (
          <G key={`scaffold-${index}`}>
            {paths.map((p, i) => (
              <Path
                key={i}
                d={p.d}
                stroke={color.inkSoft}
                strokeWidth={p.strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={[5, 3]}
              />
            ))}
          </G>
        ))}
      </G>
    </Svg>
  );
});
