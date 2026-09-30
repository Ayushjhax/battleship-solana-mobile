import React from 'react';
import { interpolate } from 'remotion';

import { COLOR, HIGHLIGHTS } from '../config';

/**
 * A ring in the game's red ink, drawn on like a ballpoint stroke: a rounded
 * box traced twice with a small, fixed wobble so it reads as hand-drawn.
 */
function wobblyBox(cx: number, cy: number, w: number, h: number, r: number, seed: number): string {
  const pts: [number, number][] = [];
  const hw = w / 2;
  const hh = h / 2;
  const steps = 72;
  for (let i = 0; i <= steps + 6; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2 + seed * 0.3;
    // superellipse (n ≈ 6): a rounded box that clears the target's corners
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 0.34 + 0.2 * Math.min(r / Math.min(hw, hh), 1);
    const px = Math.sign(c) * Math.pow(Math.abs(c), k) * hw;
    const py = Math.sign(s) * Math.pow(Math.abs(s), k) * hh;
    const wob = 1 + 0.018 * Math.sin(i * 0.9 + seed * 2.1) + 0.012 * Math.sin(i * 2.3 + seed);
    // the stroke overshoots its start a little, as a pen does
    const over = i > steps ? 1 + (i - steps) * 0.006 : 1;
    pts.push([cx + px * wob * over, cy + py * wob * over]);
  }
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export interface InkMark {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  draw: readonly [number, number];
  fadeOut: readonly [number, number];
}

/** Scene 1's rings (v1). */
export const Highlights: React.FC<{ frame: number }> = ({ frame }) => <InkMarks frame={frame} marks={HIGHLIGHTS} />;

/** Rings in recording pixels, drawn inside the footage's own coordinate space. */
export const InkMarks: React.FC<{ frame: number; marks: readonly InkMark[] }> = ({ frame, marks }) => {
  return (
    <svg
      viewBox="0 0 1280 576"
      style={{ position: 'absolute', left: 0, top: 0, width: 1280, height: 576, overflow: 'visible' }}
    >
      {marks.map((h) => {
        const draw = interpolate(frame, h.draw, [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: (t) => 1 - Math.pow(1 - t, 3),
        });
        const opacity = interpolate(frame, h.fadeOut, [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        if (draw <= 0 || opacity <= 0) return null;
        return (
          <g key={h.id} opacity={opacity} fill="none" stroke={COLOR.red} strokeLinecap="round" strokeLinejoin="round">
            <path
              d={wobblyBox(h.x, h.y, h.w, h.h, h.radius, 1)}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - draw}
              strokeWidth={3.4}
            />
            <path
              d={wobblyBox(h.x + 0.8, h.y - 0.6, h.w + 4, h.h + 3, h.radius, 2.7)}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - Math.max(0, draw * 1.15 - 0.15)}
              strokeWidth={1.6}
              opacity={0.55}
            />
          </g>
        );
      })}
    </svg>
  );
};
