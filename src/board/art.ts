/**
 * Pure path builders for everything drawn on the board — cell marks, wreck
 * scribbles, smoke, arsenal glyphs. No React, no RN, so
 * the same drawing can be rendered outside the app and eyeballed.
 */
import { createRng } from '@engine/rng';
import type { ArsenalKind, CellState } from '@engine/types';

import { color } from '@/ui/tokens';
import {
  roughCircle,
  roughLine,
  roughPath,
  roughPolygon,
  roughRect,
  type PathInfo,
  type Point,
} from '@/ui/roughCore';
import { CELL } from './layout';

// ---------------------------------------------------------------------------
// Cell marks — 36 x 36 local space (a 28 cell with 4 units of bleed)
// ---------------------------------------------------------------------------

/** Ticks and debris spill past the cell, the way a drawn splash would. */
export const MARK_BLEED = 4;
export const MARK_SIZE = CELL + MARK_BLEED * 2; // 36
const C = MARK_SIZE / 2; // 18

function ray(angle: number, from: number, to: number): [Point, Point] {
  return [
    [C + Math.cos(angle) * from, C + Math.sin(angle) * from],
    [C + Math.cos(angle) * to, C + Math.sin(angle) * to],
  ];
}

/** Builds the mark's layers in the 36 x 36 local space. */
export function markPaths(state: CellState, seed: number): (readonly PathInfo[])[] {
  const rng = createRng(seed);
  const layers: (readonly PathInfo[])[] = [];

  switch (state) {
    case 'miss': {
      layers.push(
        roughCircle(C, C, 5, {
          seed,
          stroke: color.ink,
          strokeWidth: 1,
          fill: color.ink,
          fillStyle: 'solid',
        }),
      );
      for (let k = 0; k < 4; k++) {
        const angle = Math.PI / 4 + (Math.PI / 2) * k + (rng.next() - 0.5) * 0.3;
        const [a, b] = ray(angle, 6 + rng.next(), 9 + rng.next() * 1.5);
        layers.push(
          roughLine(a[0], a[1], b[0], b[1], {
            seed: seed + 1 + k,
            stroke: color.ink,
            strokeWidth: 1.2,
          }),
        );
      }
      break;
    }

    case 'hit':
    case 'sunk': {
      const blob: Point[] = [];
      for (let k = 0; k < 8; k++) {
        const angle = (Math.PI * 2 * k) / 8;
        const radius = 5.5 + rng.next() * 3;
        blob.push([C + Math.cos(angle) * radius, C + Math.sin(angle) * radius]);
      }
      layers.push(
        roughPolygon(blob, {
          seed,
          stroke: color.ink,
          strokeWidth: state === 'sunk' ? 2.4 : 1.4,
          fill: color.ink,
          fillStyle: 'solid',
          roughness: 1.6,
        }),
      );
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI * 2 * k) / 6 + rng.next() * 0.6;
        const [a, b] = ray(angle, 9 + rng.next() * 1.5, 12 + rng.next() * 3);
        layers.push(
          roughLine(a[0], a[1], b[0], b[1], {
            seed: seed + 10 + k,
            stroke: color.ink,
            strokeWidth: 1.2,
          }),
        );
      }
      for (let k = 0; k < 2; k++) {
        const angle = rng.next() * Math.PI * 2;
        const radius = 6 + rng.next() * 3;
        layers.push(
          roughCircle(C + Math.cos(angle) * radius, C + Math.sin(angle) * radius, 2.6, {
            seed: seed + 20 + k,
            stroke: color.inkRed,
            strokeWidth: 0.8,
            fill: color.inkRed,
            fillStyle: 'solid',
          }),
        );
      }
      break;
    }

    case 'revealed': {
      layers.push(
        roughRect(MARK_BLEED + 2, MARK_BLEED + 2, CELL - 4, CELL - 4, {
          seed,
          stroke: 'none',
          fill: color.inkFaint,
          fillStyle: 'hachure',
          hachureGap: 3.2,
          fillWeight: 1,
        }),
      );
      break;
    }

    case 'mine': {
      layers.push(
        roughCircle(C, C, 9, {
          seed,
          stroke: color.inkRed,
          strokeWidth: 1.5,
          fill: color.inkRed,
          fillStyle: 'hachure',
          hachureGap: 2.2,
          fillWeight: 1,
        }),
      );
      for (let k = 0; k < 8; k++) {
        const angle = (Math.PI * 2 * k) / 8 + Math.PI / 8;
        const [a, b] = ray(angle, 4.5, 8);
        layers.push(
          roughLine(a[0], a[1], b[0], b[1], {
            seed: seed + 1 + k,
            stroke: color.inkRed,
            strokeWidth: 1.6,
          }),
        );
      }
      break;
    }

    case 'unknown':
      break;
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Ships — authored horizontally, bow on the left, with 2 units of bleed
// ---------------------------------------------------------------------------

export const SHIP_BLEED = 2;

// ---------------------------------------------------------------------------
// Drawn hull — the stand-in until ship-*.png lands
// ---------------------------------------------------------------------------

/** Three scribbles struck through a w x h box. */
export function scribblePaths(w: number, h: number, seed: number): (readonly PathInfo[])[] {
  const rng = createRng(seed);
  const layers: (readonly PathInfo[])[] = [];
  for (let k = 0; k < 3; k++) {
    const y0 = h * (0.3 + 0.2 * k);
    const pts: Point[] = [];
    const steps = Math.max(4, Math.round(w / 9));
    for (let i = 0; i <= steps; i++) {
      pts.push([2 + ((w - 4) * i) / steps, y0 + (rng.next() - 0.5) * h * 0.5]);
    }
    layers.push(
      roughPath(pts, {
        seed: seed + k,
        stroke: color.ink,
        strokeWidth: 1.3,
        roughness: 2.2,
        bowing: 2,
      }),
    );
  }
  return layers;
}

/** A drawn puff, three overlapping circles, when smoke-puff.png is not there. */
export function smokePaths(seed: number): (readonly PathInfo[])[] {
  const opts = {
    stroke: color.inkFaint,
    strokeWidth: 1,
    fill: color.inkFaint,
    fillStyle: 'hachure',
    hachureGap: 2.6,
    fillWeight: 0.8,
  } as const;
  return [
    roughCircle(10, 14, 12, { seed, ...opts }),
    roughCircle(17, 9, 10, { seed: seed + 1, ...opts }),
    roughCircle(22, 15, 8, { seed: seed + 2, ...opts }),
  ];
}

// ---------------------------------------------------------------------------
// Arsenal glyphs — 32 x 32 local space
// ---------------------------------------------------------------------------

/** Drawn glyphs for the three own-board kinds, in a 32 x 32 box. */
export function arsenalGlyphPaths(
  kind: ArsenalKind,
  seed: number,
  tint: string,
): (readonly PathInfo[])[] {
  const c = 16;
  const stroke = { stroke: tint, strokeWidth: 1.4 } as const;
  switch (kind) {
    case 'aaGun':
      return [
        roughPolygon(
          [
            [6, 25],
            [26, 25],
            [16, 15],
          ],
          { seed, ...stroke, fill: tint, fillStyle: 'hachure', hachureGap: 2.4 },
        ),
        roughLine(16, 16, 26, 6, { seed: seed + 1, stroke: tint, strokeWidth: 2.4 }),
        roughLine(13, 14, 22, 5, { seed: seed + 2, stroke: tint, strokeWidth: 1.2 }),
      ];
    case 'mine': {
      const layers: (readonly PathInfo[])[] = [
        roughCircle(c, c, 11, {
          seed,
          ...stroke,
          fill: tint,
          fillStyle: 'hachure',
          hachureGap: 2.2,
        }),
      ];
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI * 2 * k) / 8 + Math.PI / 8;
        layers.push(
          roughLine(
            c + Math.cos(a) * 5.5,
            c + Math.sin(a) * 5.5,
            c + Math.cos(a) * 9,
            c + Math.sin(a) * 9,
            {
              seed: seed + 1 + k,
              stroke: tint,
              strokeWidth: 1.6,
            },
          ),
        );
      }
      return layers;
    }
    case 'radar': {
      const dish: Point[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI * 0.95 + (Math.PI * 0.75 * k) / 8;
        dish.push([c + 3 + Math.cos(a) * 10, c - 1 + Math.sin(a) * 10]);
      }
      return [
        roughPath(dish, { seed, ...stroke }),
        roughLine(c - 1, c + 1, c + 7, c - 7, { seed: seed + 1, ...stroke }),
        roughLine(c - 1, c + 1, c - 1, c + 12, { seed: seed + 2, ...stroke }),
        roughLine(c - 8, c + 12, c + 6, c + 12, { seed: seed + 3, stroke: tint, strokeWidth: 1.8 }),
      ];
    }
    default:
      return [];
  }
}
