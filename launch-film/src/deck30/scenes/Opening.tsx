/**
 * Beats 0–9: the poster (frame 0), ★1 ALIVE, and the REAL strobe.
 */
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Bit } from '../../trailer45/components/Frames';
import { punchAt } from '../../trailer45/components/Motion';
import { Slam } from '../../trailer45/components/Slam';
import { Bloom } from '../../trailer45/scenes/Opening';
import { C, clamp } from '../../trailer45/theme';
import { BitShatter, explode } from '../components/BitShatter';
import { Footage, cameraAt, toScreen } from '../components/Footage';
import { LogoMask, bitOn, type LogoPlace } from '../components/Logo';
import { REAL } from '../copy';
import { SECTIONS, SHOTS, STROBE, f, type Shot } from '../timeline';

/** the explosion, in recording px */
const FIRE_AT = { x: 934, y: 286 } as const;
/** the poster's logo lockup: small and confident, bottom centre, inside title-safe */
export const POSTER_LOGO: LogoPlace = { cx: 960, cy: 938, w: 600 };

/**
 * PosterFreeze — frame 0 is a finished slide: the explosion frozen at its peak (the same prepared clip the ALIVE
 * shot plays, so the unfreeze has zero jump), graded like a poster, the logo lockup at the bottom. On the hit,
 * time cracks back on: flash (Finish), zoom punch, shake, the explosion plays on and its shockwave blows the logo
 * apart into bits.
 */
export const PosterFreeze: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.poster;
  const hit = f(1);
  const t = frame - hit;
  const cam = cameraAt(shot, frame, 1920, 1080);
  const e = toScreen(cam, FIRE_AT.x, FIRE_AT.y);
  const heat = t < 0 ? 1.0 : interpolate(t, [0, 3, 20], [1.6, 1.15, 0.35], clamp);
  const dark = t < 0 ? 0.95 : interpolate(t, [0, 10], [0.72, 0.86], clamp);
  // the poster grade: lifted shadows crushed a touch, warm highlights; eases back to the battle grade after the hit
  const posterGrade = interpolate(t, [0, 8], [1, 0], clamp);
  const filter = `contrast(${1.1 + 0.08 * posterGrade}) saturate(${1.18 + 0.1 * posterGrade}) brightness(${1 - 0.03 * posterGrade})`;
  // shockwave: a ring of light racing out of the fireball
  const R = Math.max(0, t) * 95;
  const ringA = interpolate(t, [0, 2, 18], [0, 1, 0], clamp);
  const bit = bitOn(POSTER_LOGO);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill style={{ scale: String(punchAt(frame, hit, 0.08, 5)) }}>
        <Footage shot={shot} holdUntil={1} filter={filter} />
        <Bloom x={e.x} y={e.y} r={300} heat={heat} dark={dark} />
        {/* the poster's edges burn down to deep ink */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 58% 62% at ${e.x}px ${e.y}px, rgba(5,4,11,0) 40%, rgba(5,4,11,0.78) 100%)`,
            opacity: 0.4 + 0.6 * posterGrade,
          }}
        />
        {/* an anamorphic streak through the fireball: the poster's one flourish */}
        <div
          style={{
            position: 'absolute',
            left: e.x - 820,
            top: e.y - 3,
            width: 1640,
            height: 6,
            borderRadius: 3,
            background: 'linear-gradient(90deg, rgba(124,108,255,0), rgba(124,108,255,0.55) 22%, rgba(255,226,190,0.95) 50%, rgba(124,108,255,0.55) 78%, rgba(124,108,255,0))',
            boxShadow: '0 0 26px rgba(255,190,130,0.55), 0 0 60px rgba(124,108,255,0.45)',
            opacity: (0.32 + 0.25 * Math.max(0, 1 - Math.abs(t) / 6)) * (t < 0 ? 1 : interpolate(t, [0, 14], [1.6, 0], clamp)),
          }}
        />
        {/* poster finish: the bottom burns down to ink so the lockup sits on calm, deep violet-black */}
        <AbsoluteFill
          style={{
            background: 'linear-gradient(to bottom, rgba(5,4,11,0) 55%, rgba(5,4,11,0.55) 78%, rgba(5,4,11,0.85) 100%)',
            opacity: 0.35 + 0.65 * posterGrade,
          }}
        />
        {ringA > 0 && (
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle ${R + 70}px at ${e.x}px ${e.y}px, rgba(255,240,225,0) ${Math.max(0, ((R - 90) / (R + 70)) * 100)}%, rgba(255,236,214,${0.55 * ringA}) ${(R / (R + 70)) * 100}%, rgba(124,108,255,${0.35 * ringA}) ${((R + 22) / (R + 70)) * 100}%, rgba(124,108,255,0) 100%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
      </AbsoluteFill>
      {/* the lockup: crisp until the shockwave reaches it, then its bits */}
      {t < 0 ? (
        <>
          <LogoMask lg={POSTER_LOGO} />
          <Bit x={bit.x} y={bit.y} size={bit.size} intensity={0.85} />
        </>
      ) : (
        <>
          <BitShatter lg={POSTER_LOGO} state={explode(t, e, { speed: 95, push: 62, life: 26, seed: 'alive' })} />
          {/* the bit itself is thrown clear, burning bright */}
          {(() => {
            const arrive = Math.hypot(bit.x - e.x, bit.y - e.y) / 95;
            const u = Math.max(0, t - arrive);
            const a = interpolate(u, [0, 20], [1, 0], clamp);
            return a > 0 ? <Bit x={bit.x + u * 22} y={bit.y + u * 14 - 0.05 * u * u} size={bit.size * (1 + u * 0.05)} intensity={0.85 + 0.9 * a} /> : null;
          })()}
        </>
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- REAL — the strobe on the 8ths

const StrobeShot: React.FC<{ i: number; b: number; dur: number }> = ({ i, b, dur }) => {
  const frame = useCurrentFrame();
  const s = STROBE[i];
  const push = interpolate(frame, [0, dur], [1, 1.05], clamp);
  if (s.kind === 'face') {
    return (
      <AbsoluteFill style={{ overflow: 'hidden', background: C.black }}>
        <Img src={staticFile(`deck30/cast/strobe/${s.crop}.jpg`)} style={{ width: 1920, height: 1080, objectFit: 'cover', scale: String(push) }} />
      </AbsoluteFill>
    );
  }
  const shot: Shot = { src: s.src, from: b, to: b + 0.5, in: s.in, cam: [[b, s.x, s.y, s.zoom], [b + 0.5, s.x, s.y, s.zoom * 1.05]] };
  return <Footage shot={shot} filter="contrast(1.1) saturate(1.2)" />;
};

export const Real: React.FC = () => {
  const frame = useCurrentFrame();
  const [a, b] = SECTIONS.real;
  const second = f(a + 3) - f(a);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      {STROBE.map((_, i) => {
        const bt = a + i / 2;
        const from = f(bt) - f(a);
        const dur = f(bt + 0.5) - f(bt);
        return (
          <Sequence key={i} name={`strobe ${i} (${STROBE[i].kind})`} from={from} durationInFrames={dur} premountFor={30}>
            <StrobeShot i={i} b={bt} dur={dur} />
          </Sequence>
        );
      })}
      {/* the plate dims under the words (text never sits on busy footage) */}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 62% 48% at 50% 50%, rgba(5,4,11,0.72) 0%, rgba(5,4,11,0.5) 60%, rgba(5,4,11,0.35) 100%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ scale: String(interpolate(frame, [0, f(b) - f(a)], [1, 1.04], clamp)) }}>
          {frame < second ? <Slam text={REAL[0]} size={168} /> : <Slam text={REAL[1]} at={second} size={168} />}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

