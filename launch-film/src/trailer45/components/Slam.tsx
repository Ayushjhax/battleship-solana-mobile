/**
 * The trailer card: ALL CAPS in Anton, slammed in on the beat —
 * scale 1.12 → 1.00 over 5 frames with a 2-frame blur.
 */
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, EASE_IN, FONT, clamp } from '../theme';

type Props = {
  text: string;
  /** local frame it lands on */
  at?: number;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  /** transform origin for the slam (default centre) */
  origin?: string;
  tracking?: number;
};

export const slam = (t: number) => ({
  scale: interpolate(t, [0, 5], [1.12, 1], { ...clamp, easing: EASE_IN }),
  blur: interpolate(t, [0, 2], [9, 0], clamp),
  opacity: interpolate(t, [0, 1], [0.55, 1], clamp),
});

export const Slam: React.FC<Props> = ({ text, at = 0, size = 172, color = C.offWhite, style, origin = 'center', tracking = 0.01 }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return null;
  const s = slam(t);
  return (
    <div
      style={{
        fontFamily: FONT.card,
        fontSize: size,
        lineHeight: 0.92,
        letterSpacing: `${tracking}em`,
        color,
        whiteSpace: 'pre',
        textTransform: 'uppercase',
        scale: String(s.scale),
        transformOrigin: origin,
        filter: s.blur > 0.05 ? `blur(${s.blur}px)` : undefined,
        opacity: s.opacity,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** A standalone card: centred text on black. */
export const Card: React.FC<Props & { children?: React.ReactNode }> = ({ children, ...p }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.black }}>
    <Slam {...p} />
    {children}
  </div>
);
