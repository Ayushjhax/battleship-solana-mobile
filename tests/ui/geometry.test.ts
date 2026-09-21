/**
 * The drawn components' shape maths. It is pure by design — no React, no RN —
 * and every hand-drawn border, bubble, badge and ribbon in the game is built
 * from it. Determinism matters as much as shape: a seed that stops producing
 * the same torn edge makes the paper re-wobble on every render, which reads as
 * broken rather than hand-drawn.
 */
import { describe, expect, it } from 'vitest';

import {
  BUBBLE,
  RIBBON,
  bubbleOutline,
  chevronPoints,
  laurelBranch,
  pathLength,
  ribbonShapes,
  sheetPath,
  shieldPoints,
  splitSubpaths,
  tabOutline,
  trianglePoints,
  type BubbleTail,
} from '../../src/ui/geometry';

type Point = readonly [number, number];

const finite = (points: readonly Point[]) =>
  points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

/** Indexed access under `noUncheckedIndexedAccess`; a miss is a test bug. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an element at index ${index}`);
  return item;
}

describe('sheetPath', () => {
  it('is deterministic for a given seed', () => {
    expect(sheetPath(300, 200, 280, 4, 1234)).toBe(sheetPath(300, 200, 280, 4, 1234));
  });

  it('produces a different edge for a different seed', () => {
    expect(sheetPath(300, 200, 280, 4, 1)).not.toBe(sheetPath(300, 200, 280, 4, 2));
  });

  it('opens at the top-left overscan and closes the subpath', () => {
    const d = sheetPath(300, 200, 280, 4, 7);

    expect(d.startsWith('M -6 -6')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('emits only finite coordinates', () => {
    const numbers = sheetPath(300, 200, 280, 4, 7).match(/-?\d+(\.\d+)?/g) ?? [];

    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.every((value) => Number.isFinite(Number(value)))).toBe(true);
  });

  it('keeps the torn edge within reach of the tear line', () => {
    const amp = 4;
    const tearX = 280;
    const d = sheetPath(300, 200, tearX, amp, 99);
    // Every wandering x sits between tearX - amp*2.8 and tearX + amp.
    const xs = [...d.matchAll(/L (-?\d+\.\d) \d+/g)].map((match) => Number(match[1]));

    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThan(tearX - amp * 2.9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(tearX + amp);
  });

  it('scales its point count with the sheet height', () => {
    const short = sheetPath(300, 100, 280, 4, 7).split('L').length;
    const tall = sheetPath(300, 400, 280, 4, 7).split('L').length;

    expect(tall).toBeGreaterThan(short);
  });
});

describe('bubbleOutline', () => {
  const tails: BubbleTail[] = ['left', 'right', 'top', 'bottom'];

  it('closes a scalloped perimeter for every tail direction', () => {
    for (const tail of tails) {
      const points = bubbleOutline(120, 60, tail, 0.5);

      expect(points.length).toBeGreaterThan(8);
      expect(finite(points)).toBe(true);
    }
  });

  it('pushes the tail outside the body box on the chosen side', () => {
    const bw = 120;
    const bh = 60;
    const slack = BUBBLE.tailLen * 0.5;

    expect(Math.min(...bubbleOutline(bw, bh, 'left', 0.5).map(([x]) => x))).toBeLessThan(-slack);
    expect(Math.max(...bubbleOutline(bw, bh, 'right', 0.5).map(([x]) => x))).toBeGreaterThan(
      bw + slack,
    );
    expect(Math.min(...bubbleOutline(bw, bh, 'top', 0.5).map(([, y]) => y))).toBeLessThan(-slack);
    expect(Math.max(...bubbleOutline(bw, bh, 'bottom', 0.5).map(([, y]) => y))).toBeGreaterThan(
      bh + slack,
    );
  });

  it('moves the tail along the edge as tailAt changes', () => {
    const near = bubbleOutline(200, 60, 'bottom', 0.15);
    const far = bubbleOutline(200, 60, 'bottom', 0.85);
    const lowestX = (points: Point[]) =>
      points.reduce((best, point) => (point[1] > best[1] ? point : best))[0];

    expect(lowestX(far as Point[])).toBeGreaterThan(lowestX(near as Point[]));
  });

  it('is deterministic — no randomness in the scallops', () => {
    expect(bubbleOutline(120, 60, 'left', 0.5)).toEqual(bubbleOutline(120, 60, 'left', 0.5));
  });

  it('survives a degenerate body without producing NaN', () => {
    expect(finite(bubbleOutline(1, 1, 'top', 0))).toBe(true);
    expect(finite(bubbleOutline(1, 1, 'bottom', 1))).toBe(true);
  });
});

describe('trianglePoints', () => {
  it('points right with the apex on the right edge', () => {
    const triangle = trianglePoints(40, 30, 'right', 4) as Point[];
    const [a, apex, c] = [at(triangle, 0), at(triangle, 1), at(triangle, 2)];

    expect(apex).toEqual([36, 15]);
    expect(at(a, 0)).toBe(4);
    expect(at(c, 0)).toBe(4);
  });

  it('points left with the apex on the left edge', () => {
    const triangle = trianglePoints(40, 30, 'left', 4) as Point[];
    const [a, apex, c] = [at(triangle, 0), at(triangle, 1), at(triangle, 2)];

    expect(apex).toEqual([4, 15]);
    expect(at(a, 0)).toBe(36);
    expect(at(c, 0)).toBe(36);
  });

  it('mirrors exactly between the two directions', () => {
    const right = trianglePoints(40, 30, 'right', 4) as Point[];
    const left = trianglePoints(40, 30, 'left', 4) as Point[];

    expect(left.map(([x, y]) => [40 - x, y])).toEqual(right.map(([x, y]) => [x, y]));
  });

  it('always yields exactly three vertices', () => {
    expect(trianglePoints(10, 10, 'right', 0)).toHaveLength(3);
    expect(trianglePoints(10, 10, 'left', 2)).toHaveLength(3);
  });
});

describe('shieldPoints', () => {
  const shield = shieldPoints(80, 100, 5) as Point[];

  it('has a flat top and a single bottom tip', () => {
    expect(at(shield, 0)[1]).toBe(at(shield, 1)[1]);
    const lowest = shield.reduce((best, point) => (point[1] > best[1] ? point : best));
    expect(lowest[0]).toBe(40);
    expect(lowest[1]).toBe(95);
  });

  it('is symmetric about the vertical centre line', () => {
    const xs = shield.map(([x]) => x);
    const mirrored = xs.map((x) => 80 - x);

    expect(new Set(xs.map((x) => x.toFixed(4))).size).toBe(
      new Set(mirrored.map((x) => x.toFixed(4))).size,
    );
  });

  it('stays inside the padded box', () => {
    expect(Math.min(...shield.map(([x]) => x))).toBeGreaterThanOrEqual(5);
    expect(Math.max(...shield.map(([x]) => x))).toBeLessThanOrEqual(75);
    expect(Math.max(...shield.map(([, y]) => y))).toBeLessThanOrEqual(95);
  });

  it('scales with the box', () => {
    const big = shieldPoints(160, 200, 5) as Point[];

    expect(Math.max(...big.map(([, y]) => y))).toBeGreaterThan(
      Math.max(...shield.map(([, y]) => y)),
    );
  });
});

describe('chevronPoints', () => {
  it('returns a six-point band centred on the badge', () => {
    const chevron = chevronPoints(60) as Point[];

    expect(chevron).toHaveLength(6);
    expect(at(chevron, 1)[0]).toBe(30);
    expect(at(chevron, 4)[0]).toBe(30);
  });

  it('keeps a constant inset from both sides', () => {
    const chevron = chevronPoints(100) as Point[];

    expect(at(chevron, 0)[0]).toBe(6);
    expect(at(chevron, 2)[0]).toBe(94);
  });
});

describe('ribbonShapes', () => {
  const shapes = ribbonShapes(300, 40);

  it('insets the banner by one ribbon end on each side', () => {
    expect(shapes.banner.x).toBe(RIBBON.endW);
    expect(shapes.banner.w).toBe(300 - RIBBON.endW * 2);
  });

  it('reserves vertical room for the hanging ends', () => {
    expect(shapes.svgH).toBe(40 + RIBBON.drop + 4);
    expect(shapes.svgH).toBeGreaterThan(40);
  });

  it('gives both ends a swallow-tail notch', () => {
    expect(shapes.leftEnd).toHaveLength(5);
    expect(shapes.rightEnd).toHaveLength(5);
    expect(at(shapes.leftEnd as Point[], 4)[0]).toBe(2 + RIBBON.notch);
    expect(at(shapes.rightEnd as Point[], 4)[0]).toBe(300 - 2 - RIBBON.notch);
  });

  it('mirrors the two ends about the centre', () => {
    const left = shapes.leftEnd as Point[];
    const right = shapes.rightEnd as Point[];

    expect(right.map(([x, y]) => [300 - x, y])).toEqual(left.map(([x, y]) => [x, y]));
  });

  it('tucks a triangular fold behind each end', () => {
    expect(shapes.leftFold).toHaveLength(3);
    expect(shapes.rightFold).toHaveLength(3);
  });

  it('produces only finite coordinates for a narrow ribbon', () => {
    const narrow = ribbonShapes(80, 20);

    expect(finite(narrow.leftEnd as Point[])).toBe(true);
    expect(finite(narrow.rightEnd as Point[])).toBe(true);
  });
});

describe('pathLength', () => {
  it('measures a straight horizontal line', () => {
    expect(pathLength('M 0 0 L 10 0')).toBeCloseTo(10, 5);
  });

  it('measures a multi-segment polyline', () => {
    expect(pathLength('M 0 0 L 3 4 L 3 8')).toBeCloseTo(9, 5);
  });

  it('measures a 3-4-5 diagonal', () => {
    expect(pathLength('M 0 0 L 3 4')).toBeCloseTo(5, 5);
  });

  it('approximates a cubic by flattening it', () => {
    // A cubic whose control points lie on the straight line is exactly its chord.
    expect(pathLength('M 0 0 C 3 0 7 0 10 0')).toBeCloseTo(10, 3);
  });

  it('accumulates across multiple subpaths', () => {
    expect(pathLength('M 0 0 L 10 0 M 0 5 L 10 5')).toBeCloseTo(20, 5);
  });

  it('returns 0 for an empty or meaningless path', () => {
    expect(pathLength('')).toBe(0);
    expect(pathLength('M 0 0')).toBe(0);
  });

  it('handles exponent-notation coordinates', () => {
    expect(pathLength('M 0 0 L 1e1 0')).toBeCloseTo(10, 5);
  });
});

describe('splitSubpaths', () => {
  it('splits one path per M command', () => {
    expect(splitSubpaths('M 0 0 L 1 1 M 2 2 L 3 3')).toEqual(['M 0 0 L 1 1', 'M 2 2 L 3 3']);
  });

  it('returns a single-element array for one subpath', () => {
    expect(splitSubpaths('M 0 0 L 1 1')).toEqual(['M 0 0 L 1 1']);
  });

  it('drops empty fragments', () => {
    expect(splitSubpaths('')).toEqual([]);
    expect(splitSubpaths('   ')).toEqual([]);
  });

  it('round-trips with pathLength across the split', () => {
    const d = 'M 0 0 L 10 0 M 0 5 L 4 5';
    const total = splitSubpaths(d).reduce((sum, part) => sum + pathLength(part), 0);

    expect(total).toBeCloseTo(pathLength(d), 5);
  });
});

describe('tabOutline', () => {
  it('starts with a straight top edge', () => {
    const points = tabOutline(120, 30) as Point[];

    expect(points[0]).toEqual([0, 0]);
    expect(points[1]).toEqual([120, 0]);
  });

  it('scallops the bottom edge below the tab height', () => {
    const amp = 4;
    const points = tabOutline(120, 30, 12, amp) as Point[];
    const bottoms = points.slice(2).map(([, y]) => y);

    expect(Math.min(...bottoms)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...bottoms)).toBeLessThanOrEqual(30 + amp + 1e-9);
  });

  it('adds more scallops to a wider tab', () => {
    expect(tabOutline(240, 30).length).toBeGreaterThan(tabOutline(120, 30).length);
  });

  it('keeps at least two scallops on a very narrow tab', () => {
    expect(finite(tabOutline(4, 30) as Point[])).toBe(true);
    expect(tabOutline(4, 30).length).toBeGreaterThan(2);
  });

  it('is deterministic', () => {
    expect(tabOutline(120, 30)).toEqual(tabOutline(120, 30));
  });

  it('spans the full tab width', () => {
    const xs = (tabOutline(120, 30) as Point[]).map(([x]) => x);

    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(120, 6);
  });
});

describe('laurelBranch', () => {
  it('returns a stem polyline and the requested number of leaves', () => {
    const { stem, leaves } = laurelBranch('left', 100, 7);

    expect(stem.length).toBe(13);
    expect(leaves).toHaveLength(7);
    expect(finite(stem as Point[])).toBe(true);
  });

  it('gives every leaf a four-point outline', () => {
    const { leaves } = laurelBranch('right', 100);

    for (const leaf of leaves) {
      expect(leaf.points).toHaveLength(4);
      expect(finite(leaf.points as Point[])).toBe(true);
    }
  });

  it('runs the stem bottom-to-top', () => {
    const { stem } = laurelBranch('left', 100);

    expect(at(stem as Point[], 0)[1]).toBeCloseTo(100, 6);
    expect(at(stem as Point[], stem.length - 1)[1]).toBeCloseTo(0, 6);
  });

  it('mirrors the two sides', () => {
    const left = laurelBranch('left', 100).stem as Point[];
    const right = laurelBranch('right', 100).stem as Point[];
    const w = 100 * 0.34;

    // left is built from cx = w, right from cx = 0, bending opposite ways, so
    // the left stem's offset from its centre is the negation of the right's.
    expect(left).toHaveLength(right.length);
    left.forEach(([x], index) => {
      expect(x - w).toBeCloseTo(-at(right, index)[0], 6);
    });
  });

  it('shrinks leaves toward the tip of the branch', () => {
    const { leaves } = laurelBranch('left', 100, 6);
    const spread = (index: number) => {
      const points = at(leaves, index).points as Point[];
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      return Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
    };

    expect(spread(0)).toBeGreaterThan(spread(leaves.length - 1));
  });

  it('honours a custom leaf count', () => {
    expect(laurelBranch('left', 100, 3).leaves).toHaveLength(3);
    expect(laurelBranch('left', 100, 12).leaves).toHaveLength(12);
  });

  it('handles a zero-leaf branch without failing', () => {
    const { stem, leaves } = laurelBranch('right', 80, 0);

    expect(leaves).toEqual([]);
    expect(finite(stem as Point[])).toBe(true);
  });
});
