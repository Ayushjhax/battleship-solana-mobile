/**
 * Impact and transition helpers: the micro-shake (3 biggest hits only), the
 * zoom punch, and the signature grid wipe.
 */
import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { C, EASE_IN, clamp } from '../theme';
import { SHAKES, f } from '../timeline';

/** Wraps the picture (never the letterbox or the grain): decaying 9-frame shake on SHAKES. */
export const Shake: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  let dx = 0;
  let dy = 0;
  let rot = 0;
  for (const b of SHAKES) {
    const t = frame - f(b);
    if (t >= 0 && t < 9) {
      const a = Math.pow(1 - t / 9, 1.6);
      dx = (random(`sx${b}-${t}`) * 2 - 1) * 16 * a;
      dy = (random(`sy${b}-${t}`) * 2 - 1) * 11 * a;
      rot = (random(`sr${b}-${t}`) * 2 - 1) * 0.35 * a;
    }
  }
  return <AbsoluteFill style={{ translate: `${dx}px ${dy}px`, rotate: `${rot}deg` }}>{children}</AbsoluteFill>;
};

/** Zoom punch: 1.08 → 1.00 over `frames` (3–5) from local frame `at`. */
export const punchAt = (frame: number, at: number, amount = 0.08, frames = 5) => {
  const t = frame - at;
  if (t < 0) return 1;
  return 1 + amount * interpolate(t, [0, frames], [1, 0], { ...clamp, easing: EASE_IN });
};

/**
 * GRID WIPE (the signature transition, used 3 times). Wrap the INCOMING shot: the
 * frame splits into the game's grid and its cells flip in one by one, in a
 * scattered order like shots landing, each with a brief ink flash.
 */
export const GridReveal: React.FC<{
  children: React.ReactNode;
  at?: number; // local frame the wipe starts
  dur?: number; // frames for the whole grid
  cols?: number;
  rows?: number;
  seed?: string;
  w?: number;
  h?: number;
}> = ({ children, at = 0, dur = 10, cols = 12, rows = 7, seed = 'gw', w = 1920, h = 1080 }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  const flip = 3; // frames per cell flip
  if (t >= dur + flip + 3) return <AbsoluteFill>{children}</AbsoluteFill>;
  const cw = w / cols;
  const ch = h / rows;
  const n = cols * rows;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => random(`${seed}${a}`) - random(`${seed}${b}`));
  const rects: string[] = [];
  const flashes: React.ReactNode[] = [];
  order.forEach((cell, rank) => {
    const start = (rank / n) * dur;
    const p = interpolate(t, [start, start + flip], [0, 1], { ...clamp, easing: EASE_IN });
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    if (p > 0) {
      const ww = cw * p;
      rects.push(`<rect x='${(c * cw + (cw - ww) / 2).toFixed(1)}' y='${(r * ch).toFixed(1)}' width='${(ww + 0.6).toFixed(1)}' height='${(ch + 0.6).toFixed(1)}'/>`);
    }
    const ft = t - start;
    if (ft >= 0 && ft < 5) {
      flashes.push(
        <div
          key={cell}
          style={{
            position: 'absolute',
            left: c * cw,
            top: r * ch,
            width: cw,
            height: ch,
            background: ft < 1.5 ? C.offWhite : C.accent,
            opacity: interpolate(ft, [0, 5], [0.55, 0], clamp),
            mixBlendMode: 'screen',
          }}
        />,
      );
    }
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${rects.join('')}</svg>`;
  const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  const lineOpacity = interpolate(t, [0, 2, dur, dur + flip + 3], [0, 0.85, 0.85, 0], clamp);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {flashes}
        <svg width={w} height={h} style={{ position: 'absolute', inset: 0, opacity: lineOpacity }}>
          {Array.from({ length: cols - 1 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * cw} x2={(i + 1) * cw} y1={0} y2={h} stroke={C.gridMajor} strokeWidth={2} />
          ))}
          {Array.from({ length: rows - 1 }, (_, i) => (
            <line key={`h${i}`} y1={(i + 1) * ch} y2={(i + 1) * ch} x1={0} x2={w} stroke={C.gridMajor} strokeWidth={2} />
          ))}
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
