import { Video } from '@remotion/media';
import React from 'react';
import { Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { CAMERA, CLIPS, COLOR, END_CARD, SHOTS, SOURCE, WINDOW, type Shot } from '../config';
import { cameraAt, framing } from '../lib/camera';
import { Highlights } from './Highlight';

/** One recording, trimmed and framed by its camera track. */
const ShotView: React.FC<{ shot: Shot }> = ({ shot }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frame = shot.from + local;
  const clip = CLIPS[shot.clip];
  const track = CAMERA[shot.camera];
  const cam = cameraAt(track.keys, track.punches, frame);
  const { scale, tx, ty } = framing(cam, SOURCE.w, SOURCE.h, WINDOW.w, WINDOW.h);

  const opacity = shot.fadeOutFrames
    ? interpolate(local, [shot.durationInFrames - shot.fadeOutFrames, shot.durationInFrames], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  const proxyStyle: React.CSSProperties = {
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
      {/* recording-pixel space: 1280 × 576, placed by the camera */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: SOURCE.w,
          height: SOURCE.h,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        {shot.holdStill ? (
          <Img src={staticFile(shot.holdStill)} style={proxyStyle} />
        ) : (
          <Video
            src={staticFile(clip.src)}
            trimBefore={Math.round(shot.sourceStart * fps)}
            playbackRate={shot.rate}
            muted
            style={proxyStyle}
          />
        )}
        {shot.camera === 'battle' && frame < 40 ? <Highlights frame={frame} /> : null}
      </div>
    </div>
  );
};

/** The window the game plays in, above the stage. */
export const Gameplay: React.FC = () => {
  const frame = useCurrentFrame();
  const [outStart, outEnd] = END_CARD.windowOut;
  const out = interpolate(frame, [outStart, outEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => t * t * (3 - 2 * t),
  });
  if (out >= 1) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: WINDOW.x,
        top: WINDOW.y,
        width: WINDOW.w,
        height: WINDOW.h,
        borderRadius: WINDOW.radius,
        overflow: 'hidden',
        background: COLOR.sheet,
        boxShadow: '0 70px 160px rgba(0,0,12,0.6), 0 0 0 5px rgba(253,250,243,0.9)',
        opacity: 1 - out,
        transform: `scale(${1 - 0.06 * out})`,
        transformOrigin: '50% 50%',
      }}
    >
      {SHOTS.map((shot, i) => (
        <Sequence
          key={shot.id}
          from={shot.from}
          durationInFrames={shot.durationInFrames}
          layout="none"
          name={shot.id}
        >
          {/* earlier shots sit above later ones so a fade-out reveals the next */}
          <div style={{ position: 'absolute', inset: 0, zIndex: SHOTS.length - i }}>
            <ShotView shot={shot} />
          </div>
        </Sequence>
      ))}
    </div>
  );
};
