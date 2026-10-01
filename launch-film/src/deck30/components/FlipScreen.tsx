/**
 * FlipScreen — one floating glass screen that flips (rotateY, half a turn each time) and lands face-on exactly on
 * each landing frame. Faces swap at 90°, so no backface tricks are needed; a sheen crosses the glass as it turns,
 * and the flip frames get camera motion blur (and only those frames).
 *
 * Must be rendered inside a Sequence; `landings` are local frames (landings[0] is when face 0 is already face-on).
 * Each face is a function of the frames since it landed (negative while it is turning in).
 */
import { CameraMotionBlur } from '@remotion/motion-blur';
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { Glass } from '../../trailer45/components/Frames';
import { EASE_MOVE, clamp } from '../../trailer45/theme';

type Box = { x: number; y: number; w: number; h: number };

export const flipState = (frame: number, landings: readonly number[], flipFrames: number) => {
  let total = 0;
  let face = 0;
  let turning = 0;
  for (let k = 1; k < landings.length; k++) {
    const q = interpolate(frame, [landings[k] - flipFrames, landings[k]], [0, 1], clamp);
    total += 180 * EASE_MOVE(q);
    if (frame >= landings[k] - flipFrames / 2) face = k;
    if (q > 0 && q < 1) turning = Math.sin(Math.PI * q);
  }
  return { angle: total - 180 * face, face, turning };
};

const FlipInner: React.FC<{
  box: Box;
  landings: readonly number[];
  flipFrames: number;
  faces: readonly ((since: number) => React.ReactNode)[];
  scale?: number;
  radius?: number;
}> = ({ box, landings, flipFrames, faces, scale = 1, radius = 26 }) => {
  const frame = useCurrentFrame();
  const { angle, face, turning } = flipState(frame, landings, flipFrames);
  const since = frame - landings[face];
  const sheen = interpolate(angle, [-90, 90], [130, -30]);
  // every landing: a 4-frame punch and a specular glint racing across the glass
  const punch = since >= 0 ? 1 + 0.035 * interpolate(since, [0, 4], [1, 0], clamp) : 1;
  const glint = interpolate(since, [0, 7], [-0.25, 1.25], clamp);
  const glintA = since >= 0 && since < 8 ? interpolate(since, [0, 1, 7], [0.2, 0.75, 0], clamp) : 0;
  return (
    <div style={{ position: 'absolute', inset: 0, scale: String(scale), transformOrigin: `${box.x + box.w / 2}px ${box.y + box.h / 2}px` }}>
      <Glass
        box={box}
        radius={radius}
        style={{ transform: `perspective(2400px) rotateY(${angle}deg) scale(${(1 - 0.07 * turning) * punch})`, transformOrigin: '50% 50%' }}
      >
        {faces[face](since)}
        {glintA > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(115deg, rgba(255,255,255,0) ${glint * 100 - 10}%, rgba(255,255,255,${glintA}) ${glint * 100}%, rgba(200,190,255,${glintA * 0.4}) ${glint * 100 + 3}%, rgba(255,255,255,0) ${glint * 100 + 10}%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
        {turning > 0.01 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(105deg, rgba(255,255,255,0) ${sheen - 25}%, rgba(255,255,255,${0.35 * turning}) ${sheen}%, rgba(255,255,255,0) ${sheen + 25}%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
      </Glass>
    </div>
  );
};

export const FlipScreen: React.FC<React.ComponentProps<typeof FlipInner>> = (props) => {
  const frame = useCurrentFrame();
  const flipping = props.landings.slice(1).some((l) => frame > l - props.flipFrames - 1 && frame < l + 1);
  const inner = <FlipInner {...props} />;
  return flipping ? (
    <CameraMotionBlur shutterAngle={200} samples={6}>
      {inner}
    </CameraMotionBlur>
  ) : (
    inner
  );
};
