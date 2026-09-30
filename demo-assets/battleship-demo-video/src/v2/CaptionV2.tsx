import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

import { CAPTION_V2, CAPTIONS_V2, COLOR, FONT_FAMILY } from './configV2';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

/**
 * One line on an ink plate, bottom left. It arrives as a single mask wipe
 * with the words rising into place, and leaves as a wipe the same way.
 */
export const CaptionV2: React.FC = () => {
  const frame = useCurrentFrame();
  const c = CAPTIONS_V2.find((x) => frame >= x.inAt && frame < x.outAt + CAPTION_V2.outFrames);
  if (!c) return null;

  const reveal = easeOut(interpolate(frame, [c.inAt, c.inAt + CAPTION_V2.inFrames], [0, 1], clamp));
  const words = easeOut(interpolate(frame, [c.inAt + 3, c.inAt + 3 + CAPTION_V2.inFrames], [0, 1], clamp));
  const leave = easeIn(interpolate(frame, [c.outAt, c.outAt + CAPTION_V2.outFrames], [0, 1], clamp));
  const H = CAPTION_V2.height;
  const d = CAPTION_V2.disc;

  return (
    <div
      style={{
        position: 'absolute',
        left: CAPTION_V2.x,
        bottom: CAPTION_V2.bottom,
        height: H,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 40,
        padding: `0 64px 0 ${(H - d) / 2}px`,
        borderRadius: 28,
        background: 'rgba(14,16,96,0.94)',
        boxShadow: '0 26px 70px rgba(0,0,16,0.45), inset 0 0 0 3px rgba(253,250,243,0.14)',
        clipPath: `inset(0% ${(1 - reveal) * 100}% 0% ${leave * 100}% round 28px)`,
      }}
    >
      <div
        style={{
          width: d,
          height: d,
          flex: 'none',
          borderRadius: '50%',
          background: COLOR.paper,
          boxShadow: `inset 0 0 0 5px ${COLOR.cityInk}, inset 0 0 0 11px ${COLOR.paper}, inset 0 0 0 13px rgba(11,4,145,0.3)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Img src={staticFile(c.icon)} style={{ width: c.iconW, height: 'auto', display: 'block' }} />
      </div>
      <div style={{ overflow: 'hidden', paddingBottom: 12, paddingTop: 4 }}>
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontWeight: 700,
            fontSize: CAPTION_V2.fontSize,
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            color: COLOR.paper,
            whiteSpace: 'nowrap',
            transform: `translateY(${(1 - words) * 70}%)`,
          }}
        >
          {c.text}
        </div>
      </div>
    </div>
  );
};
