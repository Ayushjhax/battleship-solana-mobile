/**
 * Beats 9–17: ★2 the bit becomes the logo (the sonic logo), then collapses back into the bit, which unfolds into
 * the glass screen the flip runs on.
 *
 *   9   hard cut to black: the scattered bits drift faintly; one bit fades up in the middle
 *   11  it pings
 *   13  BOOM (downbeat): the bits rush back and lock into the logo; the bit flies to its slot
 *   14  a light sweep crosses the locked logo
 *   16  the logo collapses into its bit
 *   16.5 the bit unfolds into the glass screen (FLIP_GLASS), face-on by 17
 */
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Bit, Ping } from '../../trailer45/components/Frames';
import { C, EASE_IN, EASE_MOVE, clamp } from '../../trailer45/theme';
import { BitShatter, assemble, collapse, scatterAt } from '../components/BitShatter';
import { LogoMask, bitOn, type LogoPlace } from '../components/Logo';
import { SECTIONS, f } from '../timeline';

const A = SECTIONS.bit[0];
const L = (b: number) => f(b) - f(A);

export const STING_LOGO: LogoPlace = { cx: 960, cy: 540, w: 1500 };
/** the glass screen of the flip (src/deck30/scenes/Flip.tsx) — the bit unfolds into exactly this box */
export const FLIP_GLASS = { x: 340, y: 322, w: 1240, h: 557 } as const;

export const TheBit: React.FC = () => {
  const t = useCurrentFrame();
  const boom = L(13);
  const tb = t - boom;
  // every shot drifts: the logo grows 3 % from the BOOM to the collapse
  const LG: LogoPlace = { ...STING_LOGO, w: STING_LOGO.w * (1 + 0.03 * interpolate(t, [boom, L(16)], [0, 1], clamp)) };
  const slot = bitOn(LG);
  // the bit: fades up centre, pings, flies to its slot on the BOOM, then holds as the logo's bit
  const appear = interpolate(t, [2, 10], [0, 1], { ...clamp, easing: EASE_IN });
  const fly = interpolate(tb, [0, 9], [0, 1], { ...clamp, easing: EASE_MOVE });
  const bx = 960 + (slot.x - 960) * fly;
  const by = 540 + (slot.y - 540) * fly;
  const swell = tb < 0 ? interpolate(tb, [-4, 0], [1, 1.35], clamp) : interpolate(tb, [0, 6], [1.35, 1], clamp);
  const bsize = (34 + (slot.size - 34) * fly) * swell;
  const flash = interpolate(tb, [0, 10], [1, 0], clamp);
  // the logo: pieces until they've locked, then the crisp mask (they are pixel-identical at rest)
  const crisp = interpolate(tb, [13, 15], [0, 1], clamp);
  const sweep = interpolate(t, [L(14), L(15.2)], [-0.3, 1.3], { ...clamp, easing: EASE_MOVE });
  // collapse into the bit at 16, unfold into glass at 16.5
  const tc = t - L(16);
  const tu = t - L(16.5);
  const u = interpolate(tu, [0, L(17) - L(16.5)], [0, 1], { ...clamp, easing: EASE_IN });
  const scatterT = Math.min(t, boom);

  let pieces: React.ReactNode = null;
  if (tb < 0) {
    pieces = (
      <BitShatter
        lg={LG}
        state={(p) => {
          const s = scatterAt(p, scatterT, 'sting');
          return { ...s, alpha: 0.22 * (0.6 + 0.4 * Math.sin(t * 0.3 + p.i)) * interpolate(t, [0, 6], [0, 1], clamp), bit: 1, scale: 0.9 };
        }}
      />
    );
  } else if (crisp < 1) {
    pieces = <BitShatter lg={LG} state={assemble(tb, scatterT, { dur: 9, spread: 5, seed: 'sting', dim: 0.22 })} />;
  } else if (tc >= 0 && tu < 0) {
    pieces = <BitShatter lg={LG} state={collapse(tc, slot, { dur: 6, spread: 2 })} />;
  }

  const logoShown = crisp > 0 && tc < 0;
  const bitShown = tu < 0;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      {/* the BOOM lights the room */}
      {tb >= 0 && tu < 0 && (
        <AbsoluteFill style={{ background: `radial-gradient(circle 760px at ${bx}px ${by}px, rgba(124,108,255,${0.42 * flash + 0.06}), rgba(0,0,0,0) 72%)` }} />
      )}
      {pieces}
      {logoShown && <LogoMask lg={LG} opacity={crisp} />}
      {logoShown && t >= L(14) && t <= L(15.4) && (
        <LogoMask
          lg={LG}
          background={`linear-gradient(105deg, rgba(255,255,255,0) ${sweep * 100 - 12}%, rgba(255,255,255,0.95) ${sweep * 100}%, rgba(124,108,255,0.6) ${sweep * 100 + 4}%, rgba(255,255,255,0) ${sweep * 100 + 12}%)`}
        />
      )}
      {bitShown && <Bit x={bx} y={by} size={bsize} intensity={appear * (1 + 0.9 * flash) * (tc >= 0 ? 1.4 : 1)} />}
      <Ping x={960} y={540} t={t - L(11)} size={40} dur={26} max={14} />
      <Ping x={960} y={540} t={t - L(11) - 6} size={40} dur={22} max={8} />
      <Ping x={960} y={540} t={t - L(11) - 12} size={40} dur={18} max={5} />
      <Ping x={slot.x} y={slot.y} t={tb} size={slot.size} dur={20} max={9} />
      {/* the unfold: the bit grows into the glass screen */}
      {tu >= 0 && (() => {
        const w = slot.size + (FLIP_GLASS.w - slot.size) * u;
        const h = slot.size + (FLIP_GLASS.h - slot.size) * u;
        const cx = slot.x + (FLIP_GLASS.x + FLIP_GLASS.w / 2 - slot.x) * u;
        const cy = slot.y + (FLIP_GLASS.y + FLIP_GLASS.h / 2 - slot.y) * u;
        return (
          <div
            style={{
              position: 'absolute',
              left: cx - w / 2,
              top: cy - h / 2,
              width: w,
              height: h,
              borderRadius: 4 + 22 * u,
              background: `rgba(${Math.round(124 + (5 - 124) * u)},${Math.round(108 + (4 - 108) * u)},${Math.round(255 + (11 - 255) * u)},1)`,
              boxShadow: `0 0 ${60 * (1 - u) + 20}px rgba(124,108,255,${0.9 - 0.5 * u}), inset 0 1px 0 rgba(255,255,255,${0.55 * u}), inset 0 0 0 1px rgba(255,255,255,${0.16 + 0.4 * (1 - u)})`,
            }}
          />
        );
      })()}
    </AbsoluteFill>
  );
};
