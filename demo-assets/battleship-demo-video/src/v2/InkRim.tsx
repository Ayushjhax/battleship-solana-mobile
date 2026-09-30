import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { lighthouseOnScreen } from './cameraV2';
import { COLOR, LIGHTHOUSE } from './configV2';
import { blobPath, inkBlob } from './ink';

/**
 * The wet edge of the ink bloom: a band of the game's ink just outside the
 * hole, thinning as it spreads. Same radius curve as the hole in GameplayV2.
 */
export const InkRim: React.FC = () => {
  const frame = useCurrentFrame();
  const [b0, b1, b2] = LIGHTHOUSE.bloom.frames;
  if (frame < b0 || frame > b2) return null;
  const [, r1, r2] = LIGHTHOUSE.bloom.radius;
  const r =
    frame < b1
      ? r1 * (1 - Math.pow(1 - (frame - b0) / (b1 - b0), 2))
      : r1 + (r2 - r1) * Math.pow((frame - b1) / (b2 - b1), 1.7);
  const width = 24 + 60 * Math.min(1, r / 900) * (1 - Math.min(1, (r - 900) / 3000));
  const c = lighthouseOnScreen(frame);
  const inner = inkBlob(c.x, c.y, r, frame);
  const outer = inkBlob(c.x, c.y, r + width, frame + 3);
  const fade = frame > b2 - 4 ? (b2 - frame) / 4 : 1;

  return (
    <AbsoluteFill style={{ zIndex: 30, pointerEvents: 'none' }}>
      <svg width="100%" height="100%" viewBox="0 0 3840 2160">
        <defs>
          <filter id="ink-soft" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path
          d={`${blobPath(outer)} ${blobPath(inner)}`}
          fillRule="evenodd"
          fill={COLOR.cityInk}
          opacity={0.88 * fade}
          filter="url(#ink-soft)"
        />
        <path d={blobPath(inner)} fill="none" stroke="#05062C" strokeWidth={5} opacity={0.6 * fade} />
      </svg>
    </AbsoluteFill>
  );
};
