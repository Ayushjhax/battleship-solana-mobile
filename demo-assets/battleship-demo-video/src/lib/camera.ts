import type { CameraKey, Punch } from '../config';

/**
 * Monotone cubic (Fritsch–Carlson) interpolation: smooth through every key,
 * never overshoots, and only comes to rest where neighbouring keys agree.
 */
export function monotoneCubic(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));

  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) {
      m[i] = 0;
    } else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  let i = 0;
  while (x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] +
    (t3 - 2 * t2 + t) * h * m[i] +
    (-2 * t3 + 3 * t2) * ys[i + 1] +
    (t3 - t2) * h * m[i + 1]
  );
}

export interface CameraState {
  zoom: number;
  x: number;
  y: number;
}

/** Camera at a frame. Zoom is interpolated in log space so it feels even. */
export function cameraAt(keys: readonly CameraKey[], punches: readonly Punch[], frame: number): CameraState {
  const fs = keys.map((k) => k.frame);
  const logZoom = monotoneCubic(fs, keys.map((k) => Math.log(k.zoom)), frame);
  let zoom = Math.exp(logZoom);
  for (const p of punches) {
    if (frame >= p.frame) {
      const t = (frame - p.frame) / p.settle;
      if (t < 1) zoom *= 1 + p.amount * Math.pow(1 - t, 3);
    }
  }
  return {
    zoom,
    x: monotoneCubic(fs, keys.map((k) => k.x), frame),
    y: monotoneCubic(fs, keys.map((k) => k.y), frame),
  };
}

/**
 * Place a content box (cw × ch, content px) in a viewport (vw × vh) so the
 * content point (x, y) sits at the viewport centre at `baseScale × zoom`,
 * clamped so the content always covers the viewport.
 */
export function framing(
  cam: CameraState,
  cw: number,
  ch: number,
  vw: number,
  vh: number,
): { scale: number; tx: number; ty: number } {
  const base = Math.max(vw / cw, vh / ch);
  const scale = base * Math.max(1, cam.zoom);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const tx = clamp(vw / 2 - cam.x * scale, vw - cw * scale, 0);
  const ty = clamp(vh / 2 - cam.y * scale, vh - ch * scale, 0);
  return { scale, tx, ty };
}
