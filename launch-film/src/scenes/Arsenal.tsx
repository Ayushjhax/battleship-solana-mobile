import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {KineticText} from '../components/KineticText';
import {COPY} from '../config/copy';
import {ARSENAL as B, f} from '../config/timeline';
import {CLAMP, enter} from '../lib/anim';
import {C, EASE, FONT} from '../theme';

/** Attack group, ARSENAL_NAMES order; the Atomic Bomber (the most powerful) ends centred. */
const ITEMS = [
  {src: 'art/weapons/torpedo-bomber.png', ar: 1004 / 1424},
  {src: 'art/weapons/double-torpedo.png', ar: 952 / 1323},
  {src: 'art/weapons/bomber.png', ar: 1007 / 1138},
  {src: 'art/weapons/submarine.png', ar: 749 / 1457},
  {src: 'art/weapons/radar.png', ar: 1241 / 1007},
  {src: 'art/weapons/atomic-bomber.png', ar: 1048 / 1254},
];
const N = ITEMS.length;
const R = 1450; // ring radius (px)
const CY = 1150;

/**
 * An arsenal for every strategy: a smooth carousel that steps one weapon per beat (a
 * metallic tick each) and settles on the Atomic Bomber, centred and glowing.
 */
export const Arsenal: React.FC = () => {
  const frame = useCurrentFrame();
  // rotation in "items": steps on each beat with the camera curve, ending with item N-1 in front
  let rot = 0;
  B.steps.forEach((b, i) => {
    rot += interpolate(frame, [f(b), f(b) + 12], [0, 1], {...CLAMP, easing: EASE.cam});
    void i;
  });
  const front = rot - 1; // item index currently in front (starts at -1: the ring comes in turning)
  const settle = enter(frame, f(B.settle), 26);
  const intro = enter(frame, 0, 26);

  const items = ITEMS.map((it, i) => {
    const theta = ((i - front) / N) * Math.PI * 2;
    const depth = Math.cos(theta); // 1 = front
    const x = 1920 + Math.sin(theta) * R;
    const z = (depth + 1) / 2;
    const scale = 0.42 + 0.58 * z ** 1.6;
    const isHero = i === N - 1;
    const glow = isHero ? settle : 0;
    return {it, i, x, depth, z, scale, glow};
  });
  const frontIdx = Math.round(front);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* hero glow behind the settled Atomic Bomber */}
      <AbsoluteFill
        style={{
          opacity: settle * 0.9,
          background: `radial-gradient(circle 900px at 1920px ${CY}px, rgba(142,134,232,0.34) 0%, rgba(108,95,214,0.12) 38%, rgba(0,0,0,0) 70%)`,
        }}
      />
      <AbsoluteFill style={{opacity: intro, scale: 0.94 + 0.06 * intro}}>
        {[...items]
          .sort((a, b) => a.depth - b.depth)
          .map(({it, i, x, z, scale, glow}) => {
            const size = 1000 * scale;
            const w = it.ar > 1 ? size / it.ar : size;
            const h = it.ar > 1 ? size : size * it.ar;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: x - w / 2,
                  top: CY - h / 2,
                  width: w,
                  height: h,
                  opacity: 0.18 + 0.82 * z ** 2.2,
                  filter: `blur(${(1 - z) * 10}px) brightness(${0.55 + 0.45 * z + glow * 0.15})`,
                  WebkitBoxReflect: `below ${h * 0.08}px linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(0,0,0,0.2) 100%)`,
                }}
              >
                <Img
                  src={staticFile(it.src)}
                  style={{width: '100%', height: '100%', objectFit: 'contain', filter: glow > 0 ? `drop-shadow(0 0 ${60 * glow}px rgba(142,134,232,${0.55 * glow}))` : undefined}}
                />
              </div>
            );
          })}
      </AbsoluteFill>
      {/* the front item's in-game name */}
      {frontIdx >= 0 && frontIdx < N ? (
        <div
          key={frontIdx}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: CY + 640,
            textAlign: 'center',
            fontFamily: FONT.game,
            fontWeight: 700,
            fontSize: 64,
            color: C.white,
            opacity: 1 - Math.min(1, Math.abs(front - frontIdx) * 2.4),
          }}
        >
          {COPY.arsenal.weapons[frontIdx]}
        </div>
      ) : null}
      <div style={{position: 'absolute', left: 0, right: 0, top: 230}}>
        <KineticText text={COPY.arsenal.line} at={f(B.line)} out={f(12) - 12} size="headline" />
      </div>
    </AbsoluteFill>
  );
};
