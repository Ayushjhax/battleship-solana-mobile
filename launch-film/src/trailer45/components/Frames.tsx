/**
 * Glass screens (UI that isn't full-bleed), facecams, and the glowing bit.
 */
import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE_IN, clamp } from '../theme';

type Box = { x: number; y: number; w: number; h: number };

/** Rounded corners, a 1 px highlight, a soft shadow and a faint reflection. */
export const Glass: React.FC<{ box: Box; radius?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  box,
  radius = 26,
  children,
  style,
}) => (
  <div
    style={{
      position: 'absolute',
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
      borderRadius: radius,
      boxShadow: '0 50px 120px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.45)',
      ...style,
    }}
  >
    <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: C.night }}>{children}</div>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(255,255,255,0.16)',
        background: 'linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 32%)',
        pointerEvents: 'none',
      }}
    />
  </div>
);

/** A facecam: pops in on `at` (local frame) with a soft scale, then drifts in slowly. */
export const Facecam: React.FC<{
  src: string;
  box: Box;
  at: number;
  out?: number;
  from?: 'left' | 'right' | 'pop';
}> = ({ src, box, at, out, from = 'pop' }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || (out !== undefined && frame >= out)) return null;
  const e = interpolate(t, [0, 9], [0, 1], { ...clamp, easing: EASE_IN });
  const dx = from === 'left' ? (1 - e) * -box.w * 1.3 : from === 'right' ? (1 - e) * box.w * 1.3 : 0;
  const sc = from === 'pop' ? 0.82 + 0.18 * e : 1;
  const push = 1 + 0.05 * interpolate(t, [0, 60], [0, 1], clamp);
  return (
    <Glass
      box={box}
      radius={Math.round(box.w * 0.08)}
      style={{ translate: `${dx}px 0px`, scale: String(sc), opacity: from === 'pop' ? Math.min(1, e * 1.6) : 1 }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', scale: String(push) }} />
    </Glass>
  );
};

/** "The bit": the one glowing pixel. */
export const Bit: React.FC<{ x: number; y: number; size: number; intensity?: number; hollow?: number }> = ({
  x,
  y,
  size,
  intensity = 1,
  hollow = 0,
}) => (
  <div
    style={{
      position: 'absolute',
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      background: `rgba(${hollow > 0 ? '124,108,255' : '232,228,255'},${1 - hollow * 0.85})`,
      border: `${Math.max(1.5, size * 0.07)}px solid ${C.accent}`,
      boxShadow: [
        `0 0 ${size * 0.35 * intensity}px ${C.accent}`,
        `0 0 ${size * 1.1 * intensity}px ${C.accent}cc`,
        `0 0 ${size * 2.8 * intensity}px ${C.accent}77`,
        `0 0 ${size * 6 * intensity}px ${C.accent}33`,
        `inset 0 0 ${size * 0.45}px ${C.accent}`,
      ].join(','),
      opacity: Math.min(1, intensity),
    }}
  />
);

/** A sonar ping: a square ring growing out of a point and fading. */
export const Ping: React.FC<{ x: number; y: number; t: number; size: number; dur?: number; max?: number }> = ({
  x,
  y,
  t,
  size,
  dur = 22,
  max = 9,
}) => {
  if (t < 0 || t > dur) return null;
  const p = interpolate(t, [0, dur], [0, 1], { ...clamp, easing: EASE_IN });
  const s = size * (1 + p * (max - 1));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - s / 2,
        top: y - s / 2,
        width: s,
        height: s,
        border: `${Math.max(1.5, 3 * (1 - p))}px solid ${C.accent}`,
        opacity: (1 - p) * 0.9,
        boxShadow: `0 0 ${18 * (1 - p)}px ${C.accent}`,
      }}
    />
  );
};
