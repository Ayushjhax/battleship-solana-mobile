/**
 * Procedural pen-drawn buildings — part-02 §4.
 *
 * "Until real art exists, generate the silhouette procedurally from the
 * existing stroke generator, seeded by buildingId so it wobbles the same way
 * every time... Ship the system, not the art."
 *
 * A building is an ordered list of STROKES. The order is the drawing order,
 * which is what makes construction legible: footprint, then roof, then
 * details, then hatching. Progress reveals them in that order through
 * strokeDashoffset, and hatching only starts at p > 0.85.
 *
 * Real line art drops in later as an SVG path set per tier behind the same
 * `buildingArt(id, tier)` signature, with no change at any call site.
 *
 * Pure: no React, no roughjs. It emits GEOMETRY (points), and the component
 * turns that into rough paths. That keeps this file testable under Node and
 * keeps the one rough cache in src/ui/roughCore.ts as the only generator.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';

export type StrokeKind = 'footprint' | 'roof' | 'detail' | 'hatch';
export type StrokeShape = 'polygon' | 'path' | 'line' | 'circle';

export interface Stroke {
  readonly kind: StrokeKind;
  readonly shape: StrokeShape;
  /** Polygon/path/line points, in a 0..1 box that the plot scales to. */
  readonly points: readonly (readonly [number, number])[];
  /** Circles only: centre and diameter, same 0..1 box. */
  readonly circle?: { readonly cx: number; readonly cy: number; readonly d: number };
  /** Rough weight; details are lighter than the silhouette. */
  readonly weight: number;
  /** Hatched fill, for the roof and the T3+ shading. */
  readonly fill?: boolean;
}

export interface BuildingArt {
  readonly id: BuildingId;
  readonly tier: 1 | 2 | 3 | 4;
  readonly strokes: readonly Stroke[];
  /** Summed stroke "length" in the 0..1 box — the progress denominator. */
  readonly totalLength: number;
}

// ---------------------------------------------------------------------------
// A tiny deterministic PRNG so a plot wobbles identically every render.
// ---------------------------------------------------------------------------

/** FNV-1a, matching src/ui/roughCore.ts's hashString so seeds line up. */
export function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The silhouette vocabulary
// ---------------------------------------------------------------------------

type RoofShape = 'gable' | 'flat' | 'sawtooth' | 'tower';

/**
 * Each building's character, chosen once so a Foundry always reads like a
 * Foundry. This is the part a real illustrator replaces.
 */
const CHARACTER: Readonly<Record<BuildingId, { roof: RoofShape; wide: number; tall: number }>> = {
  admiralty: { roof: 'tower', wide: 0.72, tall: 0.78 },
  scrapyard: { roof: 'flat', wide: 0.86, tall: 0.42 },
  fish_market: { roof: 'gable', wide: 0.78, tall: 0.5 },
  foundry: { roof: 'sawtooth', wide: 0.84, tall: 0.58 },
  shipyard: { roof: 'flat', wide: 0.88, tall: 0.52 },
  stationery: { roof: 'gable', wide: 0.6, tall: 0.62 },
  harbour_office: { roof: 'gable', wide: 0.66, tall: 0.6 },
  naval_academy: { roof: 'tower', wide: 0.8, tall: 0.7 },
  coastal_command: { roof: 'flat', wide: 0.74, tall: 0.64 },
  armory: { roof: 'flat', wide: 0.7, tall: 0.5 },
  fleet_hall: { roof: 'gable', wide: 0.84, tall: 0.66 },
  newsstand: { roof: 'flat', wide: 0.5, tall: 0.44 },
  trade_docks: { roof: 'sawtooth', wide: 0.9, tall: 0.46 },
  officers_club: { roof: 'gable', wide: 0.68, tall: 0.58 },
  lighthouse: { roof: 'tower', wide: 0.34, tall: 0.92 },
};

function lengthOf(stroke: Stroke): number {
  if (stroke.shape === 'circle') return Math.PI * (stroke.circle?.d ?? 0);
  let total = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  // A polygon closes back to its first point.
  if (stroke.shape === 'polygon' && stroke.points.length > 2) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    if (first && last) total += Math.hypot(first[0] - last[0], first[1] - last[1]);
  }
  return total;
}

/**
 * The strokes for a building at a tier. A higher tier is the SAME silhouette
 * plus more strokes — never a different building (§4).
 */
export function buildingArt(id: BuildingId, tier: 1 | 2 | 3 | 4): BuildingArt {
  const character = CHARACTER[id];
  const rnd = rngFrom(seedOf(`plot-${id}`));
  const strokes: Stroke[] = [];

  // Jitter, drawn from the seeded RNG, so each building is a little different
  // but identical across renders and restarts.
  const w = character.wide + (rnd() - 0.5) * 0.05;
  const h = character.tall + (rnd() - 0.5) * 0.05;
  const left = 0.5 - w / 2;
  const right = 0.5 + w / 2;
  const base = 0.96;
  const top = base - h;

  // 1. Footprint — always first, always the thing that reads at a glance.
  strokes.push({
    kind: 'footprint',
    shape: 'polygon',
    points: [
      [left, base],
      [right, base],
      [right, top],
      [left, top],
    ],
    weight: 1.8,
  });

  // 2. Roof.
  const ridge = top - 0.14 - rnd() * 0.04;
  if (character.roof === 'gable') {
    strokes.push({
      kind: 'roof',
      shape: 'polygon',
      points: [
        [left - 0.04, top],
        [right + 0.04, top],
        [0.5, ridge],
      ],
      weight: 1.6,
      fill: tier >= 3,
    });
  } else if (character.roof === 'sawtooth') {
    const teeth = 3;
    const points: [number, number][] = [[left, top]];
    for (let i = 0; i < teeth; i++) {
      const x0 = left + ((right - left) * i) / teeth;
      const x1 = left + ((right - left) * (i + 1)) / teeth;
      points.push([x0, ridge], [x1, top]);
    }
    strokes.push({ kind: 'roof', shape: 'path', points, weight: 1.5 });
  } else if (character.roof === 'tower') {
    const tw = w * 0.34;
    strokes.push({
      kind: 'roof',
      shape: 'polygon',
      points: [
        [0.5 - tw / 2, top],
        [0.5 + tw / 2, top],
        [0.5 + tw / 2, top - 0.22],
        [0.5 - tw / 2, top - 0.22],
      ],
      weight: 1.6,
    });
    strokes.push({
      kind: 'roof',
      shape: 'path',
      points: [
        [0.5 - tw / 2 - 0.03, top - 0.22],
        [0.5, top - 0.34],
        [0.5 + tw / 2 + 0.03, top - 0.22],
      ],
      weight: 1.5,
      fill: tier >= 3,
    });
  } else {
    strokes.push({
      kind: 'roof',
      shape: 'line',
      points: [
        [left - 0.04, top],
        [right + 0.04, top],
      ],
      weight: 1.8,
    });
  }

  // 3. Details, two or three per tier (§4).
  const windowRows = tier;
  const windowCols = Math.max(2, Math.round(w * 5));
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowCols; col++) {
      const wx = left + ((right - left) * (col + 0.5)) / windowCols;
      const wy = top + 0.1 + row * 0.16;
      if (wy > base - 0.12) continue;
      const size = 0.035 + rnd() * 0.012;
      strokes.push({
        kind: 'detail',
        shape: 'polygon',
        points: [
          [wx - size, wy],
          [wx + size, wy],
          [wx + size, wy + size * 1.6],
          [wx - size, wy + size * 1.6],
        ],
        weight: 0.9,
      });
    }
  }

  // A door, always.
  strokes.push({
    kind: 'detail',
    shape: 'polygon',
    points: [
      [0.5 - 0.05, base],
      [0.5 + 0.05, base],
      [0.5 + 0.05, base - 0.13],
      [0.5 - 0.05, base - 0.13],
    ],
    weight: 1.1,
  });

  // T2+: a flag on a pole. T3+: a chimney or crane. T4: lamps.
  if (tier >= 2) {
    const px = right - 0.06;
    strokes.push({
      kind: 'detail',
      shape: 'line',
      points: [
        [px, top],
        [px, top - 0.2],
      ],
      weight: 1.2,
    });
    strokes.push({
      kind: 'detail',
      shape: 'polygon',
      points: [
        [px, top - 0.2],
        [px + 0.12, top - 0.16],
        [px, top - 0.12],
      ],
      weight: 1,
      fill: true,
    });
  }

  if (tier >= 3) {
    const cx = left + 0.1;
    strokes.push({
      kind: 'detail',
      shape: 'polygon',
      points: [
        [cx, top],
        [cx + 0.08, top],
        [cx + 0.08, top - 0.24],
        [cx, top - 0.24],
      ],
      weight: 1.2,
    });
  }

  if (tier >= 4) {
    for (const lx of [left + 0.08, right - 0.08]) {
      strokes.push({
        kind: 'detail',
        shape: 'circle',
        points: [],
        circle: { cx: lx, cy: base - 0.06, d: 0.05 },
        weight: 1,
        fill: true,
      });
    }
  }

  // 4. Hatching, last, and only inked at the very end of a build (§4).
  const hatchLines = tier + 1;
  for (let i = 0; i < hatchLines; i++) {
    const hy = base - 0.04 - i * 0.05;
    if (hy <= top) break;
    strokes.push({
      kind: 'hatch',
      shape: 'line',
      points: [
        [left + 0.04, hy],
        [left + 0.04 + (right - left) * 0.34, hy],
      ],
      weight: 0.7,
    });
  }

  const totalLength = strokes.reduce((sum, stroke) => sum + lengthOf(stroke), 0);
  return { id, tier, strokes, totalLength };
}

/**
 * How much of each stroke is inked at progress `p`.
 *
 * Strokes are revealed in order, each getting its share of the total length,
 * so the pen appears to draw the building rather than fade it in. Hatching is
 * held back until p > 0.85 (§4) and then reveals across the remaining window.
 */
export const HATCH_START = 0.85;

/** Float slack when deciding a stroke is fully inked. See strokeReveal. */
const REVEAL_EPSILON = 1e-9;

export function strokeReveal(art: BuildingArt, p: number): number[] {
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  const solid = art.strokes.filter((s) => s.kind !== 'hatch');
  const solidLength = solid.reduce((sum, s) => sum + lengthOf(s), 0);

  // Solid strokes fill the first 85% of the build; hatching the last 15%.
  const solidProgress = Math.min(1, clamped / HATCH_START);
  const hatchProgress = clamped <= HATCH_START ? 0 : (clamped - HATCH_START) / (1 - HATCH_START);

  const hatchCount = art.strokes.filter((s) => s.kind === 'hatch').length;
  const out: number[] = [];

  // Cumulative offsets rather than a running subtraction: decrementing a
  // float by each stroke's length in turn accumulates rounding error, and at
  // p = 1 the final stroke could land at 0.9999 instead of 1.
  const drawnTotal = solidProgress * solidLength;
  let cursor = 0;
  let hatchIndex = 0;

  for (const stroke of art.strokes) {
    if (stroke.kind === 'hatch') {
      // Hatch lines reveal one after another across the last 15%, and ALL of
      // them are complete at p = 1. Line i starts when hatchProgress passes
      // i/hatchCount and finishes one step later.
      const share = hatchCount === 0 ? 0 : hatchProgress * hatchCount - hatchIndex;
      out.push(share <= 0 ? 0 : share >= 1 ? 1 : share);
      hatchIndex += 1;
      continue;
    }
    const length = lengthOf(stroke);
    if (length <= 0) {
      out.push(drawnTotal >= cursor ? 1 : 0);
      continue;
    }
    // Snap within an epsilon: (solidLength - cursor) / length is exactly 1 in
    // real arithmetic at p = 1, but lands on 0.9999999999999998 in float64,
    // which would leave the last stroke of every building a hair short of
    // drawn forever.
    const share = (drawnTotal - cursor) / length;
    out.push(share <= 0 ? 0 : share >= 1 - REVEAL_EPSILON ? 1 : share);
    cursor += length;
  }
  return out;
}

/** The nib sits at the end of the last stroke currently being inked. */
export function nibAt(art: BuildingArt, p: number): { x: number; y: number } | null {
  if (p <= 0 || p >= 1) return null;
  const reveal = strokeReveal(art, p);
  for (let i = art.strokes.length - 1; i >= 0; i--) {
    const share = reveal[i] ?? 0;
    if (share <= 0 || share >= 1) continue;
    const stroke = art.strokes[i];
    if (!stroke) continue;
    if (stroke.shape === 'circle' && stroke.circle) {
      return { x: stroke.circle.cx, y: stroke.circle.cy };
    }
    const points = stroke.points;
    if (points.length < 2) continue;
    const at = share * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(at));
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    const t = at - index;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
  }
  return null;
}

/** Human-readable, for the kitchen sink. */
export function describeArt(id: BuildingId): string {
  return `${CITY_CATALOGUE[id].name}: ${CHARACTER[id].roof} roof`;
}
