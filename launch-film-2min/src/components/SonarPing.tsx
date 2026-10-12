import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {CLAMP} from '../lib/anim';
import {C, EASE} from '../theme';

/**
 * Sonar rings expanding from (x, y). `at` = frame of the ping. Rings are thin accent strokes that
 * thin out and fade as they grow; `rings` staggered by `gap` frames.
 */
export const SonarPing: React.FC<{
  x: number;
  y: number;
  at: number;
  radius?: number;
  rings?: number;
  gap?: number;
  dur?: number;
  stroke?: number;
  color?: string;
  intensity?: number;
}> = ({x, y, at, radius = 1400, rings = 3, gap = 7, dur = 70, stroke = 5, color = C.accent, intensity = 1}) => {
  const frame = useCurrentFrame();
  return (
    <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'}}>
      {Array.from({length: rings}, (_, i) => {
        const s = at + i * gap;
        if (frame < s || frame > s + dur) return null;
        const p = interpolate(frame, [s, s + dur], [0, 1], {...CLAMP, easing: EASE.enter});
        const r = p * radius * (1 - i * 0.12);
        const op = (1 - p) ** 1.6 * (1 - i * 0.25) * intensity;
        return <circle key={i} cx={x} cy={y} r={Math.max(0.1, r)} fill="none" stroke={color} strokeWidth={stroke * (1 - p * 0.6)} opacity={op} />;
      })}
    </svg>
  );
};
