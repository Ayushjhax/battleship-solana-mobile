import React from 'react';
import {useCurrentFrame} from 'remotion';
import {enter, mix} from '../lib/anim';
import {SHADOW} from '../theme';

/**
 * A generic, logo-free handset held in landscape (the game is landscape-only). Graphite body,
 * thin even bezel, a punch-hole camera on the short edge. No brand, no notch shapes of any
 * real phone. `screenWidth` sets the size; the screen is 20:9 like the recordings.
 */
export const PhoneFrame: React.FC<{
  screenWidth: number;
  x: number;
  y: number;
  at?: number;
  tilt?: number;
  rotateY?: number;
  scale?: number;
  opacity?: number;
  children: React.ReactNode;
}> = ({screenWidth, x, y, at, tilt = 12, rotateY = 0, scale = 1, opacity = 1, children}) => {
  const frame = useCurrentFrame();
  const p = at === undefined ? 1 : enter(frame, at, 30);
  const sw = screenWidth;
  const sh = (sw * 1200) / 2670;
  const bezel = sh * 0.045;
  const W = sw + bezel * 2;
  const H = sh + bezel * 2;
  const R = H * 0.13;
  return (
    <div style={{position: 'absolute', left: x - W / 2, top: y - H / 2, width: W, height: H, perspective: 6000, opacity: p * opacity, scale}}>
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `translateY(${mix(H * 0.2, 0, p)}px) rotateX(${mix(tilt, 0, p)}deg) rotateY(${rotateY}deg) scale(${mix(0.92, 1, p)})`,
          transformOrigin: '50% 100%',
          borderRadius: R,
          WebkitBoxReflect: `below ${Math.round(H * 0.03)}px linear-gradient(to bottom, rgba(0,0,0,0) 74%, rgba(0,0,0,0.14) 100%)`,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: R,
            background: 'linear-gradient(160deg, #2a2a30 0%, #121216 45%, #0b0b0e 100%)',
            boxShadow: `${SHADOW}, inset 0 0 0 3px rgba(255,255,255,0.10), inset 0 3px 0 0 rgba(255,255,255,0.14)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: bezel,
              top: bezel,
              width: sw,
              height: sh,
              borderRadius: R - bezel * 0.9,
              overflow: 'hidden',
              background: '#000',
            }}
          >
            {children}
            <div style={{position: 'absolute', inset: 0, borderRadius: R - bezel * 0.9, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.6)'}} />
          </div>
          {/* punch-hole camera on the left short edge */}
          <div
            style={{
              position: 'absolute',
              left: bezel * 0.5 - bezel * 0.18,
              top: H / 2 - bezel * 0.18,
              width: bezel * 0.36,
              height: bezel * 0.36,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 35%, #3a3a48, #050507 70%)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
