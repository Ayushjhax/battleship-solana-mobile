import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {CLAMP} from '../lib/anim';
import {EASE} from '../theme';

/**
 * The camera never stops: a slow push-in (1.00 → `push`) with gentle lateral drift across the
 * whole Sequence, eased with the camera curve. Children are the "world".
 */
export const Drift: React.FC<{
  push?: number;
  from?: number;
  dx?: number;
  dy?: number;
  origin?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({push = 1.06, from = 1, dx = 0, dy = 0, origin = '50% 50%', children, style}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 1], {...CLAMP, easing: EASE.cam});
  return (
    <AbsoluteFill style={{scale: from + (push - from) * p, translate: `${dx * p}px ${dy * p}px`, transformOrigin: origin, ...style}}>
      {children}
    </AbsoluteFill>
  );
};

/** A plate treatment: dims and blurs footage under type (never type over busy UI). */
export const Plate: React.FC<{dim?: number; blur?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({
  dim = 0,
  blur = 0,
  children,
  style,
}) => (
  <AbsoluteFill style={{filter: [blur > 0.2 ? `blur(${blur}px)` : '', dim > 0 ? `brightness(${1 - dim})` : ''].join(' ') || undefined, ...style}}>
    {children}
  </AbsoluteFill>
);
