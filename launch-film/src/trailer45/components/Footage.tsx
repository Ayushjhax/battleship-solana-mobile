/**
 * Gameplay footage on a camera. The recording is addressed in its own pixels
 * (1280 x 576) whatever the prepared file's size; `cam` keys are
 * [beat, x, y, zoom], zoom 1 = the recording just covers the viewport.
 * Camera moves ease in and out between keys. After `freezeAt` the picture holds.
 */
import { Video } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { EASE_MOVE, clamp } from '../theme';
import { FPS, f, type Shot } from '../timeline';

export const REC = { w: 1280, h: 576 } as const;

export type CamState = { x: number; y: number; scale: number; vw: number; vh: number };

/** Camera at a global frame: centre (recording px) and screen px per recording px. */
export const cameraAt = (shot: Shot, globalFrame: number, vw: number, vh: number): CamState => {
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
  /** viewport size (defaults to the full frame) */
  vw?: number;
  vh?: number;
  /** extra CSS filter on the picture (grade) */
  filter?: string;
};

/**
 * Must be rendered inside a <Sequence from={f(shot.from)}>: local frame 0 is the
 * shot's first frame.
 */
export const Footage: React.FC<Props> = ({ shot, vw = 1920, vh = 1080, filter }) => {
  const frame = useCurrentFrame();
  const g = f(shot.from) + frame;
  const cam = cameraAt(shot, g, vw, vh);
  const freezeLocal = shot.freezeAt === undefined ? null : f(shot.freezeAt) - f(shot.from);
  const style: React.CSSProperties = {
    position: 'absolute',
    left: vw / 2 - cam.x * cam.scale,
    top: vh / 2 - cam.y * cam.scale,
    width: REC.w * cam.scale,
    height: REC.h * cam.scale,
    filter,
  };
  // one segment per speed ramp; each is its own <Video> on the shot's clock
  const segs = [[shot.from, shot.in, shot.rate ?? 1] as const, ...(shot.ramps ?? [])];
  const video = (
    <>
      {segs.map(([b, inSec, rate], i) => {
        const from = f(b) - f(shot.from);
        const next = i + 1 < segs.length ? f(segs[i + 1][0]) - f(shot.from) : undefined;
        return (
          <Sequence key={i} from={from} durationInFrames={next === undefined ? undefined : next - from} layout="none">
            <Video src={staticFile(`media/${shot.src}.mp4`)} trimBefore={Math.round(inSec * FPS)} playbackRate={rate} muted style={style} />
          </Sequence>
        );
      })}
    </>
  );
  return (
    <AbsoluteFill style={{ overflow: 'hidden', width: vw, height: vh }}>
      {freezeLocal === null ? video : <Freeze frame={freezeLocal} active={frame >= freezeLocal}>{video}</Freeze>}
    </AbsoluteFill>
  );
};
