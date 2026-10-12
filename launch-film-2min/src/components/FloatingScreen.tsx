import React from 'react';
import {useCurrentFrame} from 'remotion';
import {enter, mix} from '../lib/anim';
import {INNER_HIGHLIGHT, RADIUS, SHADOW} from '../theme';

/**
 * Landscape gameplay as a glass screen floating on black: rounded corners, a 1px inner
 * highlight, a layered soft shadow, a faint floor reflection. It enters on a 3D tilt
 * (rotateX `tilt`°) and settles flat.
 */
export const FloatingScreen: React.FC<{
  width: number;
  height: number;
  x?: number;
  y?: number;
  /** frame the entrance starts; undefined = already settled */
  at?: number;
  enterDur?: number;
  tilt?: number;
  reflection?: boolean;
  radius?: number;
  /** extra transform applied to the settled screen (camera) */
  scale?: number;
  opacity?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({width, height, x = 1920, y = 1080, at, enterDur = 30, tilt = 14, reflection = true, radius = RADIUS.screen, scale = 1, opacity = 1, children, style}) => {
  const frame = useCurrentFrame();
  const p = at === undefined ? 1 : enter(frame, at, enterDur);
  const rot = mix(tilt, 0, p);
  const ty = mix(height * 0.18, 0, p);
  const s = mix(0.92, 1, p);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - width / 2,
        top: y - height / 2,
        width,
        height,
        perspective: 5200,
        perspectiveOrigin: '50% 30%',
        opacity: p * opacity,
        scale,
        ...style,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `translateY(${ty}px) rotateX(${rot}deg) scale(${s})`,
          transformOrigin: '50% 100%',
          borderRadius: radius,
          WebkitBoxReflect: reflection
            ? `below ${Math.round(height * 0.035)}px linear-gradient(to bottom, rgba(0,0,0,0) 72%, rgba(0,0,0,0.16) 100%)`
            : undefined,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: radius,
            overflow: 'hidden',
            boxShadow: SHADOW,
            background: '#0a0a0c',
          }}
        >
          {children}
          <div style={{position: 'absolute', inset: 0, borderRadius: radius, boxShadow: INNER_HIGHLIGHT, pointerEvents: 'none'}} />
        </div>
      </div>
    </div>
  );
};
