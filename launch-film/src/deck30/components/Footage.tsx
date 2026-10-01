/**
 * Deck30 footage on a camera — the trailer's Footage (src/trailer45/components/Footage.tsx) on Deck30's grid,
 * with shots written in SOURCE seconds (MEDIA[src].start is subtracted here) and a poster hold.
 *
 * Cameras address the recording in its own pixels (1280 x 576) whatever the prepared plate's size; keys are
 * [beat, x, y, zoom], zoom 1 = the recording just covers the viewport. Moves ease in and out between keys.
 */
import { Video } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { EASE_MOVE, clamp } from '../../trailer45/theme';
import { FPS, MEDIA, f, type MediaId, type Shot } from '../timeline';

export const REC = { w: 1280, h: 576 } as const;

export type CamState = { x: number; y: number; scale: number; vw: number; vh: number };

export const mediaUrl = (src: MediaId) => staticFile(`deck30/media/${src}.mp4`);
/** frames to skip in the prepared file to start at a source second */
export const trimFor = (src: MediaId, sourceSec: number) => Math.max(0, Math.round((sourceSec - MEDIA[src].start) * FPS));

/** Camera at a global frame: centre (recording px) and screen px per recording px. */
export const cameraAt = (shot: Pick<Shot, 'cam'>, globalFrame: number, vw: number, vh: number): CamState => {
  const keys = shot.cam;
  const frames = keys.map((k) => f(k[0]));
  const pick = (i: 1 | 2 | 3) =>
    keys.length === 1 ? keys[0][i] : interpolate(globalFrame, frames, keys.map((k) => k[i]), { ...clamp, easing: EASE_MOVE });
  const zoom = pick(3);
  const scale = Math.max(vw / REC.w, vh / REC.h) * zoom;
  const hx = vw / 2 / scale;
  const hy = vh / 2 / scale;
  const x = hx * 2 >= REC.w ? REC.w / 2 : Math.min(Math.max(pick(1), hx), REC.w - hx);
  const y = hy * 2 >= REC.h ? REC.h / 2 : Math.min(Math.max(pick(2), hy), REC.h - hy);
  return { x, y, scale, vw, vh };
};

/** Where a recording pixel lands on screen for a camera state. */
export const toScreen = (cam: CamState, rx: number, ry: number) => ({
  x: cam.vw / 2 + (rx - cam.x) * cam.scale,
  y: cam.vh / 2 + (ry - cam.y) * cam.scale,
});

type Props = {
  shot: Shot;
  vw?: number;
  vh?: number;
  filter?: string;
  /** film beat: until then the shot's first frame is held (the poster); playback starts on it */
  holdUntil?: number;
};

/** Must be rendered inside a <Sequence from={f(shot.from)}>: local frame 0 is the shot's first frame. */
export const Footage: React.FC<Props> = ({ shot, vw = 1920, vh = 1080, filter, holdUntil }) => {
  const frame = useCurrentFrame();
  const g = f(shot.from) + frame;
  const cam = cameraAt(shot, g, vw, vh);
  const start = holdUntil ?? shot.from;
  const hold = f(start) - f(shot.from);
  const freezeLocal = shot.freezeAt === undefined ? null : f(shot.freezeAt) - f(shot.from);
  const style: React.CSSProperties = {
    position: 'absolute',
    left: vw / 2 - cam.x * cam.scale,
    top: vh / 2 - cam.y * cam.scale,
    width: REC.w * cam.scale,
    height: REC.h * cam.scale,
    filter,
  };
  const segs = [[start, shot.in, shot.rate ?? 1] as const, ...(shot.ramps ?? [])];
  const video = (
    <>
      {segs.map(([b, inSec, rate], i) => {
        const from = f(b) - f(shot.from);
        const next = i + 1 < segs.length ? f(segs[i + 1][0]) - f(shot.from) : undefined;
        return (
          <Sequence key={i} from={from} durationInFrames={next === undefined ? undefined : next - from} layout="none">
            <Video src={mediaUrl(shot.src)} trimBefore={trimFor(shot.src, inSec)} playbackRate={rate} muted style={style} />
          </Sequence>
        );
      })}
    </>
  );
  const frozenAt = hold > 0 && frame < hold ? hold : freezeLocal !== null && frame >= freezeLocal ? freezeLocal : null;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', width: vw, height: vh }}>
      <Freeze frame={frozenAt ?? 0} active={frozenAt !== null}>
        {video}
      </Freeze>
    </AbsoluteFill>
  );
};

/** A UI capture (1920 x 862 prepared) filling its box, playing from a source second, with a slow push. */
export const UiClip: React.FC<{ clip: { src: MediaId; in: number }; dur: number; push?: [number, number]; freezeAfter?: number; position?: string }> = ({
  clip,
  dur,
  push = [1.0, 1.04],
  freezeAfter,
  position = '50% 50%',
}) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, dur], push, clamp);
  const v = (
    <Video
      src={mediaUrl(clip.src)}
      trimBefore={trimFor(clip.src, clip.in)}
      muted
      style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', objectPosition: position, scale: String(s) }}
    />
  );
  if (freezeAfter === undefined) return v;
  return (
    <Freeze frame={freezeAfter} active={frame >= freezeAfter}>
      {v}
    </Freeze>
  );
};
