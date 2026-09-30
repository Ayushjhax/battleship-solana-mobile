import React from 'react';
import {HEIGHT, WIDTH} from '../config/timeline';

/** Native pixel size of each recording (the zoom unit: 1 = one source pixel per screen pixel). */
export const SOURCE = {
  battle: {w: 1280, h: 576},
  phone: {w: 2670, h: 1200},
} as const;

/**
 * Frames footage like a camera: the source point (u, v) (0..1) lands on the screen point
 * (cx, cy) at `zoom` screen px per source px. With `cover`, the placement is clamped so the
 * footage always covers the frame (no black edges).
 */
export const Framed: React.FC<{
  source: {w: number; h: number};
  u: number;
  v: number;
  zoom: number;
  cx?: number;
  cy?: number;
  cover?: boolean;
  frameW?: number;
  frameH?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({source, u, v, zoom, cx, cy, cover = true, frameW = WIDTH, frameH = HEIGHT, children, style}) => {
  const W = source.w * zoom;
  const H = source.h * zoom;
  let left = (cx ?? frameW / 2) - u * W;
  let top = (cy ?? frameH / 2) - v * H;
  if (cover) {
    left = Math.min(0, Math.max(frameW - W, left));
    top = Math.min(0, Math.max(frameH - H, top));
  }
  return <div style={{position: 'absolute', left, top, width: W, height: H, ...style}}>{children}</div>;
};
