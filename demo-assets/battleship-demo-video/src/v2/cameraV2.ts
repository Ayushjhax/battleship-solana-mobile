import { monotoneCubic } from '../lib/camera';
import {
  LIGHTHOUSE,
  MOTION_BLUR,
  PORT,
  PORT_V2,
  SOURCE,
  TRACKS,
  UNCLAMP,
  VIDEO,
  type KeyV2,
  type TrackId,
} from './configV2';

export interface Xform {
  /** screen = t + s · p */
  s: number;
  tx: number;
  ty: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: Rect = { x: 0, y: 0, w: VIDEO.width, h: VIDEO.height };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** One parameter of a track, interpolated only over the keys that set it. */
function channel(keys: readonly KeyV2[], pick: (k: KeyV2) => number | undefined, frame: number, fallback = 0) {
  const set = keys.filter((k) => pick(k) !== undefined);
  if (!set.length) return fallback;
  return monotoneCubic(set.map((k) => k.frame), set.map((k) => pick(k) as number), frame);
}

export function trackAt(id: TrackId, frame: number) {
  const { keys, punches } = TRACKS[id];
  let zoom = Math.exp(channel(keys, (k) => Math.log(k.zoom), frame));
  for (const p of punches) {
    const t = (frame - p.frame) / p.settle;
    if (t >= 0 && t < 1) zoom *= 1 + p.amount * Math.pow(1 - t, 3);
  }
  return {
    zoom,
    x: channel(keys, (k) => k.x, frame),
    y: channel(keys, (k) => k.y, frame),
    rx: channel(keys, (k) => k.rx, frame),
    ry: channel(keys, (k) => k.ry, frame),
  };
}

/**
 * Put content (cw × ch) in a viewport so (x, y) sits at the centre, at
 * cover × zoom. `clampAmount` 1 keeps the content covering the viewport; 0
 * lets the camera pass the content's edge.
 */
export function frame2d(
  cam: { zoom: number; x: number; y: number },
  cw: number,
  ch: number,
  vw: number,
  vh: number,
  clampAmount = 1,
): Xform {
  const s = Math.max(vw / cw, vh / ch) * cam.zoom;
  let tx = vw / 2 - cam.x * s;
  let ty = vh / 2 - cam.y * s;
  const cx = Math.min(0, Math.max(vw - cw * s, tx));
  const cy = Math.min(0, Math.max(vh - ch * s, ty));
  tx += (cx - tx) * clampAmount;
  ty += (cy - ty) * clampAmount;
  return { s, tx, ty };
}

// ---------------------------------------------------------------------------
// Port City geometry (map px), shared with the harbour layer.
// ---------------------------------------------------------------------------

export const MAP = PORT.map;
export const PORT_COVER = Math.max(VIDEO.width / MAP.w, VIDEO.height / MAP.h);

/** Height-parallax exponent for a building standing at map depth y. */
export const parallaxExp = (y: number) => PORT_V2.parallax.base + PORT_V2.parallax.depth * (y / MAP.h);

/** How much a building at depth y stands up at a given harbour zoom. */
export const liftAt = (zoom: number, y: number) => Math.pow(Math.max(zoom, 1), parallaxExp(y));

const LH = PORT.buildings.find((b) => b.id === 'lighthouse')!;
const LH_ART_TO_MAP = LH.w / LH.art[0];
const LH_TOP = LH.y - (LH.w * LH.art[1]) / LH.art[0];
/** Lighthouse tower centre and height in map px (before lift). */
const LH_ANCHOR = {
  x: LH.x - LH.w / 2 + LIGHTHOUSE.art.x * LH_ART_TO_MAP,
  y: LH_TOP + LIGHTHOUSE.art.y * LH_ART_TO_MAP,
  h: LIGHTHOUSE.art.h * LH_ART_TO_MAP,
};

function lighthouseOnMap(zoom: number) {
  const L = liftAt(zoom, LH.y);
  return {
    x: LH.x + (LH_ANCHOR.x - LH.x) * L,
    y: LH.y + (LH_ANCHOR.y - LH.y) * L,
    h: LH_ANCHOR.h * L,
  };
}

// ---------------------------------------------------------------------------
// The battle camera and the harbour camera hand over at the lighthouse.
// ---------------------------------------------------------------------------

const unclampAt = (frame: number) => 1 - smooth(clamp01((frame - UNCLAMP[0]) / (UNCLAMP[1] - UNCLAMP[0])));

function battleFromKeys(frame: number): Xform {
  return frame2d(trackAt('battle', frame), SOURCE.w, SOURCE.h, FULL.w, FULL.h, unclampAt(frame));
}

/** The harbour placed so its lighthouse sits exactly on the board's. */
function portUnderBoard(board: Xform): Xform & { zoom: number } {
  const gx = board.tx + LIGHTHOUSE.game.x * board.s;
  const gy = board.ty + LIGHTHOUSE.game.y * board.s;
  const hScreen = LIGHTHOUSE.game.h * board.s;
  // tower height on screen = LH_ANCHOR.h · zoom^p · cover · zoom
  const p = parallaxExp(LH.y);
  const zoom = Math.pow(hScreen / (LH_ANCHOR.h * PORT_COVER), 1 / (1 + p));
  const s = PORT_COVER * zoom;
  const a = lighthouseOnMap(zoom);
  return { s, tx: gx - a.x * s, ty: gy - a.y * s, zoom };
}

/** The board placed so its lighthouse sits exactly on the harbour's. */
function boardOverPort(port: Xform & { zoom: number }): Xform {
  const a = lighthouseOnMap(port.zoom);
  const px = port.tx + a.x * port.s;
  const py = port.ty + a.y * port.s;
  const s = (a.h * port.s) / LIGHTHOUSE.game.h;
  return { s, tx: px - LIGHTHOUSE.game.x * s, ty: py - LIGHTHOUSE.game.y * s };
}

const M = LIGHTHOUSE.match;
const matchPort = portUnderBoard(battleFromKeys(M));
/** The harbour's camera keys, starting from the solved match. */
const matchKey = {
  frame: M,
  zoom: matchPort.zoom,
  x: (FULL.w / 2 - matchPort.tx) / matchPort.s,
  y: (FULL.h / 2 - matchPort.ty) / matchPort.s,
};
const nextKey = PORT_V2.keys[0];
/** Ease out of the match: the pull-back continues at the board's pace, then opens up. */
const leadIn = {
  frame: M + 10,
  zoom: matchPort.zoom * Math.exp(-0.04),
  x: matchKey.x + (nextKey.x - matchKey.x) * 0.08,
  y: matchKey.y + (nextKey.y - matchKey.y) * 0.08,
};
const PORT_KEYS = [matchKey, leadIn, ...PORT_V2.keys];

export function portXform(frame: number): Xform & { zoom: number } {
  if (frame < M) return portUnderBoard(battleFromKeys(frame));
  const f = PORT_KEYS.map((k) => k.frame);
  const zoom = Math.exp(monotoneCubic(f, PORT_KEYS.map((k) => Math.log(k.zoom)), frame));
  const x = monotoneCubic(f, PORT_KEYS.map((k) => k.x), frame);
  const y = monotoneCubic(f, PORT_KEYS.map((k) => k.y), frame);
  return { ...frame2d({ zoom, x, y }, MAP.w, MAP.h, FULL.w, FULL.h, 1), zoom };
}

/** Screen transform of the recording for a track at a frame, inside a viewport. */
export function gameXform(track: TrackId, frame: number, viewport: Rect = FULL): Xform {
  if (track === 'battle') return frame > M ? boardOverPort(portXform(frame)) : battleFromKeys(frame);
  return frame2d(trackAt(track, frame), SOURCE.w, SOURCE.h, viewport.w, viewport.h, 1);
}

/** Where the board's lighthouse is on screen (the ink bloom's centre). */
export function lighthouseOnScreen(frame: number) {
  const b = gameXform('battle', frame);
  return { x: b.tx + LIGHTHOUSE.game.x * b.s, y: b.ty + LIGHTHOUSE.game.y * b.s, h: LIGHTHOUSE.game.h * b.s };
}

/** Directional blur (stdDeviation x, y in screen px) from how fast the camera pans. */
export function motionBlur(track: TrackId, frame: number, viewport: Rect = FULL): { x: number; y: number } {
  if (frame < 1) return { x: 0, y: 0 };
  const now = gameXform(track, frame, viewport);
  const before = gameXform(track, frame - 1, viewport);
  // the recording point at the viewport centre now, and where it was a frame ago
  const cx = (viewport.w / 2 - now.tx) / now.s;
  const cy = (viewport.h / 2 - now.ty) / now.s;
  const vx = viewport.w / 2 - (before.tx + cx * before.s);
  const vy = viewport.h / 2 - (before.ty + cy * before.s);
  const f = (v: number) => Math.min(MOTION_BLUR.max, Math.max(0, (Math.abs(v) - MOTION_BLUR.threshold) * MOTION_BLUR.gain));
  return { x: f(vx), y: f(vy) };
}
