import { Video } from '@remotion/media';
import React from 'react';
import { Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { InkMarks } from '../components/Highlight';
import { FULL, gameXform, lighthouseOnScreen, motionBlur, trackAt, type Rect } from './cameraV2';
import { CLIPS, COLOR, INK_MARKS, LIGHTHOUSE, SHOTS_V2, SOURCE, VICTORY, type ShotV2, type TrackId } from './configV2';
import { inkBlob } from './ink';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The viewport the footage plays in: full frame, or the Victory card. */
export function viewportAt(frame: number): Rect {
  const t = smooth(interpolate(frame, VICTORY.settle, [0, 1], clamp));
  const c = VICTORY.card;
  return { x: lerp(FULL.x, c.x, t), y: lerp(FULL.y, c.y, t), w: lerp(FULL.w, c.w, t), h: lerp(FULL.h, c.h, t) };
}

const activeTrack = (frame: number): TrackId => (frame < 420 ? 'battle' : frame < 668 ? 'raid' : 'victory');

const ShotView: React.FC<{ shot: ShotV2 }> = ({ shot }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frame = shot.from + local;
  const clip = CLIPS[shot.clip];
  const vp = viewportAt(frame);
  const { s, tx, ty } = gameXform(shot.track, frame, vp);
  const edgeShadow = shot.track === 'battle' && frame > 320;

  const opacity = shot.fadeOutFrames
    ? interpolate(local, [shot.durationInFrames - shot.fadeOutFrames, shot.durationInFrames], [1, 0], clamp)
    : 1;

  const proxy: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SOURCE.w * clip.proxyScale,
    height: SOURCE.h * clip.proxyScale,
    transformOrigin: '0 0',
    transform: `scale(${1 / clip.proxyScale})`,
  };

  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: SOURCE.w,
          height: SOURCE.h,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          // the board as a sheet lying over the harbour, once its edge comes into view
          boxShadow: edgeShadow ? '0 0 18px 4px rgba(4,5,34,0.55)' : undefined,
        }}
      >
        {shot.holdStill ? (
          <Img src={staticFile(shot.holdStill)} style={proxy} />
        ) : (
          <Video
            src={staticFile(clip.src)}
            trimBefore={Math.round(shot.sourceStart * fps)}
            playbackRate={shot.rate}
            muted
            style={proxy}
          />
        )}
        {shot.track === 'battle' ? <InkMarks frame={frame} marks={INK_MARKS} /> : null}
      </div>
    </div>
  );
};

/** The real Victory banner, lifted off the result screen it sits on. */
const VictoryBanner: React.FC<{ frame: number; vp: Rect }> = ({ frame, vp }) => {
  if (frame < VICTORY.settle[0] || frame >= VICTORY.exit[1]) return null;
  const { s, tx, ty } = gameXform('victory', frame, vp);
  const b = VICTORY.onScreen;
  const x = vp.x + tx + b.x * s;
  const y = vp.y + ty + b.y * s;
  const w = b.w * s;
  const h = b.h * s;
  const lift = smooth(interpolate(frame, VICTORY.lift, [0, 1], clamp));
  const out = smooth(interpolate(frame, VICTORY.exit, [0, 1], clamp));
  const scale = 1 + (VICTORY.liftScale - 1) * lift;
  return (
    <Img
      src={staticFile(VICTORY.banner)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        transformOrigin: '50% 50%',
        transform: `translateY(${-VICTORY.liftRise * lift - 70 * out}px) scale(${scale})`,
        filter: `drop-shadow(0 ${16 * lift}px ${26 * lift}px rgba(0,0,24,${0.5 * lift}))`,
        opacity: 1 - out,
      }}
    />
  );
};

export const GameplayV2: React.FC<{ zIndex: number }> = ({ zIndex }) => {
  const frame = useCurrentFrame();
  if (frame >= VICTORY.exit[1]) return null;

  const vp = viewportAt(frame);
  const track = activeTrack(frame);
  const cam = trackAt(track, frame);
  const blur = motionBlur(track, frame, vp);
  const out = smooth(interpolate(frame, VICTORY.exit, [0, 1], clamp));
  const card = interpolate(frame, VICTORY.settle, [0, 1], clamp);

  // ink bloom: a hole in the board, opening from its lighthouse
  const [b0, b1, b2] = LIGHTHOUSE.bloom.frames;
  let clipPath: string | undefined;
  if (frame >= b0 && frame <= b2) {
    const [, r1, r2] = LIGHTHOUSE.bloom.radius;
    const r =
      frame < b1
        ? r1 * (1 - Math.pow(1 - (frame - b0) / (b1 - b0), 2))
        : r1 + (r2 - r1) * Math.pow((frame - b1) / (b2 - b1), 1.7);
    const c = lighthouseOnScreen(frame);
    const hole = inkBlob(c.x, c.y, r, frame);
    clipPath = `polygon(evenodd, 0px 0px, ${FULL.w}px 0px, ${FULL.w}px ${FULL.h}px, 0px ${FULL.h}px, 0px 0px, ${hole
      .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
      .join(', ')})`;
  }
  const boardGone = frame > b2 && frame < 480;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex, clipPath }}>
      {blur.x + blur.y > 0.3 ? (
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id="v2-motion" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation={`${blur.x.toFixed(2)} ${blur.y.toFixed(2)}`} />
          </filter>
        </svg>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: vp.x,
          top: vp.y,
          width: vp.w,
          height: vp.h,
          perspective: 3200,
          opacity: 1 - out,
          transform: `scale(${1 - 0.06 * out})`,
          transformOrigin: '50% 50%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            borderRadius: VICTORY.card.radius * card,
            background: COLOR.sheet,
            boxShadow:
              card > 0
                ? `0 70px 160px rgba(0,0,12,${0.6 * card}), 0 0 0 ${5 * card}px rgba(253,250,243,0.9)`
                : undefined,
            // overscan while tilted so the sheet's far edge never pulls inside the frame
            transform:
              cam.rx || cam.ry
                ? `rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) scale(${1 + 0.012 * Math.abs(cam.ry) + 0.008 * Math.abs(cam.rx)})`
                : undefined,
            filter: blur.x + blur.y > 0.3 ? 'url(#v2-motion)' : undefined,
            visibility: boardGone ? 'hidden' : 'visible',
          }}
        >
          {SHOTS_V2.map((shot, i) => (
            <Sequence key={shot.id} from={shot.from} durationInFrames={shot.durationInFrames} layout="none" name={shot.id}>
              <div style={{ position: 'absolute', inset: 0, zIndex: SHOTS_V2.length - i }}>
                <ShotView shot={shot} />
              </div>
            </Sequence>
          ))}
        </div>
      </div>
      <VictoryBanner frame={frame} vp={vp} />
    </div>
  );
};
