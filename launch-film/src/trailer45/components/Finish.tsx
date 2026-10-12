/**
 * The finish, over everything: the letterbox, flash frames, film grain and a soft vignette.
 * Grain: 8 pre-generated noise tiles (public/fx/grain_*.png), one per frame, at a
 * random but deterministic offset; ~2 % in overlay blend (it also kills banding).
 */
import React from 'react';
import { AbsoluteFill, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE_IN, EASE_MOVE, clamp } from '../theme';
import { FLASHES, HEIGHT, LETTERBOX, WIDTH, f } from '../timeline';

/** 2.39:1 inside 1920 x 1080 */
export const BAR = Math.round((HEIGHT - WIDTH / 2.39) / 2);

export const letterboxAt = (frame: number) => {
  const inn = interpolate(frame, [f(LETTERBOX.in), f(LETTERBOX.in) + 10], [0, BAR], { ...clamp, easing: EASE_IN });
  const out = interpolate(frame, [f(LETTERBOX.out), f(LETTERBOX.out + 1)], [0, BAR], { ...clamp, easing: EASE_MOVE });
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

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.14 }) => {
  const frame = useCurrentFrame();
  const i = frame % 8;
  const ox = Math.floor(random(`gx${frame}`) * 512);
  const oy = Math.floor(random(`gy${frame}`) * 512);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile(`fx/grain_${i}.png`)})`,
        backgroundPosition: `${ox}px ${oy}px`,
        backgroundRepeat: 'repeat',
        mixBlendMode: 'overlay',
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.36 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);
