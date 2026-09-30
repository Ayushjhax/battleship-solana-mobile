/**
 * An ink blot's outline: a circle broken by a few fixed harmonics, like ink
 * spreading into paper. Deterministic in (radius, frame).
 */
export function inkBlob(cx: number, cy: number, r: number, frame: number, steps = 140): [number, number][] {
  const pts: [number, number][] = [];
  const drift = frame * 0.012;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k =
      1 +
      0.07 * Math.sin(3 * a + 1.3 + drift) +
      0.045 * Math.sin(5 * a + 0.4 - drift * 0.7) +
      0.03 * Math.sin(9 * a + 2.1) +
      0.018 * Math.sin(17 * a + 0.9 + drift) +
      0.01 * Math.sin(31 * a + 1.7);
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return pts;
}

export const blobPath = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';
