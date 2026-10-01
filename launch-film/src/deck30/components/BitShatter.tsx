/**
 * BitShatter — the logo ⇄ its bits, both directions, on one <canvas>.
 *
 * The logo mask is cut into square pieces (CELL source px); a piece is kept when the logo covers >= 15 % of it.
 * Every piece has a home (its place in the logo on screen) and the caller decides, per frame, where each piece is:
 * `state(piece, home)` returns its centre, scale, opacity, rotation and how far it has turned into a "bit" (0 = the
 * logo's own ink texture, 1 = a solid glowing square). Helpers below give the three motions the film uses:
 * explode (a shockwave from a point blows the pieces out), assemble (scattered bits rush home and lock) and
 * collapse (everything pulls into one point). Deterministic: every random draw is Remotion's random(seed).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { continueRender, delayRender, interpolate, random, staticFile } from 'remotion';
import { C, EASE_IN, EASE_MOVE, clamp } from '../../trailer45/theme';
import { LOGO, logoToScreen, type LogoPlace } from './Logo';

export const CELL = 11; // source px per piece (the logo is 733 x 129)

export type Piece = { i: number; c: number; r: number; sx: number; sy: number; cov: number };
export type PieceState = { x: number; y: number; scale?: number; alpha?: number; rot?: number; bit?: number };
export type Home = { x: number; y: number; size: number };

type Loaded = { tinted: HTMLCanvasElement; pieces: Piece[] };
const cache = new Map<string, Promise<Loaded>>();

const load = (color: string): Promise<Loaded> => {
  const key = color;
  if (!cache.has(key)) {
    cache.set(
      key,
      new Promise<Loaded>((resolve, reject) => {
        const im = new Image();
        im.onload = () => {
          const S = LOGO.scale;
          const cv = document.createElement('canvas');
          cv.width = im.width;
          cv.height = im.height;
          const ctx = cv.getContext('2d')!;
          ctx.drawImage(im, 0, 0);
          const alpha = ctx.getImageData(0, 0, cv.width, cv.height).data;
          ctx.globalCompositeOperation = 'source-in';
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, cv.width, cv.height);
          const pieces: Piece[] = [];
          const cols = Math.ceil(LOGO.w / CELL);
          const rows = Math.ceil(LOGO.h / CELL);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              let sum = 0;
              let n = 0;
              for (let y = r * CELL * S; y < Math.min(cv.height, (r + 1) * CELL * S); y += 3) {
                for (let x = c * CELL * S; x < Math.min(cv.width, (c + 1) * CELL * S); x += 3) {
                  sum += alpha[(y * cv.width + x) * 4 + 3];
                  n++;
                }
              }
              const cov = n ? sum / n / 255 : 0;
              if (cov >= 0.15) pieces.push({ i: pieces.length, c, r, sx: (c + 0.5) * CELL, sy: (r + 0.5) * CELL, cov });
            }
          }
          resolve({ tinted: cv, pieces });
        };
        im.onerror = reject;
        im.src = staticFile(LOGO.maskNoBit);
      }),
    );
  }
  return cache.get(key)!;
};

export const BitShatter: React.FC<{
  lg: LogoPlace;
  state: (p: Piece, home: Home) => PieceState | null;
  color?: string;
  bitColor?: string;
  width?: number;
  height?: number;
}> = ({ lg, state, color = '#F5F5F7', bitColor = C.accent, width = 1920, height = 1080 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [handle] = useState(() => delayRender('BitShatter: logo mask'));
  useEffect(() => {
    load(color)
      .then((d) => {
        setData(d);
        continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        continueRender(handle);
      });
  }, [color, handle]);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !data) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const S = LOGO.scale;
    const k = lg.w / LOGO.w;
    ctx.imageSmoothingQuality = 'high';
    for (const p of data.pieces) {
      const h = logoToScreen(lg, p.sx, p.sy);
      const home = { x: h.x, y: h.y, size: CELL * k };
      const st = state(p, home);
      if (!st) continue;
      const a = st.alpha ?? 1;
      if (a <= 0.004) continue;
      const s = home.size * (st.scale ?? 1);
      const bit = Math.min(1, Math.max(0, st.bit ?? 0));
      ctx.save();
      ctx.translate(st.x, st.y);
      if (st.rot) ctx.rotate(st.rot);
      if (bit < 1) {
        ctx.globalAlpha = a * (1 - bit);
        // +0.6 px bleed so assembled pieces read as one solid logo
        ctx.drawImage(data.tinted, p.c * CELL * S, p.r * CELL * S, CELL * S, CELL * S, -s / 2 - 0.3, -s / 2 - 0.3, s + 0.6, s + 0.6);
      }
      if (bit > 0) {
        const q = s * (0.55 + 0.25 * p.cov);
        ctx.globalAlpha = a * bit;
        ctx.shadowColor = bitColor;
        ctx.shadowBlur = q * 1.6;
        ctx.fillStyle = (p.i % 3) === 0 ? '#E8E4FF' : bitColor;
        ctx.fillRect(-q / 2, -q / 2, q, q);
      }
      ctx.restore();
    }
  }, [data, state, lg.cx, lg.cy, lg.w, width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', inset: 0 }} />;
};

// ------------------------------------------------------------------------------------------------ motions

/** A shockwave from `origin` reaches each piece at |home - origin| / speed and blows it outward. */
export const explode =
  (t: number, origin: { x: number; y: number }, { speed = 95, push = 26, life = 22, seed = 'ex' } = {}) =>
  (p: Piece, home: Home): PieceState | null => {
    const dx = home.x - origin.x;
    const dy = home.y - origin.y;
    const dist = Math.hypot(dx, dy) || 1;
    const arrive = dist / speed;
    const u = t - arrive;
    if (u <= 0) return { x: home.x, y: home.y };
    const ang = Math.atan2(dy, dx) + (random(`${seed}a${p.i}`) - 0.5) * 0.9;
    const v = push * (0.55 + random(`${seed}v${p.i}`) * 0.9);
    const travel = v * 9 * (1 - Math.exp(-u / 9)); // fast out, dragging to a stop
    const lift = -0.06 * u * u; // a touch of rise, like debris in the blast
    return {
      x: home.x + Math.cos(ang) * travel,
      y: home.y + Math.sin(ang) * travel + lift,
      scale: 1 + 0.6 * Math.min(1, u / 8),
      rot: (random(`${seed}r${p.i}`) - 0.5) * 0.35 * u,
      alpha: interpolate(u, [0, life * (0.6 + random(`${seed}l${p.i}`) * 0.6)], [1, 0], clamp),
      bit: interpolate(u, [0, 5], [0, 1], clamp),
    };
  };

/** Where every bit floats while scattered (screen px), and its slow drift. */
export const scatterAt = (p: Piece, t: number, seed = 'sc') => {
  const x0 = 140 + random(`${seed}x${p.i}`) * 1640;
  const y0 = 120 + random(`${seed}y${p.i}`) * 840;
  const ang = random(`${seed}d${p.i}`) * Math.PI * 2;
  return { x: x0 + Math.cos(ang) * t * 0.35, y: y0 + Math.sin(ang) * t * 0.35 };
};

/** Scattered bits rush home: each starts within `spread` frames and takes `dur` frames; locks with a flare. */
export const assemble =
  (t: number, tScatter: number, { dur = 9, spread = 5, seed = 'sc', dim = 0.3 } = {}) =>
  (p: Piece, home: Home): PieceState | null => {
    const from = scatterAt(p, tScatter, seed);
    const start = random(`${seed}s${p.i}`) * spread;
    const q = interpolate(t, [start, start + dur], [0, 1], clamp);
    const e = EASE_IN(q);
    const twinkle = 0.7 + 0.3 * Math.sin(tScatter * 0.25 + p.i);
    return {
      x: from.x + (home.x - from.x) * e,
      y: from.y + (home.y - from.y) * e,
      scale: 0.9 + 0.1 * e,
      alpha: q <= 0 ? dim * twinkle : interpolate(q, [0, 0.3], [dim * twinkle, 1], clamp),
      bit: 1 - interpolate(q, [0.7, 1], [0, 1], clamp),
    };
  };

/** Everything pulls into one point (the bit) over `dur` frames. */
export const collapse =
  (t: number, target: { x: number; y: number }, { dur = 8, spread = 3, seed = 'co' } = {}) =>
  (p: Piece, home: Home): PieceState | null => {
    const start = random(`${seed}s${p.i}`) * spread;
    const q = interpolate(t, [start, start + dur], [0, 1], clamp);
    if (q >= 1) return null;
    const e = EASE_MOVE(q);
    return {
      x: home.x + (target.x - home.x) * e,
      y: home.y + (target.y - home.y) * e,
      scale: 1 - 0.6 * e,
      alpha: 1 - interpolate(q, [0.75, 1], [0, 1], clamp),
      bit: interpolate(q, [0, 0.4], [0, 1], clamp),
    };
  };
