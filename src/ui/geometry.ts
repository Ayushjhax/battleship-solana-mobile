/**
 * Pure geometry for the drawn components — no React, no RN — so the shapes can
 * be rendered and eyeballed outside the app (see the preview script in P01's
 * notes) and unit-tested if they ever need to be.
 */
import { createRng } from '@engine/rng';

import type { Point } from './roughCore';

// ---------------------------------------------------------------------------
// Paper: the torn right edge
// ---------------------------------------------------------------------------

/** A deterministic torn edge: x wanders around tearX, with the odd deeper nick. */
export function sheetPath(w: number, h: number, tearX: number, amp: number, seed: number): string {
  const rng = createRng(seed);
  const step = 7;
  let d = `M -6 -6 L ${tearX} -6`;
  for (let y = 0; y <= h + 6; y += step) {
    const nick = rng.next() < 0.08 ? amp * 1.8 : 0;
    const x = tearX + (rng.next() * 2 - 1) * amp - nick;
    d += ` L ${x.toFixed(1)} ${y}`;
  }
  d += ` L ${tearX} ${h + 6} L -6 ${h + 6} Z`;
  return d;
}

// ---------------------------------------------------------------------------
// SpeechBubble: scalloped rectangle with a tail
// ---------------------------------------------------------------------------

export type BubbleTail = 'left' | 'right' | 'top' | 'bottom';

export const BUBBLE = {
  tailLen: 16,
  tailBase: 18,
  scallop: 13,
  amp: 2.2,
} as const;

interface Edge {
  from: Point;
  to: Point;
  normal: Point;
  side: BubbleTail;
}

/**
 * Walks the body's perimeter clockwise, bulging each scallop outward along
 * the edge normal and splicing the tail into the chosen edge by position.
 */
export function bubbleOutline(bw: number, bh: number, tail: BubbleTail, tailAt: number): Point[] {
  const edges: Edge[] = [
    { from: [0, 0], to: [bw, 0], normal: [0, -1], side: 'top' },
    { from: [bw, 0], to: [bw, bh], normal: [1, 0], side: 'right' },
    { from: [bw, bh], to: [0, bh], normal: [0, 1], side: 'bottom' },
    { from: [0, bh], to: [0, 0], normal: [-1, 0], side: 'left' },
  ];

  const out: Point[] = [];
  for (const edge of edges) {
    const dx = edge.to[0] - edge.from[0];
    const dy = edge.to[1] - edge.from[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const at = (t: number, bulge: number): Point => [
      edge.from[0] + ux * t * len + edge.normal[0] * bulge,
      edge.from[1] + uy * t * len + edge.normal[1] * bulge,
    ];

    const hasTail = edge.side === tail;
    // Walking clockwise, 'bottom' and 'left' run backwards, so flip the position.
    const pos = edge.side === 'bottom' || edge.side === 'left' ? 1 - tailAt : tailAt;
    const half = BUBBLE.tailBase / 2 / len;
    const clamped = Math.min(Math.max(pos, half + 0.06), 1 - half - 0.06);
    const tA = clamped - half;
    const tB = clamped + half;

    const samples: { t: number; p: Point }[] = [];
    const n = Math.max(1, Math.round(len / BUBBLE.scallop));
    const m = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const t = i / n + j / (m * n);
        if (hasTail && t > tA && t < tB) continue;
        samples.push({ t, p: at(t, BUBBLE.amp * Math.sin((Math.PI * j) / m)) });
      }
    }
    if (hasTail) {
      const tip: Point = [
        edge.from[0] + ux * clamped * len + edge.normal[0] * BUBBLE.tailLen + ux * 5,
        edge.from[1] + uy * clamped * len + edge.normal[1] * BUBBLE.tailLen + uy * 5,
      ];
      const tailPts = [
        { t: tA, p: at(tA, 0) },
        { t: clamped, p: tip },
        { t: tB, p: at(tB, 0) },
      ];
      const insertAt = samples.findIndex((s) => s.t >= tB);
      if (insertAt === -1) samples.push(...tailPts);
      else samples.splice(insertAt, 0, ...tailPts);
    }
    for (const s of samples) out.push(s.p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// TurnTriangle
// ---------------------------------------------------------------------------

export function trianglePoints(
  w: number,
  h: number,
  direction: 'left' | 'right',
  pad: number,
): Point[] {
  return direction === 'right'
    ? [
        [pad, pad],
        [w - pad, h / 2],
        [pad, h - pad],
      ]
    : [
        [w - pad, pad],
        [pad, h / 2],
        [w - pad, h - pad],
      ];
}

// ---------------------------------------------------------------------------
// RankBadge: heraldic shield and its chevron
// ---------------------------------------------------------------------------

/** Flat top, straight shoulders, curving to a point. */
export function shieldPoints(w: number, h: number, pad: number): Point[] {
  const x0 = pad;
  const x1 = w - pad;
  const cx = w / 2;
  const y0 = pad;
  const yShoulder = h * 0.45;
  const yTip = h - pad;
  return [
    [x0, y0],
    [x1, y0],
    [x1, yShoulder],
    [x1 - (x1 - cx) * 0.18, yShoulder + (yTip - yShoulder) * 0.45],
    [x1 - (x1 - cx) * 0.55, yShoulder + (yTip - yShoulder) * 0.8],
    [cx, yTip],
    [x0 + (cx - x0) * 0.45, yShoulder + (yTip - yShoulder) * 0.8],
    [x0 + (cx - x0) * 0.18, yShoulder + (yTip - yShoulder) * 0.45],
    [x0, yShoulder],
  ];
}

export function chevronPoints(w: number): Point[] {
  return [
    [6, 12],
    [w / 2, 18],
    [w - 6, 12],
    [w - 6, 16],
    [w / 2, 22],
    [6, 16],
  ];
}

// ---------------------------------------------------------------------------
// TitleRibbon: banner with two swallow-tailed ends
// ---------------------------------------------------------------------------

export const RIBBON = {
  endW: 34, // how far each ribbon end reaches past the banner
  drop: 7, // ribbon ends hang this much lower than the banner
  notch: 10, // depth of the swallow tail
} as const;

export interface RibbonShapes {
  leftEnd: Point[];
  rightEnd: Point[];
  leftFold: Point[];
  rightFold: Point[];
  banner: { x: number; y: number; w: number; h: number };
  svgH: number;
}

export function ribbonShapes(w: number, h: number): RibbonShapes {
  const { endW, drop, notch } = RIBBON;
  const bannerX = endW;
  const bannerW = w - endW * 2;
  const midY = (h + drop * 2) / 2 + 1;
  return {
    leftEnd: [
      [2, drop + 2],
      [bannerX + 10, drop + 2],
      [bannerX + 10, h + drop],
      [2, h + drop],
      [2 + notch, midY],
    ],
    rightEnd: [
      [w - 2, drop + 2],
      [w - bannerX - 10, drop + 2],
      [w - bannerX - 10, h + drop],
      [w - 2, h + drop],
      [w - 2 - notch, midY],
    ],
    // The little dark fold where the banner tucks behind each end.
    leftFold: [
      [bannerX, h],
      [bannerX + 10, h],
      [bannerX + 10, h + drop],
    ],
    rightFold: [
      [w - bannerX, h],
      [w - bannerX - 10, h],
      [w - bannerX - 10, h + drop],
    ],
    banner: { x: bannerX, y: 2, w: bannerW, h: h - 2 },
    svgH: h + drop + 4,
  };
}

// ---------------------------------------------------------------------------
// Path length — for strokeDasharray draw-on animations
// ---------------------------------------------------------------------------

/**
 * Length of a Rough.js path (M / L / C only, which is all opsToPath emits),
 * flattening each cubic into 8 chords. Good to ~0.5% — plenty for a dash
 * animation.
 */
export function pathLength(d: string): number {
  const tokens = d.match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tokens) return 0;
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let length = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (t === 'M' || t === 'L' || t === 'C') {
      cmd = t;
      i++;
      continue;
    }
    if (cmd === 'M') {
      x = num();
      y = num();
      cmd = 'L';
    } else if (cmd === 'L') {
      const nx = num();
      const ny = num();
      length += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
    } else if (cmd === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x3 = num();
      const y3 = num();
      let px = x;
      let py = y;
      for (let k = 1; k <= 8; k++) {
        const s = k / 8;
        const a = (1 - s) ** 3;
        const b = 3 * (1 - s) ** 2 * s;
        const c = 3 * (1 - s) * s ** 2;
        const e = s ** 3;
        const cx = a * x + b * x1 + c * x2 + e * x3;
        const cy = a * y + b * y1 + c * y2 + e * y3;
        length += Math.hypot(cx - px, cy - py);
        px = cx;
        py = cy;
      }
      x = x3;
      y = y3;
    } else {
      i++;
    }
  }
  return length;
}

/**
 * Rough.js draws a multi-stroke line as ONE path with two `M` subpaths. For a
 * draw-on animation each stroke needs its own dash offset, so split them.
 */
export function splitSubpaths(d: string): string[] {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Arsenal tab — hangs from the top edge with a scalloped bottom (IMG_9770)
// ---------------------------------------------------------------------------

/** A w x h tab: straight top and sides, scallops along the bottom edge. */
export function tabOutline(w: number, h: number, scallop = 12, amp = 4): Point[] {
  const pts: Point[] = [
    [0, 0],
    [w, 0],
  ];
  const n = Math.max(2, Math.round(w / scallop));
  const m = 4;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= m; j++) {
      if (j === m && i > 0) continue;
      const t = i / n + (m - j) / (m * n);
      pts.push([w * t, h + amp * Math.sin((Math.PI * (m - j)) / m)]);
    }
  }
  return pts;
}
