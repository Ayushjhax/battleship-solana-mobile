/**
 * Beats 17–29: ★3 the flip (base → fleet → arsenal → rival, face-on on 17, 19, 21, 23), ★4 FIRE written in target
 * locks on the back of the screen (the game's board), the silence, and the period landing on the drop's downbeat.
 * Ships and weapons break the frame: they rise out of the glass and hover in front of it.
 */
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Facecam, Ping } from '../../trailer45/components/Frames';
import { Slam } from '../../trailer45/components/Slam';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../../trailer45/theme';
import { FlipScreen } from '../components/FlipScreen';
import { UiClip } from '../components/Footage';
import { LockOnGrid, WORD_BOX } from '../components/LockOnGrid';
import { ARSENAL, BASE_PIECES, FLEET, FLIP } from '../copy';
import { LOCKS, PERIOD_FRAMES, SECTIONS, UI_CLIPS, f } from '../timeline';
import { FLIP_GLASS } from './TheBit';

const A = SECTIONS.flip[0];
const L = (b: number) => f(b) - f(A);
const LANDINGS = [L(17), L(19), L(21), L(23), L(25)];
const FLIP_FRAMES = 8;
const G = FLIP_GLASS;
const GC = { x: G.x + G.w / 2, y: G.y + G.h / 2 };

/** soft accent light behind the glass */
const Backlight: React.FC<{ a?: number }> = ({ a = 0.18 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 900px 520px at ${GC.x}px ${GC.y}px, rgba(124,108,255,${a}), rgba(62,47,184,${a * 0.3}) 50%, rgba(0,0,0,0) 78%)` }} />
);

/** a face's glass content, dimmed while things hover in front of it (text never sits on a busy plate) */
const Dim: React.FC<{ k: number; children: React.ReactNode }> = ({ k, children }) => (
  <div style={{ position: 'absolute', inset: 0, filter: k > 0 ? `brightness(${1 - 0.62 * k}) blur(${2.5 * k}px)` : undefined }}>{children}</div>
);

// ---------------------------------------------------------------- the pieces in front of the glass

/** progress of a piece that arrives at `at` (local frame) and leaves when the next flip starts */
const arrive = (frame: number, at: number, leave: number, dur = 5) => {
  const inn = interpolate(frame, [at - dur, at], [0, 1], { ...clamp, easing: EASE_IN });
  const out = interpolate(frame, [leave, leave + 4], [0, 1], { ...clamp, easing: EASE_MOVE });
  return { inn, out, on: inn > 0 && out < 1 };
};

const PIECE_SPOTS = [
  { x: G.x - 40, y: G.y + 10, w: 250 }, //               shipyard, top-left corner
  { x: G.x + G.w - 160, y: G.y - 120, w: 170 }, //       lighthouse, over the top-right
  { x: G.x - 150, y: G.y + G.h - 180, w: 230 }, //       AA gun, bottom-left
  { x: G.x + G.w - 60, y: G.y + G.h - 150, w: 200 }, //  mine, bottom-right
  { x: G.x + G.w - 30, y: G.y + 180, w: 210 }, //        harbour defence, right edge
];
const PIECE_ORDER = [3, 4, 2, 0, 1]; // snap order of BASE_PIECES into the spots: shipyard, lighthouse, AA gun, mine, harbour

const BasePieces: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {PIECE_ORDER.map((pi, k) => {
      const piece = BASE_PIECES[pi];
      const spot = PIECE_SPOTS[k];
      const { inn, out, on } = arrive(frame, L(17.5 + k * 0.25), L(19) - FLIP_FRAMES, 4);
      if (!on) return null;
      return (
        <Img
          key={piece.art}
          src={staticFile(piece.art)}
          style={{
            position: 'absolute',
            left: spot.x,
            top: spot.y,
            width: spot.w,
            height: spot.w,
            objectFit: 'contain',
            scale: String((1.35 - 0.35 * inn) * (1 - 0.4 * out)),
            opacity: Math.min(1, inn * 2) * (1 - out),
            filter: 'drop-shadow(0 18px 18px rgba(0,0,0,0.55)) drop-shadow(0 0 22px rgba(124,108,255,0.35))',
          }}
        />
      );
    })}
  </>
);

const SHIP_ASPECT: Record<string, number> = { battleship: 1918 / 557, cruiser: 1878 / 504, destroyer: 1720 / 535, boat: 1746 / 541 };
const FleetRise: React.FC<{ frame: number }> = ({ frame }) => {
  const gap = 46;
  const total = FLEET.reduce((n, s) => n + s.len, 0);
  const unit = (1720 - gap * (FLEET.length - 1)) / total;
  let x = 100;
  return (
    <>
      {FLEET.map((s, i) => {
        const w = s.len * unit;
        const h = w / SHIP_ASPECT[s.art];
        const x0 = x;
        x += w + gap;
        const { inn, out, on } = arrive(frame, L(19.5 + i * 0.25), L(21) - FLIP_FRAMES, 6);
        if (!on) return null;
        const y = GC.y - 70;
        // rises out of the glass: from small and inside it, up and towards the camera
        const sc = (0.45 + 0.55 * inn) * (1 - 0.5 * out);
        const fromX = GC.x - (x0 + w / 2);
        const dx = fromX * (1 - inn) * 0.6;
        const dy = 70 * (1 - inn) - 18 * inn;
        const label = interpolate(frame - L(19.5 + i * 0.25), [0, 5], [0, 1], { ...clamp, easing: EASE_IN }) * (1 - out);
        return (
          <React.Fragment key={s.art}>
            <Img
              src={staticFile(`art/fleet/${s.art}.png`)}
              style={{
                position: 'absolute',
                left: x0 + dx,
                top: y - h / 2 + dy,
                width: w,
                height: h,
                objectFit: 'contain',
                scale: String(sc),
                opacity: Math.min(1, inn * 1.6) * (1 - out),
                filter: `drop-shadow(0 ${26 * inn}px ${22 * inn}px rgba(0,0,0,0.65)) drop-shadow(0 0 ${26 * inn}px rgba(200,190,255,0.45)) brightness(1.12)`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: x0 + w / 2 - 220,
                width: 440,
                top: y + 112,
                textAlign: 'center',
                fontFamily: FONT.game,
                fontWeight: 700,
                fontSize: 42,
                color: C.offWhite,
                opacity: label,
                translate: `0px ${(1 - label) * 14}px`,
                textShadow: '0 2px 18px rgba(0,0,0,0.8)',
              }}
            >
              {s.name}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

const ArsenalRise: React.FC<{ frame: number }> = ({ frame }) => {
  const n = ARSENAL.length;
  const start = L(21) + 2;
  const leave = L(23) - FLIP_FRAMES;
  const ticks = [21.25, 21.5, 21.75, 21.875, 22].map(L);
  let steps = 0;
  for (const tk of ticks) steps += interpolate(frame, [tk - 2, tk + 1], [0, 1], { ...clamp, easing: EASE_MOVE });
  const rise = interpolate(frame, [start, start + 6], [0, 1], { ...clamp, easing: EASE_IN });
  const out = interpolate(frame, [leave, leave + 4], [0, 1], { ...clamp, easing: EASE_MOVE });
  if (rise <= 0 || out >= 1) return null;
  const landed = frame - L(22);
  const glow = interpolate(landed, [0, 5], [0, 1], { ...clamp, easing: EASE_IN });
  const R = 640;
  const persp = 1400;
  const offset = n - 1 - ticks.length; // the hero (last) lands front-centre after the last tick
  const items = ARSENAL.map((it, i) => {
    const ang = ((i - offset - steps) * 2 * Math.PI) / n;
    const x = Math.sin(ang) * R;
    const z = Math.cos(ang) * R - R;
    return { it, i, ang, x, z, sc: persp / (persp - z) };
  }).sort((p, q) => p.z - q.z);
  const cy = GC.y - 40 - 40 * rise;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: rise * (1 - out), scale: String(0.6 + 0.4 * rise) }}>
      {items.map(({ it, i, ang, x, sc }) => {
        const front = Math.cos(ang);
        const hero = i === n - 1;
        const dim = landed >= 0 && !hero ? 1 - 0.7 * glow : 1;
        const size = (hero ? 330 * (1 + 0.3 * glow) : 300) * sc;
        return (
          <div
            key={it.name}
            style={{
              position: 'absolute',
              left: GC.x + x * sc - size / 2,
              top: cy - size / 2 + (1 - sc) * 70,
              width: size,
              height: size,
              opacity: Math.max(0, (0.3 + 0.7 * (front * 0.5 + 0.5)) * dim),
              transform: `perspective(1200px) rotateY(${(-ang * 180) / Math.PI * 0.7}deg)`,
              filter: hero && glow > 0
                ? `drop-shadow(0 0 ${28 * glow}px ${C.accent}) drop-shadow(0 0 ${70 * glow}px rgba(124,108,255,0.65))`
                : `drop-shadow(0 20px 16px rgba(0,0,0,0.55)) brightness(${0.65 + 0.35 * (front * 0.5 + 0.5)})`,
            }}
          >
            <Img src={staticFile(`art/${it.art}.png`)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', top: G.y + G.h - 132, width: '100%', textAlign: 'center', opacity: glow, translate: `0px ${(1 - glow) * 16}px` }}>
        <div style={{ fontFamily: FONT.game, fontWeight: 800, fontSize: 56, color: C.offWhite, textShadow: '0 2px 20px rgba(0,0,0,0.85)' }}>{ARSENAL[n - 1].name}</div>
        <div style={{ fontFamily: FONT.game, fontWeight: 600, fontSize: 30, color: C.inkFaint, marginTop: 6, textShadow: '0 2px 16px rgba(0,0,0,0.85)' }}>
          {'info' in ARSENAL[n - 1] ? (ARSENAL[n - 1] as { info: string }).info : ''}
        </div>
      </div>
    </div>
  );
};

/** lock-on brackets around the rival's tile (the tile, never the face) */
const TileLock: React.FC<{ box: { x: number; y: number; w: number; h: number }; t: number }> = ({ box, t }) => {
  if (t < 0) return null;
  const p = interpolate(t, [0, 4], [0, 1], { ...clamp, easing: EASE_IN });
  const pad = 18 + (1 - p) * 50;
  const Lc = 46;
  const corner = (x: number, y: number, dx: number, dy: number, k: string) => (
    <React.Fragment key={k}>
      <div style={{ position: 'absolute', left: dx > 0 ? x : x - Lc, top: y - 3, width: Lc, height: 6, background: C.accent, boxShadow: `0 0 14px ${C.accent}`, opacity: p }} />
      <div style={{ position: 'absolute', left: x - 3, top: dy > 0 ? y : y - Lc, width: 6, height: Lc, background: C.accent, boxShadow: `0 0 14px ${C.accent}`, opacity: p }} />
    </React.Fragment>
  );
  return (
    <>
      {corner(box.x - pad, box.y - pad, 1, 1, 'tl')}
      {corner(box.x + box.w + pad, box.y - pad, -1, 1, 'tr')}
      {corner(box.x - pad, box.y + box.h + pad, 1, -1, 'bl')}
      {corner(box.x + box.w + pad, box.y + box.h + pad, -1, -1, 'br')}
    </>
  );
};

// ---------------------------------------------------------------- the scene

export const Flip: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = (b0: number, b1: number) => L(b1) - L(b0);
  // the push into the board: the screen grows past the frame as the letterbox comes in, then everything stops on 28
  const push = interpolate(frame, [L(25), L(26)], [1, 1.85], { ...clamp, easing: EASE_MOVE }) * interpolate(frame, [L(26), L(28)], [1, 1.05], clamp);
  const lockFrames = LOCKS.map((b) => f(b));
  const periodFrame = f(29);
  // the board view on the glass: the word + its period centred, at 0.498 px per board unit
  const view = { scale: 0.498, cx: G.w / 2, cy: G.h / 2, fx: WORD_BOX.x + WORD_BOX.w / 2, fy: WORD_BOX.y + WORD_BOX.h / 2 };
  /** a face's media starts playing (from its `in`) as the face turns in */
  const At: React.FC<{ k: number; children: React.ReactNode }> = ({ k, children }) => (
    <Sequence from={LANDINGS[k] - (k ? FLIP_FRAMES / 2 : 0)} layout="none">
      {children}
    </Sequence>
  );
  const faces = [
    // BASE: the AA gun lands on the board, Points 260 → 250
    (since: number) => (
      <Dim k={interpolate(since, [L(17.5), L(18)], [0, 0.25], clamp)}>
        <At k={0}>
          <UiClip clip={UI_CLIPS.base} dur={dur(17, 19)} push={[1.0, 1.05]} />
        </At>
      </Dim>
    ),
    (since: number) => (
      <Dim k={interpolate(since, [0, 8], [0, 1], clamp)}>
        <At k={1}>
          <UiClip clip={UI_CLIPS.fleet} dur={dur(19, 21)} push={[1.04, 1.08]} freezeAfter={0} />
        </At>
      </Dim>
    ),
    (since: number) => (
      <Dim k={interpolate(since, [0, 8], [0, 1], clamp)}>
        <At k={2}>
          <UiClip clip={UI_CLIPS.arsenal} dur={dur(21, 23)} push={[1.04, 1.08]} freezeAfter={0} />
        </At>
      </Dim>
    ),
    // RIVAL: radar sweep → punch into the VS (frozen before the name plates)
    (since: number) => {
      const vs = L(23.5) - L(23);
      return since < vs ? (
        <At k={3}>
          <UiClip clip={UI_CLIPS.radar} dur={vs} push={[1.0, 1.05]} />
        </At>
      ) : (
        <div style={{ position: 'absolute', inset: 0, scale: String(interpolate(since - vs, [0, 5], [1.12, 1.04], { ...clamp, easing: EASE_IN })) }}>
          <Sequence from={L(23.5)} layout="none">
            <UiClip clip={UI_CLIPS.versus} dur={dur(23.5, 25)} push={[1.0, 1.03]} freezeAfter={Math.round((3.07 - UI_CLIPS.versus.in) * 30)} />
          </Sequence>
        </div>
      );
    },
    // THE BACK: the game's board
    () => <LockOnGrid frame={f(A) + frame} view={view} lockFrames={lockFrames} periodFrame={periodFrame} width={G.w} height={G.h} />,
  ];
  const labelAt = (b: number) => frame >= L(b) && frame < L(b + 2) - FLIP_FRAMES;
  const labels: [number, string][] = [[17, FLIP.base], [19, FLIP.fleet], [21, FLIP.arsenal], [23, FLIP.rival]];
  const fc = { x: G.x + G.w - 170, y: G.y + G.h - 250, w: 300, h: 300 };
  // the period lands on the drop's downbeat; its white blooms out of it, then the drop cuts in
  const tp = f(A) + frame - periodFrame;
  const bloom = interpolate(tp, [0, PERIOD_FRAMES - 1], [0, 1], { ...clamp, easing: EASE_IN });
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <Backlight a={0.2 * (1 - interpolate(frame, [L(25), L(26)], [0, 1], clamp))} />
      <FlipScreen box={G} landings={LANDINGS} flipFrames={FLIP_FRAMES} faces={faces} scale={push} radius={26} />
      {frame < L(21) && <BasePieces frame={frame} />}
      {frame >= L(19) - 2 && frame < L(21) + 2 && <FleetRise frame={frame} />}
      {frame >= L(21) && frame < L(23) + 2 && <ArsenalRise frame={frame} />}
      {frame >= L(23) && frame < L(25) && (
        <>
          <Ping x={GC.x} y={G.y + G.h * 0.31} t={frame - L(23.1)} size={36} dur={20} max={10} />
          <div style={{ opacity: interpolate(frame, [L(25) - FLIP_FRAMES + 2, L(25)], [1, 0], clamp) }}>
            <Facecam src="deck30/cast/face/fc-rival.jpg" box={fc} at={L(23.875)} from="right" />
            <TileLock box={fc} t={frame - L(24.125)} />
          </div>
        </>
      )}
      {labels.map(([b, text]) =>
        labelAt(b) ? (
          <div key={text} style={{ position: 'absolute', top: 150, width: '100%', display: 'flex', justifyContent: 'center' }}>
            <Slam text={text} at={L(b)} size={124} />
          </div>
        ) : null,
      )}
      {tp >= 1 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle ${200 + 1900 * bloom}px at ${GC.x + (WORD_BOX.x + WORD_BOX.w - view.fx - 50) * view.scale * push}px ${GC.y + (WORD_BOX.y + WORD_BOX.h - view.fy - 50) * view.scale * push}px, rgba(255,255,255,1) 55%, rgba(232,228,255,0.9) 75%, rgba(124,108,255,0) 100%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
