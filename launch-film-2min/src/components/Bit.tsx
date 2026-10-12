import React from 'react';
import {C} from '../theme';

/**
 * The signature: a single glowing pixel. A crisp white-violet square with a soft accent halo.
 * `size` is the square's edge in px; `glow` 0..1 scales the halo; `breath` 0..1 pulses it.
 */
export const Bit: React.FC<{size?: number; glow?: number; opacity?: number; style?: React.CSSProperties}> = ({
  size = 30,
  glow = 1,
  opacity = 1,
  style,
}) => {
  const halo = size * (2.2 + glow * 1.6);
  return (
    <div style={{position: 'relative', width: size, height: size, opacity, ...style}}>
      {/* wide halo */}
      <div
        style={{
          position: 'absolute',
          left: size / 2 - halo * 2,
          top: size / 2 - halo * 2,
          width: halo * 4,
          height: halo * 4,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(142,134,232,${0.32 * glow}) 0%, rgba(108,95,214,${0.12 * glow}) 28%, rgba(0,0,0,0) 62%)`,
        }}
      />
      {/* tight bloom */}
      <div
        style={{
          position: 'absolute',
          left: -size * 0.6,
          top: -size * 0.6,
          width: size * 2.2,
          height: size * 2.2,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(220,216,255,${0.85 * glow}) 0%, rgba(142,134,232,${0.35 * glow}) 45%, rgba(0,0,0,0) 72%)`,
        }}
      />
      {/* the pixel */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#F2F0FF',
          boxShadow: `0 0 ${size * 0.5}px ${size * 0.08}px ${C.accent}`,
        }}
      />
    </div>
  );
};
