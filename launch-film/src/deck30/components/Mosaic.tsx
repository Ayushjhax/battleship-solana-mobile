/**
 * ★7 One becomes all — BitMitosis (1 → 4 → 16 → 64 → 256 on the 8ths) and MosaicLogo (the 256 sculpt themselves
 * into the logo), drawn on one <canvas> from preloaded atlases (scripts/deck30/mosaic.py → mosaic.data.json).
 *
 * The last stage's 32 x 8 grid IS the logo's pixel grid (cell = the logo's own bit), placed exactly over the logo
 * the film locks to, so "tiles outside the silhouette fall away" is literal: cells the logo covers keep their
 * tiles (they turn brand duotone and lock), the others fall. The top-right bit's cell stays empty and glowing.
 * Deterministic: Remotion's random(seed) only.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { continueRender, delayRender, interpolate, random, staticFile } from 'remotion';
import { EASE_IN, EASE_MOVE, clamp } from '../../trailer45/theme';
import M from '../mosaic.data.json';
import { LOGO, type LogoPlace } from './Logo';

type Rect = { x: number; y: number; w: number; h: number };
const STAGES = M.stages as [number, number][];
const GUTTER = [18, 12, 6, 3, 1.4];

/** the stage-4 grid over a logo placement (screen px) */
export const gridRect = (lg: LogoPlace): Rect => {
  const k = lg.w / LOGO.w;
  const top = lg.cy - (LOGO.h * k) / 2 + M.grid.oy * k;
  const cell = M.grid.cell * k;
  return { x: lg.cx - lg.w / 2, y: top, w: cell * M.grid.cols, h: cell * M.grid.rows };
};

/** the rect of tile (c, r) at stage s, inside the grid rect; stage 0 is one square in the middle */
export const cellRect = (g: Rect, s: number, c: number, r: number): Rect => {
  if (s === 0) return { x: g.x + g.w / 2 - g.h / 2, y: g.y, w: g.h, h: g.h };
  const [cols, rows] = STAGES[s];
  return { x: g.x + (c * g.w) / cols, y: g.y + (r * g.h) / rows, w: g.w / cols, h: g.h / rows };
};

const parentOf = (s: number, c: number, r: number) => (s === 1 ? [0, 0] : [Math.floor(c / 2), Math.floor(r / 2)]);
const INSIDE = new Set(M.inside.map(([c, r]) => `${c},${r}`));
const LIVE = new Set((M.live as number[][]).map(([c, r]) => `${c},${r}`));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });

type Assets = { color: HTMLImageElement; duo: HTMLImageElement; heroes: Map<number, HTMLImageElement> };
let assetsPromise: Promise<Assets> | null = null;
const loadAssets = () => {
  assetsPromise ??= Promise.all([
    loadImage(staticFile('deck30/mosaic/atlas_color.jpg')),
    loadImage(staticFile('deck30/mosaic/atlas_duo.png')),
    ...M.heroes.map((i) => loadImage(staticFile(`deck30/mosaic/hero_${i}.jpg`))),
  ]).then(([color, duo, ...hs]) => ({ color, duo, heroes: new Map(M.heroes.map((id, k) => [id, hs[k]])) }));
  return assetsPromise;
};

export type MosaicTiming = {
  /** local frames: when each stage lands (stage 0 = the bit has become one tile) */
  divisions: readonly number[];
  /** frames each division takes */
  divDur: number;
  /** the sculpt: outside tiles start falling, inside tiles turn duotone, everything locks */
  fallFrom: number;
  fallSpread: number;
  duoFrom: number;
  duoTo: number;
  lock: number;
};

const drawTile = (ctx: CanvasRenderingContext2D, a: Assets, id: number, rect: Rect, gut: number, duo: number, alpha: number, live: number) => {
  const AC = M.atlas.cols;
  const tileId = live >= 0 ? M.gif[live % M.gif.length] : id;
  const x = rect.x + gut / 2;
  const y = rect.y + gut / 2;
  const w = rect.w - gut;
  const h = rect.h - gut;
  if (w <= 0 || h <= 0) return;
  const hero = a.heroes.get(tileId);
  if (alpha * (1 - duo) > 0.004) {
    ctx.globalAlpha = alpha * (1 - duo);
    if (hero && w > 180) ctx.drawImage(hero, x, y, w, h);
    else ctx.drawImage(a.color, (tileId % AC) * M.atlas.color, Math.floor(tileId / AC) * M.atlas.color, M.atlas.color, M.atlas.color, x, y, w, h);
  }
  if (alpha * duo > 0.004) {
    ctx.globalAlpha = alpha * duo;
    ctx.drawImage(a.duo, (tileId % AC) * M.atlas.duo, Math.floor(tileId / AC) * M.atlas.duo, M.atlas.duo, M.atlas.duo, x, y, w, h);
  }
};

/**
 * The canvas. `t` = local frame; `lg` = where the logo will lock (the grid sits on it); `collapse` = the bit's
 * start (screen point it grows from).
 */
export const MosaicCanvas: React.FC<{ t: number; lg: LogoPlace; timing: MosaicTiming; from: { x: number; y: number }; maskToLogo?: boolean; fade?: number }> = ({
  t,
  lg,
  timing,
  from,
  maskToLogo = false,
  fade = 1,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [handle] = useState(() => delayRender('mosaic atlases'));
  useEffect(() => {
    loadAssets()
      .then((a) => {
        setAssets(a);
        continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        continueRender(handle);
      });
  }, [handle]);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !assets) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 1920, 1080);
    if (fade <= 0) return;
    ctx.imageSmoothingQuality = 'high';
    const g = gridRect(lg);
    const D = timing.divisions;
    // which stage, and how far into its division
    let s = 0;
    for (let k = 1; k < D.length; k++) if (t >= D[k]) s = k;
    const q = s === 0 ? 1 : EASE_IN(interpolate(t, [D[s], D[s] + timing.divDur], [0, 1], clamp));
    const grow = interpolate(t, [D[0] + 1, D[0] + 1 + timing.divDur], [0, 1], { ...clamp, easing: EASE_MOVE });
    const [cols, rows] = STAGES[s];
    const plan = M.plan[s] as number[][];
    const live = Math.floor(t / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = plan[r][c];
        let rect = cellRect(g, s, c, r);
        let alpha = fade;
        let gut = GUTTER[s];
        if (s === 0) {
          // the bit grows into the first tile
          const size = 26 + (rect.w - 26) * grow;
          const cx = from.x + (rect.x + rect.w / 2 - from.x) * grow;
          const cy = from.y + (rect.y + rect.h / 2 - from.y) * grow;
          rect = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
          gut = GUTTER[0] * grow;
        } else if (q < 1) {
          // daughters start inside their parent and move to their own place; gutters open up
          const [pc, pr] = parentOf(s, c, r);
          const p = cellRect(g, s - 1, pc, pr);
          const sub = s === 1 ? { x: p.x + p.w / 2 - rect.w / 2, y: p.y, w: rect.w, h: rect.h } : { x: p.x + (rect.x - p.x), y: p.y + (rect.y - p.y), w: rect.w, h: rect.h };
          rect = { x: sub.x + (rect.x - sub.x) * q, y: sub.y + (rect.y - sub.y) * q, w: rect.w, h: rect.h };
          gut = GUTTER[s - 1] + (GUTTER[s] - GUTTER[s - 1]) * q;
          if (s === 1) alpha *= interpolate(q, [0, 0.35], [0.4, 1], clamp);
        }
        let duo = 0;
        let rot = 0;
        if (s === STAGES.length - 1) {
          const key = `${c},${r}`;
          if (!INSIDE.has(key)) {
            const start = timing.fallFrom + random(`fall${key}`) * timing.fallSpread;
            const u = t - start;
            if (u > 0) {
              const dir = random(`fdir${key}`) - 0.5;
              rect = { ...rect, x: rect.x + dir * 9 * u, y: rect.y + 0.9 * u * u + 2 * u };
              rot = dir * 0.05 * u;
              alpha *= interpolate(u, [0, 14], [1, 0], clamp);
            }
          } else {
            duo = interpolate(t, [timing.duoFrom, timing.duoTo], [0, 1], clamp);
            // the lock: every tile settles a hair smaller, then snaps home on the downbeat
            const settle = interpolate(t, [timing.duoTo, timing.lock], [0, 1], { ...clamp, easing: EASE_MOVE });
            const k = 1 - 0.08 * settle + 0.08 * interpolate(t, [timing.lock, timing.lock + 3], [0, 1], { ...clamp, easing: EASE_IN });
            rect = { x: rect.x + (rect.w * (1 - k)) / 2, y: rect.y + (rect.h * (1 - k)) / 2, w: rect.w * k, h: rect.h * k };
          }
        }
        if (alpha <= 0.004) continue;
        const isLive = s >= 2 && LIVE.has(`${c},${r}`) && s === STAGES.length - 1;
        if (rot) {
          ctx.save();
          ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
          ctx.rotate(rot);
          drawTile(ctx, assets, id, { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h }, gut, duo, alpha, isLive ? live + c : -1);
          ctx.restore();
        } else {
          drawTile(ctx, assets, id, rect, gut, duo, alpha, isLive ? live + c : -1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }, [t, assets, lg.cx, lg.cy, lg.w, timing, from.x, from.y, fade]);
  const mask = `url(${staticFile(LOGO.maskNoBit)})`;
  const k = lg.w / LOGO.w;
  const maskStyle: React.CSSProperties = maskToLogo
    ? {
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskSize: `${lg.w}px ${LOGO.h * k}px`,
        maskSize: `${lg.w}px ${LOGO.h * k}px`,
        WebkitMaskPosition: `${lg.cx - lg.w / 2}px ${lg.cy - (LOGO.h * k) / 2}px`,
        maskPosition: `${lg.cx - lg.w / 2}px ${lg.cy - (LOGO.h * k) / 2}px`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }
    : {};
  return <canvas ref={ref} width={1920} height={1080} style={{ position: 'absolute', inset: 0, ...maskStyle }} />;
};

/** BitMitosis: the division stages only (no sculpt) — for previews and reuse. */
export const BitMitosis: React.FC<Omit<React.ComponentProps<typeof MosaicCanvas>, 'maskToLogo'>> = (p) => <MosaicCanvas {...p} />;
/** MosaicLogo: the same canvas, masked to the logo's letters once the tiles have locked. */
export const MosaicLogo: React.FC<React.ComponentProps<typeof MosaicCanvas>> = (p) => <MosaicCanvas {...p} />;
