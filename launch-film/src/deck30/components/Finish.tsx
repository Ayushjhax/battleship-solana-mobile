/**
 * Deck30 finish, over everything: cinema letterbox, flash frames, micro-shake, halation. Grain and vignette are the
 * trailer's own components (src/trailer45/components/Finish.tsx), so the campaign shares one finish.
 */
import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { C, EASE_IN, EASE_MOVE, clamp } from '../../trailer45/theme';
import { FLASHES, HEIGHT, LETTERBOX, SHAKES, WIDTH, f } from '../timeline';

/** 2.39:1 inside 1920 x 1080 (138 px each) */
export const BAR = Math.round((HEIGHT - WIDTH / 2.39) / 2);
export const BAND = { top: BAR, bottom: HEIGHT - BAR } as const;

export const letterboxAt = (frame: number) => {
  const inn = interpolate(frame, [f(LETTERBOX.in), f(LETTERBOX.in) + 10], [0, BAR], { ...clamp, easing: EASE_IN });
  const out = interpolate(frame, [f(LETTERBOX.out), f(LETTERBOX.out + LETTERBOX.outBeats)], [0, BAR], { ...clamp, easing: EASE_MOVE });
  return Math.max(0, inn - out);
};

export const Letterbox: React.FC = () => {
  const h = letterboxAt(useCurrentFrame());
  if (h <= 0.1) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: h, background: C.black }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h, background: C.black }} />
    </AbsoluteFill>
  );
};

/** Two frames on the biggest hits only: white, then the accent. */
export const Flashes: React.FC = () => {
  const frame = useCurrentFrame();
  for (const b of FLASHES) {
    const t = frame - f(b);
    if (t >= 0 && t < 2) {
      return <AbsoluteFill style={{ background: t === 0 ? '#FFFFFF' : C.accent, opacity: t === 0 ? 0.92 : 0.45, mixBlendMode: 'screen' }} />;
    }
  }
  return null;
};

/** Wraps the picture (never the letterbox or the grain): a decaying 9-frame shake on the three biggest hits. */
export const Shake: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  let dx = 0;
  let dy = 0;
  let rot = 0;
  for (const b of SHAKES) {
    const t = frame - f(b);
    if (t >= 0 && t < 9) {
      const a = Math.pow(1 - t / 9, 1.6);
      dx = (random(`d30sx${b}-${t}`) * 2 - 1) * 16 * a;
      dy = (random(`d30sy${b}-${t}`) * 2 - 1) * 11 * a;
      rot = (random(`d30sr${b}-${t}`) * 2 - 1) * 0.35 * a;
    }
  }
  return <AbsoluteFill style={{ translate: `${dx}px ${dy}px`, rotate: `${rot}deg` }}>{children}</AbsoluteFill>;
};

/**
 * Gentle halation: the frame behind, thresholded (contrast) and blurred, screened back on top at low opacity, so
 * highlights bloom softly and blacks stay deep.
 */
export const Halation: React.FC<{ opacity?: number }> = ({ opacity = 0.16 }) => (
  <AbsoluteFill
    style={{
      backdropFilter: 'brightness(0.75) contrast(2.2) blur(16px)',
      WebkitBackdropFilter: 'brightness(0.75) contrast(2.2) blur(16px)',
      mixBlendMode: 'screen',
      opacity,
      pointerEvents: 'none',
    }}
  />
);
