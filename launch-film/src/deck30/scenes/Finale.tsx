/**
 * Beats 55–70: ★7 one becomes all → Live → the landing (the trailer's end card, exactly).
 *
 *   55    the bit (the #1 row's highlight, collapsed at the end of the economy) becomes one tile (a real player)
 *   55.5  4 · 56 16 · 56.5 64 · 57 256 (downbeat) — every tile a real player or a real battle; six play live
 *   59    the sculpt: tiles outside the logo fall away; the rest turn brand duotone (59.5 → 60.5) and settle
 *   61    the lock (downbeat): the mosaic snaps into the letters, the crisp logo resolves through it
 *   61.5  the logo eases up; 62 the dApp Store rises; 63 "Your move."
 *   65    the empty bit pings once (BOOM on 67); held to the last frame, no fade
 *
 * The end card's layout, colours and drift are the trailer's Finale (src/trailer45/scenes/Finale.tsx), so the
 * last frame of this film is the trailer's last frame.
 */
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Bit, Ping } from '../../trailer45/components/Frames';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../../trailer45/theme';
import { LogoMask, bitOn, logoHeight, type LogoPlace } from '../components/Logo';
import { MosaicLogo } from '../components/Mosaic';
import { END } from '../copy';
import { DIVISIONS, SECTIONS, f } from '../timeline';

const A = SECTIONS.mitosis[0];
const T = (b: number) => f(b) - f(A);

/** big while it forms, then up into the end card (the trailer's logoAt) */
const logoAt = (t: number): LogoPlace => {
  const p = interpolate(t, [T(61.5), T(63)], [0, 1], { ...clamp, easing: EASE_MOVE });
  return { cx: 960, cy: 540 + (305 - 540) * p, w: 1640 + (1180 - 1640) * p };
};

const TIMING = {
  divisions: DIVISIONS.map(T),
  divDur: 5,
  fallFrom: T(59),
  fallSpread: T(59.85) - T(59),
  duoFrom: T(59.4),
  duoTo: T(60.5),
  lock: T(61),
  sweepFrom: T(57.5),
};

export const Finale: React.FC = () => {
  const t = useCurrentFrame();
  const lg = logoAt(t);
  const lock = T(61);
  const tl = t - lock;
  // the mosaic: until a few frames after the lock, masked to the letters from the lock on
  const mosaicFade = interpolate(tl, [3, 12], [1, 0], clamp);
  const crisp = interpolate(tl, [0, 6], [0, 1], { ...clamp, easing: EASE_IN });
  const flash = interpolate(tl, [0, 10], [1, 0], clamp);
  const bit = bitOn(lg);
  // the empty bit: hollow and glowing once its tile has fallen, lit on the lock (as the trailer's), ping on 65
  const bitOnA = interpolate(t, [T(59.3), T(59.8)], [0, 1], clamp);
  const hollow = interpolate(tl, [0, 6], [1, 0], clamp);
  const bitGlow = 0.8 + 0.5 * flash + 0.6 * interpolate(t - T(67), [0, 3, 24], [0, 1, 0], clamp);
  // end card
  const badge = interpolate(t, [T(62), T(63.5)], [0, 1], { ...clamp, easing: EASE_IN });
  const line = interpolate(t, [T(63), T(63) + 14], [0, 1], { ...clamp, easing: EASE_IN });
  const drift = interpolate(t, [T(63.5), T(70)], [1, 1.025], clamp);
  const h = logoHeight(lg);
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle 900px at 960px ${lg.cy}px, rgba(124,108,255,${0.1 + 0.18 * flash * (tl >= 0 ? 1 : 0)}), rgba(0,0,0,0) 70%)` }} />
      <AbsoluteFill style={{ scale: String(drift) }}>
        {/* the bit (the #1 row, collapsed) glows, then becomes the first tile */}
        {t < 8 && <Bit x={960} y={540} size={30} intensity={1.6 * interpolate(t, [1, 7], [1, 0], clamp)} />}
        {mosaicFade > 0 && (
          // every shot drifts: the wall pushes in and arrives at 1.0 exactly on the lock
          <div style={{ position: 'absolute', inset: 0, scale: String(interpolate(t, [0, lock], [0.95, 1], { ...clamp, easing: EASE_MOVE })) }}>
            <MosaicLogo t={t} lg={logoAt(Math.min(t, lock))} timing={TIMING} from={{ x: 960, y: 540 }} maskToLogo={tl >= 0} fade={mosaicFade} />
          </div>
        )}
        {tl >= 0 && <LogoMask lg={lg} opacity={crisp} />}
        {flash > 0 && tl >= 0 && <LogoMask lg={lg} color={C.accent} opacity={flash * 0.6} />}
        {bitOnA > 0 && <Bit x={bit.x} y={bit.y} size={bit.size} intensity={bitOnA * bitGlow} hollow={hollow} />}
        <Ping x={bit.x} y={bit.y} t={tl} size={bit.size} dur={20} max={6} />
        <Ping x={bit.x} y={bit.y} t={t - T(65)} size={bit.size} dur={26} max={8} />
        <div
          style={{
            position: 'absolute',
            top: lg.cy + h / 2 + 58,
            width: '100%',
            textAlign: 'center',
            fontFamily: FONT.apple,
            fontWeight: 500,
            fontSize: 92,
            letterSpacing: '-0.015em',
            color: C.offWhite,
            opacity: line,
            translate: `0px ${(1 - line) * 14}px`,
          }}
        >
          {END.line}
        </div>
        <Img
          src={staticFile('brand/dapp-store.png')}
          style={{ position: 'absolute', left: 960 - 270, top: 706 + (1 - badge) * 70, width: 540, height: (540 * 273) / 696, opacity: badge }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
