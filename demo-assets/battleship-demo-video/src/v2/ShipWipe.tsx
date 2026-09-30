import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';

import { SHIP_WIPE } from './configV2';

const smooth = (t: number) => t * t * (3 - 2 * t);
const SHIP_H = (SHIP_WIPE.width * 496) / 1440;

/** Ship centre x on screen: close to constant speed, eased at the ends. */
export function shipX(frame: number): number {
  const [f0, f1] = SHIP_WIPE.frames;
  const p = Math.min(1, Math.max(0, (frame - f0) / (f1 - f0)));
  return SHIP_WIPE.fromX + (SHIP_WIPE.toX - SHIP_WIPE.fromX) * (0.8 * p + 0.2 * smooth(p));
}

/** The line the battle is revealed up to: under the ship's after third. */
export const wakeLine = (frame: number) => shipX(frame) - SHIP_WIPE.width * 0.2;

export const wipeActive = (frame: number) => frame >= SHIP_WIPE.frames[0] && frame <= SHIP_WIPE.frames[1];

/**
 * The fleet battleship crosses close to the camera, left to right — the way
 * the harbour camera is drifting and the way the bomber will fly — and the
 * battle is revealed in its wake.
 */
export const ShipWipe: React.FC = () => {
  const frame = useCurrentFrame();
  if (!wipeActive(frame)) return null;
  const x = shipX(frame);
  const wake = wakeLine(frame);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      {/* foam along the reveal line, trailing into the battle */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: wake - 260,
          width: 300,
          background:
            'linear-gradient(90deg, rgba(251,252,254,0) 0%, rgba(251,252,254,0.55) 70%, rgba(251,252,254,0.9) 88%, rgba(251,252,254,0.2) 100%)',
          filter: 'blur(6px)',
        }}
      />
      <Img
        src={staticFile(SHIP_WIPE.src)}
        style={{
          position: 'absolute',
          left: x - SHIP_WIPE.width / 2,
          top: SHIP_WIPE.y - SHIP_H / 2,
          width: SHIP_WIPE.width,
          height: SHIP_H,
          filter: `blur(${SHIP_WIPE.blur}px) drop-shadow(0 40px 50px rgba(0,0,30,0.45))`,
        }}
      />
    </div>
  );
};
