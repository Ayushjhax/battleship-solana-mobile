import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';

/** The game's FX strips (assets/fx), 6 frames each, upscaled 4× into public/art/fx4. */
export const FX = {
  explosionAtomic: {file: 'art/fx4/explosion-atomic.png', frames: 6, w: 1536 * 4, h: 256 * 4},
  explosionFire: {file: 'art/fx4/explosion-fire.png', frames: 6, w: 1200 * 4, h: 186 * 4},
  explosionInk: {file: 'art/fx4/explosion-ink.png', frames: 6, w: 1200 * 4, h: 157 * 4},
  radar: {file: 'art/fx4/radar.png', frames: 6, w: 1416 * 4, h: 256 * 4},
  submarine: {file: 'art/fx4/submarine.png', frames: 6, w: 1200 * 4, h: 190 * 4},
  mine: {file: 'art/fx4/mine.png', frames: 6, w: 1200 * 4, h: 192 * 4},
  turret: {file: 'art/fx4/turret.png', frames: 6, w: 1152 * 4, h: 200 * 4},
  splash: {file: 'art/fx4/splash.png', frames: 6, w: 1200 * 4, h: 144 * 4},
  smoke: {file: 'art/fx4/smoke.png', frames: 6, w: 1200 * 4, h: 173 * 4},
} as const;
export type FxName = keyof typeof FX;

/**
 * Plays a strip like the game's src/fx/Sprite.tsx: slides the strip under a clip, one cell
 * per `hold` frames (the game runs its strips at ~12 fps → hold 2–3 at 30 fps).
 */
export const FxSprite: React.FC<{
  fx: FxName;
  at: number;
  /** displayed cell height in px */
  size: number;
  hold?: number;
  loop?: boolean;
  /** hold the last cell after the run */
  holdLast?: boolean;
  style?: React.CSSProperties;
}> = ({fx, at, size, hold = 3, loop = false, holdLast = false, style}) => {
  const frame = useCurrentFrame();
  const d = FX[fx];
  const cellW = d.w / d.frames;
  const scale = size / d.h;
  let i = Math.floor((frame - at) / hold);
  if (frame < at) return null;
  if (loop) i = i % d.frames;
  else if (i >= d.frames) {
    if (!holdLast) return null;
    i = d.frames - 1;
  }
  return (
    <div style={{width: cellW * scale, height: size, overflow: 'hidden', position: 'relative', ...style}}>
      <Img
        src={staticFile(d.file)}
        style={{position: 'absolute', left: -i * cellW * scale, top: 0, width: d.w * scale, height: size, maxWidth: 'none'}}
      />
    </div>
  );
};
