import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

import { CAPTION, CAPTIONS, COLOR, FONT_FAMILY } from '../config';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

/**
 * One caption lockup for the whole video, always in the same place: a paper
 * disc holding the real game icon for the action (it flips at each cut) and
 * one short line in Bitter, the game's display face.
 */
export const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const [exitStart, exitEnd] = CAPTION.exit;
  if (frame >= exitEnd) return null;

  const index = CAPTIONS.findIndex((c) => frame >= c.from && frame <= c.to);
  if (index < 0) return null;
  const current = CAPTIONS[index];
  const next = CAPTIONS[index + 1];

  // leaving: the last few frames before the next caption's first frame
  const leaving = next ? easeIn(interpolate(frame, [next.from - CAPTION.outFrames, next.from], [0, 1], clamp)) : 0;
  // arriving: the first frames of this caption (the opening one is already up)
  const arriving =
    index === 0 ? 1 : easeOut(interpolate(frame, [current.from, current.from + CAPTION.inFrames], [0, 1], clamp));
  const exit = easeIn(interpolate(frame, [exitStart, exitEnd], [0, 1], clamp));

  const textOpacity = arriving * (1 - leaving) * (1 - exit);
  const textY = (1 - arriving) * 34 - leaving * 26 - exit * 24;

  // disc: turns edge-on to swap icons at each cut; small settle on frame 0
  const flipIn = index === 0 ? 1 : easeOut(interpolate(frame, [current.from, current.from + 10], [0, 1], clamp));
  const rotate = leaving > 0 ? leaving * 90 : (1 - flipIn) * -90;
  const pop = index === 0 ? 0.9 + 0.1 * easeOut(interpolate(frame, [0, 12], [0, 1], clamp)) : 1;
  const discOpacity = 1 - exit;

  const d = CAPTION.disc;

  return (
    <div
      style={{
        position: 'absolute',
        left: CAPTION.x,
        top: CAPTION.y,
        height: d,
        display: 'flex',
        alignItems: 'center',
        gap: CAPTION.gap,
      }}
    >
      <div style={{ width: d, height: d, perspective: 900, opacity: discOpacity, transform: `translateY(${-exit * 24}px)` }}>
        <div
          style={{
            width: d,
            height: d,
            borderRadius: '50%',
            background: COLOR.paper,
            boxShadow: `inset 0 0 0 6px ${COLOR.cityInk}, inset 0 0 0 13px ${COLOR.paper}, inset 0 0 0 15px rgba(11,4,145,0.35), 0 18px 44px rgba(0,0,10,0.45)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `rotateY(${rotate}deg) scale(${pop})`,
          }}
        >
          <Img src={staticFile(current.icon)} style={{ width: current.iconW, height: 'auto', display: 'block' }} />
        </div>
      </div>
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: CAPTION.fontSize,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: COLOR.paper,
          whiteSpace: 'nowrap',
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
          textShadow: '0 6px 26px rgba(0,0,12,0.55)',
          paddingBottom: 10,
        }}
      >
        {current.text}
      </div>
    </div>
  );
};
