/**
 * The React-free half of useRough: the generator, the seed hash and the path
 * cache. Kept separate so its two guarantees can be proven under plain Node:
 *
 *  1. Seeds are DETERMINISTIC — hashString(key) never touches Math.random,
 *     and the same (shape, dims, seed, opts) always yields the same paths.
 *  2. Paths are generated at most once per (shape, dims, seed, opts) and then
 *     served from the cache. Regenerating on each render is the number one
 *     perf mistake with roughjs.
 */
import rough from 'roughjs/bin/rough';
import type { Options, PathInfo } from 'roughjs/bin/core';
import type { Point } from 'roughjs/bin/geometry';

import { roughStats } from './debug';
import { color } from './tokens';

const generator = rough.generator();

export type { PathInfo, Point };

/** Every helper takes a seed. There is no default on purpose. */
export interface RoughOpts extends Omit<Options, 'seed'> {
  seed: number;
}

/** The house hand: a violet ballpoint held at speed. */
export const ROUGH_DEFAULTS: Options = {
  roughness: 1.4,
  bowing: 1.2,
  strokeWidth: 1.6,
  stroke: color.ink,
  fillStyle: 'hachure',
  hachureAngle: -41,
  hachureGap: 4,
};

/**
 * FNV-1a over the key, clamped to 1..2^31-1. Rough.js treats seed 0 as
 * "use Math.random", which is exactly the flicker we are avoiding.
 */
export function hashString(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

// ---------------------------------------------------------------------------
// Path cache
// ---------------------------------------------------------------------------

const MAX_CACHE = 1200;
const cache = new Map<string, readonly PathInfo[]>();

function optsKey(opts: RoughOpts): string {
  const record = opts as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  let out = '';
  for (const k of keys) {
    const v = record[k];
    if (v === undefined) continue;
    out += `${k}=${Array.isArray(v) ? v.join('/') : String(v)};`;
  }
  return out;
}

function memoised(key: string, make: () => PathInfo[]): readonly PathInfo[] {
  const hit = cache.get(key);
  if (hit) {
    roughStats.cacheHits++;
    return hit;
  }
  const paths = Object.freeze(make());
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, paths);
  roughStats.generated++;
  return paths;
}

function resolve(opts: RoughOpts): Options {
  return { ...ROUGH_DEFAULTS, ...opts };
}

/** Debug: how many distinct shapes are currently cached. */
export function roughCacheSize(): number {
  return cache.size;
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

export function roughRect(x: number, y: number, w: number, h: number, opts: RoughOpts) {
  return memoised(`rect|${x},${y},${w},${h}|${optsKey(opts)}`, () =>
    generator.toPaths(generator.rectangle(x, y, w, h, resolve(opts))),
  );
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, opts: RoughOpts) {
  return memoised(`line|${x1},${y1},${x2},${y2}|${optsKey(opts)}`, () =>
    generator.toPaths(generator.line(x1, y1, x2, y2, resolve(opts))),
  );
}

export function roughPolygon(points: readonly Point[], opts: RoughOpts) {
  const pts = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  return memoised(`poly|${pts}|${optsKey(opts)}`, () =>
    generator.toPaths(generator.polygon(points as Point[], resolve(opts))),
  );
}

export function roughCircle(cx: number, cy: number, d: number, opts: RoughOpts) {
  return memoised(`circle|${cx},${cy},${d}|${optsKey(opts)}`, () =>
    generator.toPaths(generator.circle(cx, cy, d, resolve(opts))),
  );
}

/** An open sketched polyline — torpedo tracks, tally marks, underlines. */
export function roughPath(points: readonly Point[], opts: RoughOpts) {
  const pts = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  return memoised(`path|${pts}|${optsKey(opts)}`, () =>
    generator.toPaths(generator.linearPath(points as Point[], resolve(opts))),
  );
}

export const roughHelpers = { roughRect, roughLine, roughPolygon, roughCircle, roughPath } as const;

export type RoughHelpers = typeof roughHelpers;
