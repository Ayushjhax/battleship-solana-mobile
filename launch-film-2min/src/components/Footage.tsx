import {Video} from '@remotion/media';
import React from 'react';
import {Sequence, staticFile} from 'remotion';
import {CLIPS, FPS, type ClipName, type Shot} from '../config/timeline';

const fileFrame = (clip: ClipName, sourceSec: number) =>
  Math.max(0, Math.round((sourceSec - CLIPS[clip].fileOffset) * FPS));

type Fit = 'cover' | 'contain' | 'fill';

/**
 * Plays a Shot (clip + source-second in-point + rate) from frame 0 of the enclosing Sequence.
 * Prepared files hold their last frame for 10 s, so a shot may run past the recording.
 */
export const Footage: React.FC<{shot: Shot; fit?: Fit; style?: React.CSSProperties}> = ({shot, fit = 'cover', style}) => (
  <Video
    src={staticFile(CLIPS[shot.clip].file)}
    trimBefore={fileFrame(shot.clip, shot.from)}
    playbackRate={shot.rate ?? 1}
    muted
    objectFit={fit}
    style={{width: '100%', height: '100%', ...style}}
  />
);

/** A frozen frame of a clip at a source second (freeze-frame + push-in instead of choppy slow-mo). */
export const Freeze: React.FC<{clip: ClipName; at: number; fit?: Fit; style?: React.CSSProperties}> = ({clip, at, fit = 'cover', style}) => (
  <Video
    src={staticFile(CLIPS[clip].file)}
    trimBefore={fileFrame(clip, at)}
    playbackRate={0.0001}
    muted
    objectFit={fit}
    style={{width: '100%', height: '100%', ...style}}
  />
);

export type RampSegment = {
  /** source seconds */
  from: number;
  to: number;
  /** playback rate; 0 = hold `from` for `holdFrames` */
  rate: number;
  holdFrames?: number;
};

/** Frames a ramp occupies on the timeline. */
export const rampFrames = (segs: RampSegment[]) =>
  segs.reduce((n, s) => n + (s.rate === 0 ? s.holdFrames ?? 0 : Math.round(((s.to - s.from) * FPS) / s.rate)), 0);

/**
 * SpeedRamp: consecutive segments of one clip at different rates. Speed-ups compress the
 * travel, 1× lands the impact, rate 0 freezes. Never below 1× on 30 fps sources.
 */
export const SpeedRamp: React.FC<{clip: ClipName; segments: RampSegment[]; fit?: Fit; style?: React.CSSProperties}> = ({
  clip,
  segments,
  fit = 'cover',
  style,
}) => {
  let t = 0;
  return (
    <>
      {segments.map((s, i) => {
        const len = s.rate === 0 ? s.holdFrames ?? 0 : Math.round(((s.to - s.from) * FPS) / s.rate);
        const from = t;
        t += len;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, len)} layout="none">
            {s.rate === 0 ? (
              <Freeze clip={clip} at={s.from} fit={fit} style={style} />
            ) : (
              <Footage shot={{clip, at: 0, beats: 0, from: s.from, rate: s.rate}} fit={fit} style={style} />
            )}
          </Sequence>
        );
      })}
    </>
  );
};
