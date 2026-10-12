/**
 * The Empire of Bits logo (the game's assets/ink/brand/logo.png, 733 x 129, via the trailer's @3x masks) and its
 * bit: the top-right square that stays empty and glowing. No vector logo exists in the repo; the 2199 px mask is
 * shown at <= 1180 px, so it stays crisp.
 */
import React from 'react';
import { staticFile } from 'remotion';

export const LOGO = { w: 733, h: 129, bit: [709, 34, 732, 60] as const, mask: 'brand/logo-mask@3x.png', maskNoBit: 'brand/logo-mask-nobit@3x.png', scale: 3 } as const;

/** Logo placement on screen: centre + width. */
export type LogoPlace = { cx: number; cy: number; w: number };

export const logoHeight = (lg: LogoPlace) => (lg.w * LOGO.h) / LOGO.w;
/** a logo-source pixel → screen */
export const logoToScreen = (lg: LogoPlace, sx: number, sy: number) => {
  const k = lg.w / LOGO.w;
  return { x: lg.cx + (sx - LOGO.w / 2) * k, y: lg.cy + (sy - LOGO.h / 2) * k, k };
};
/** centre and size of the bit on screen */
export const bitOn = (lg: LogoPlace) => {
  const [x0, y0, x1, y1] = LOGO.bit;
  const p = logoToScreen(lg, (x0 + x1) / 2, (y0 + y1) / 2);
  return { x: p.x, y: p.y, size: (x1 - x0) * p.k };
};

/** The logo, tinted by CSS mask. `withBit` = false leaves the bit's square empty (the glowing Bit takes it). */
export const LogoMask: React.FC<{ lg: LogoPlace; color?: string; opacity?: number; background?: string; withBit?: boolean; style?: React.CSSProperties }> = ({
  lg,
  color = '#F5F5F7',
  opacity = 1,
  background,
  withBit = false,
  style,
}) => {
  const h = logoHeight(lg);
  const m = `url(${staticFile(withBit ? LOGO.mask : LOGO.maskNoBit)})`;
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: lg.cx - lg.w / 2,
        top: lg.cy - h / 2,
        width: lg.w,
        height: h,
        background: background ?? color,
        opacity,
        WebkitMaskImage: m,
        maskImage: m,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        ...style,
      }}
    />
  );
};
