import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {CLAMP} from '../lib/anim';
import {EASE} from '../theme';

/**
 * MaskReveal: reveals children through a moving hard-edged mask (left → right by default,
 * with a soft feather), like a line of light drawing the object into existence.
 */
export const MaskReveal: React.FC<{
  at: number;
  dur?: number;
  direction?: 'right' | 'up';
  feather?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({at, dur = 26, direction = 'right', feather = 12, children, style}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + dur], [0, 1], {...CLAMP, easing: EASE.enter});
  const pos = -feather + p * (100 + feather * 2);
  const dir = direction === 'right' ? 'to right' : 'to top';
  const mask = `linear-gradient(${dir}, #000 ${pos - feather}%, transparent ${pos}%)`;
  if (frame < at) return null;
  return <div style={{WebkitMaskImage: p >= 1 ? undefined : mask, maskImage: p >= 1 ? undefined : mask, ...style}}>{children}</div>;
};

/**
 * LightSweep: a soft diagonal band of light passing across the children once, clipped to
 * their shape (for text: rendered as a second copy with a moving gradient via background-clip).
 * For text, pass `text` + font styles; otherwise it sweeps a screen-blended band over a box.
 */
export const LightSweep: React.FC<{
  at: number;
  dur?: number;
  width?: number;
  angle?: number;
  intensity?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** for text: the band only lights the glyphs */
  textStyle?: React.CSSProperties;
  text?: string;
}> = ({at, dur = 40, width = 18, angle = 105, intensity = 0.9, children, style, text, textStyle}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + dur], [0, 1], {...CLAMP, easing: EASE.cam});
  const active = frame >= at && frame <= at + dur;
  const pos = -width + p * (100 + width * 2);
  const band = `linear-gradient(${angle}deg, rgba(255,255,255,0) ${pos - width}%, rgba(255,255,255,${intensity}) ${pos}%, rgba(255,255,255,0) ${pos + width}%)`;
  return (
    <div style={{position: 'relative', ...style}}>
      {children}
      {active && text !== undefined ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            ...textStyle,
            color: 'transparent',
            backgroundImage: band,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            filter: 'blur(0.6px)',
          }}
        >
          {text}
        </div>
      ) : null}
      {active && text === undefined ? (
        <div style={{position: 'absolute', inset: 0, backgroundImage: band, mixBlendMode: 'screen', opacity: 0.5, borderRadius: 'inherit'}} />
      ) : null}
    </div>
  );
};
