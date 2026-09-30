/**
 * Beats 0–14: the hook, the four hero cards, the claim and the brand sting.
 */
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { CAST_LABELS, CLAIM, STING } from '../copy';
import { HEROES } from '../cast';
import { Bit, Ping } from '../components/Frames';
import { Footage, cameraAt, toScreen } from '../components/Footage';
import { punchAt } from '../components/Motion';
import { Slam, slam } from '../components/Slam';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../theme';
import { SECTIONS, SHOTS, f } from '../timeline';

/** Darken the paper around a point and lay a warm glow on it: bloom on white paper. */
export const Bloom: React.FC<{ x: number; y: number; r: number; heat: number; dark?: number }> = ({ x, y, r, heat, dark = 0.6 }) => (
  <>
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle ${r * 1.9}px at ${x}px ${y}px, rgba(40,22,70,0) 26%, rgba(40,22,70,${dark * 0.75}) 62%, rgba(14,8,30,${dark}) 100%)`,
        mixBlendMode: 'multiply',
      }}
    />
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle ${r * 1.25}px at ${x}px ${y}px, rgba(255,190,100,${0.5 * heat}) 0%, rgba(255,110,40,${0.22 * heat}) 45%, rgba(255,90,30,0) 100%)`,
        mixBlendMode: 'screen',
      }}
    />
  </>
);

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.hook;
  const cam = cameraAt(shot, frame, 1920, 1080);
  const e = toScreen(cam, 925, 296);
  const heat = interpolate(frame, [0, 12], [1, 0.55], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill style={{ scale: String(punchAt(frame, 0, 0.08, 5)) }}>
        <Footage shot={shot} filter="contrast(1.12) saturate(1.25)" />
        <Bloom x={e.x} y={e.y} r={320} heat={heat} dark={0.8} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** One hero card: freeze-frame with a slight push, label slammed in lower-left over an accent rule. */
const HeroCard: React.FC<{ role: string; label: string; dur: number }> = ({ role, label, dur }) => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [0, dur], [1, 1.05], clamp);
  const s = slam(frame - 1);
  const rule = interpolate(frame, [0, 4], [0.35, 1], { ...clamp, easing: EASE_IN });
  return (
    <AbsoluteFill style={{ background: C.black, overflow: 'hidden' }}>
      <Img
        src={staticFile(`cast/hero/${role}.jpg`)}
        style={{ position: 'absolute', width: 1920, height: 1080, objectFit: 'cover', scale: String(push) }}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(20deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.35) 32%, rgba(0,0,0,0) 55%)' }} />
      <div style={{ position: 'absolute', left: 118, bottom: 132 }}>
        <div style={{ width: 190 * rule, height: 7, background: C.accent, marginBottom: 22, boxShadow: `0 0 18px ${C.accent}` }} />
        <div
          style={{
            fontFamily: FONT.card,
            fontSize: 150,
            lineHeight: 0.9,
            color: C.offWhite,
            letterSpacing: '0.01em',
            scale: String(s.scale),
            transformOrigin: 'left bottom',
            filter: s.blur > 0.05 ? `blur(${s.blur}px)` : undefined,
            opacity: frame < 1 ? 0 : s.opacity,
            whiteSpace: 'pre',
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const CastCards: React.FC = () => {
  const [a] = SECTIONS.cast;
  return (
    <AbsoluteFill>
      {HEROES.map((h, i) => (
        <Sequence key={h.role} name={CAST_LABELS[i]} from={f(a + i) - f(a)} durationInFrames={f(a + i + 1) - f(a + i)}>
          <HeroCard role={h.role} label={CAST_LABELS[i]} dur={f(a + i + 1) - f(a + i)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** REAL PLAYERS. slams centre on 5; on 7 it lifts as REAL BATTLES. slams in below. */
export const Claim: React.FC = () => {
  const frame = useCurrentFrame();
  const [a] = SECTIONS.claim;
  const second = f(a + 2) - f(a);
  const lift = interpolate(frame, [second, second + 6], [0, 1], { ...clamp, easing: EASE_MOVE });
  const push = interpolate(frame, [0, f(a + 4) - f(a)], [1, 1.04], clamp);
  return (
    <AbsoluteFill style={{ background: C.black, alignItems: 'center', justifyContent: 'center', scale: String(push) }}>
      <div style={{ position: 'absolute', top: 540 - 86 - lift * 92, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <Slam text={CLAIM[0]} size={172} />
      </div>
      <div style={{ position: 'absolute', top: 540 - 86 + 92, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <Slam text={CLAIM[1]} at={second} size={172} />
      </div>
    </AbsoluteFill>
  );
};

/**
 * The sting: the bit appears with a ping (beat 9), bursts on the BOOM (beat 11)
 * into one thin tracked line.
 */
export const Sting: React.FC = () => {
  const frame = useCurrentFrame();
  const [a, b] = SECTIONS.sting;
  const boom = f(a + 2) - f(a);
  const end = f(b) - f(a);
  const appear = interpolate(frame, [0, 7], [0, 1], { ...clamp, easing: EASE_IN });
  const pre = interpolate(frame, [boom - 4, boom], [1, 1.5], clamp);
  const t = frame - boom;
  const bitAlive = t < 3;
  const line = interpolate(t, [0, 9], [0, 1], { ...clamp, easing: EASE_IN });
  const flash = interpolate(t, [0, 7], [1, 0], clamp);
  const track = interpolate(frame, [boom, end], [0.5, 0.62], clamp);
  const drift = interpolate(frame, [0, end], [1, 1.035], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill style={{ scale: String(drift) }}>
        {bitAlive && <Bit x={960} y={540} size={34 * appear * pre} intensity={appear * (t >= 0 ? 1.8 : 1)} />}
        <Ping x={960} y={540} t={frame - 1} size={34} dur={24} max={10} />
        <Ping x={960} y={540} t={frame - 9} size={34} dur={20} max={6} />
        {t >= 0 && (
          <>
            {/* the burst: a horizontal streak of light and scattered bits */}
            <div
              style={{
                position: 'absolute',
                left: 960 - 900 * line,
                width: 1800 * line,
                top: 538,
                height: 4,
                background: `linear-gradient(90deg, rgba(124,108,255,0), ${C.accent} 20%, #fff 50%, ${C.accent} 80%, rgba(124,108,255,0))`,
                opacity: flash,
                boxShadow: `0 0 30px ${C.accent}`,
              }}
            />
            <AbsoluteFill style={{ background: `radial-gradient(circle 420px at 960px 540px, rgba(124,108,255,${0.45 * flash}), rgba(0,0,0,0) 70%)` }} />
            {Array.from({ length: 26 }, (_, i) => {
              const ang = random(`sa${i}`) * Math.PI * 2;
              const sp = 8 + random(`ss${i}`) * 30;
              const d = sp * Math.min(t, 16) * (1 - Math.min(t, 16) / 40);
              const sz = 4 + random(`sz${i}`) * 8;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: 960 + Math.cos(ang) * d * 1.9 - sz / 2,
                    top: 540 + Math.sin(ang) * d * 0.5 - sz / 2,
                    width: sz,
                    height: sz,
                    background: i % 3 === 0 ? C.offWhite : C.accent,
                    opacity: interpolate(t, [0, 18], [1, 0], clamp),
                    boxShadow: `0 0 10px ${C.accent}`,
                  }}
                />
              );
            })}
            <div
              style={{
                position: 'absolute',
                top: 540 - 26,
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                clipPath: `inset(0 ${50 - 50 * line}% 0 ${50 - 50 * line}%)`,
              }}
            >
              <div
                style={{
                  fontFamily: FONT.card,
                  fontSize: 44,
                  lineHeight: 1.2,
                  letterSpacing: `${track}em`,
                  marginRight: `-${track}em`,
                  color: C.offWhite,
                  opacity: interpolate(t, [0, 4], [0.4, 1], clamp),
                  textShadow: `0 0 ${24 * flash}px ${C.accent}`,
                }}
              >
                {STING}
              </div>
            </div>
          </>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
