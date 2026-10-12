import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {CLAMP, rand} from '../lib/anim';

/** Punch curve: 0 → 1 over `up` frames, back to 0 over `down` frames (eased). */
export const punch = (frame: number, at: number, up = 4, down = 12) => {
  if (frame < at || frame > at + up + down) return 0;
  if (frame <= at + up) return interpolate(frame, [at, at + up], [0, 1], CLAMP);
  const t = (frame - at - up) / down;
  return (1 - t) ** 2.2;
};

/**
 * ZoomPunch: impact language for the battle. A 3–5-frame zoom punch (1.00 → 1.08), an
 * optional 2-frame 15 % white flash and an optional decaying micro-shake (reserved for the
 * 3–4 biggest hits).
 */
export const ZoomPunch: React.FC<{
  hits: {at: number; amount?: number; flash?: boolean; shake?: boolean}[];
  children: React.ReactNode;
  origin?: string;
}> = ({hits, children, origin = '50% 50%'}) => {
  const frame = useCurrentFrame();
  let s = 1;
  let sx = 0;
  let sy = 0;
  let flash = 0;
  for (const h of hits) {
    const p = punch(frame, h.at, 4, 12);
    s *= 1 + (h.amount ?? 0.08) * p;
    if (h.flash && frame >= h.at && frame < h.at + 2) flash = 0.15;
    if (h.shake && frame >= h.at && frame < h.at + 10) {
      const d = 1 - (frame - h.at) / 10;
      sx += rand(frame * 3.1 + h.at) * 14 * d;
      sy += rand(frame * 7.7 + h.at) * 10 * d;
    }
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{scale: s, translate: `${sx}px ${sy}px`, transformOrigin: origin}}>{children}</AbsoluteFill>
      {flash > 0 ? <AbsoluteFill style={{background: '#fff', opacity: flash}} /> : null}
    </AbsoluteFill>
  );
};
