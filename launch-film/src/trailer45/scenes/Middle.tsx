/**
 * Beats 14–46: build, fleet, arsenal, rival, and FIRE.
 */
import { Video } from '@remotion/media';
import { CameraMotionBlur } from '@remotion/motion-blur';
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ARSENAL, CARDS, DEFENCE, FLEET } from '../copy';
import { Facecam, Glass, Ping } from '../components/Frames';
import { punchAt } from '../components/Motion';
import { Card, Slam } from '../components/Slam';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../theme';
import { FPS, SECTIONS, UI_CLIPS, f } from '../timeline';

/** local frame of a global beat, inside a section that starts at beat `a` */
const lf = (a: number, beat: number) => f(beat) - f(a);

/** A UI clip (1920 x 862 prepared) that fills a glass screen. */
const UiClip: React.FC<{ clip: { src: string; in: number }; push?: [number, number]; dur: number }> = ({ clip, push = [1, 1.04], dur }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, dur], push, clamp);
  return (
    <Video
      src={staticFile(`media/${clip.src}.mp4`)}
      trimBefore={Math.round(clip.in * FPS)}
      muted
      style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', scale: String(s) }}
    />
  );
};

/** Soft accent light behind floating screens and objects. */
const Backlight: React.FC<{ x?: number; y?: number; r?: number; a?: number }> = ({ x = 960, y = 540, r = 900, a = 0.22 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(circle ${r}px at ${x}px ${y}px, rgba(124,108,255,${a}), rgba(62,47,184,${a * 0.35}) 45%, rgba(0,0,0,0) 75%)` }} />
);

const GLASS_WIDE = { x: 210, y: 208, w: 1500, h: 674 }; // 2.225:1 UI captures

// ---------------------------------------------------------------- BUILD
const PORT = {
  map: { w: 1774, h: 887 },
  // the game's own layout (src/features/city/cityLayout.ts): ground-line centre + drawn width, painter's order
  buildings: [
    ['naval_academy', 372, 192, 160], ['gazette', 520, 238, 134], ['harbour_defence', 1578, 312, 156],
    ['ink_and_pen_shop', 232, 358, 158], ['shipyard', 1366, 412, 206], ['captains_log', 1136, 424, 158],
    ['admiralty', 660, 432, 236], ['foundry', 1626, 486, 176], ['bounty_board', 560, 584, 132],
    ['scrapyard', 1440, 592, 190], ['fleet_tavern', 300, 600, 184], ['armory', 1560, 700, 196],
    ['fish_market', 868, 712, 196], ['expedition_dock', 1170, 720, 196], ['lighthouse', 1392, 842, 132],
  ] as const,
  art: {
    admiralty: [317, 357], foundry: [322, 364], fish_market: [309, 303], scrapyard: [336, 299], naval_academy: [290, 345],
    armory: [345, 292], shipyard: [344, 309], bounty_board: [261, 306], fleet_tavern: [340, 324], gazette: [257, 315],
    expedition_dock: [386, 367], lighthouse: [305, 373], harbour_defence: [294, 354], ink_and_pen_shop: [295, 336], captains_log: [304, 344],
  } as Record<string, [number, number]>,
};

const PortCity: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const scale = (1080 / PORT.map.h) * interpolate(frame, [0, dur], [1.02, 1.1], clamp);
  const cx = 930;
  const cy = 470;
  const ox = 960 - cx * scale;
  const oy = 540 - cy * scale;
  return (
    <AbsoluteFill style={{ background: C.paper, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: ox, top: oy, width: PORT.map.w * scale, height: PORT.map.h * scale }}>
        <Img src={staticFile('port/map.png')} style={{ position: 'absolute', width: '100%', height: '100%' }} />
        {PORT.buildings.map(([id, x, y, w], i) => {
          const [aw, ah] = PORT.art[id];
          const h = (w * ah) / aw;
          const t = frame - 1 - i * 1.1;
          const p = interpolate(t, [0, 5], [0, 1], { ...clamp, easing: EASE_IN });
          if (t < 0) return null;
          return (
            <Img
              key={id}
              src={staticFile(`port/buildings/${id}.png`)}
              style={{
                position: 'absolute',
                left: (x - w / 2) * scale,
                top: (y - h) * scale,
                width: w * scale,
                height: h * scale,
                translate: `0px ${(1 - p) * -60}px`,
                scale: String(1.18 - 0.18 * p),
                transformOrigin: '50% 100%',
                opacity: Math.min(1, p * 2),
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** The game's graph paper, drawn plainly (ruled lines, red margin). */
const GraphPaper: React.FC<{ cell?: number; ox?: number; oy?: number }> = ({ cell = 72, ox = 0, oy = 0 }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: Math.ceil(1920 / cell) + 2 }, (_, i) => {
        const x = ((ox % cell) + cell) % cell + (i - 1) * cell;
        const major = (i + Math.floor(ox / cell)) % 5 === 0;
        return <line key={`v${i}`} x1={x} x2={x} y1={0} y2={1080} stroke={major ? C.gridMajor : C.gridMinor} strokeWidth={major ? 3 : 2} />;
      })}
      {Array.from({ length: Math.ceil(1080 / cell) + 2 }, (_, i) => {
        const y = ((oy % cell) + cell) % cell + (i - 1) * cell;
        const major = (i + Math.floor(oy / cell)) % 5 === 0;
        return <line key={`h${i}`} y1={y} y2={y} x1={0} x2={1920} stroke={major ? C.gridMajor : C.gridMinor} strokeWidth={major ? 3 : 2} />;
      })}
      <line x1={0} x2={1920} y1={96} y2={96} stroke={C.ruleRed} strokeWidth={3} opacity={0.8} />
    </svg>
  </AbsoluteFill>
);

const DefenceSnap: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [0, dur], [1, 1.06], clamp);
  const spots = [
    { x: 660, y: 520, size: 440 },
    { x: 1270, y: 520, size: 400 },
  ];
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ scale: String(push) }}>
        <GraphPaper cell={72} ox={24} oy={20} />
        {DEFENCE.map((d, i) => {
          const at = i * 6;
          const t = frame - at;
          if (t < 0) return null;
          const p = interpolate(t, [0, 5], [0, 1], { ...clamp, easing: EASE_IN });
          const ring = interpolate(t, [2, 12], [0, 1], clamp);
          const s = spots[i];
          return (
            <React.Fragment key={d.name}>
              <div
                style={{
                  position: 'absolute',
                  left: s.x - (s.size * (0.7 + ring * 0.6)) / 2,
                  top: s.y - (s.size * (0.7 + ring * 0.6)) / 2,
                  width: s.size * (0.7 + ring * 0.6),
                  height: s.size * (0.7 + ring * 0.6),
                  borderRadius: '50%',
                  border: `5px solid ${C.ink}`,
                  opacity: (1 - ring) * 0.6,
                }}
              />
              <Img
                src={staticFile(`art/${d.art}.png`)}
                style={{
                  position: 'absolute',
                  left: s.x - s.size / 2,
                  top: s.y - s.size / 2,
                  width: s.size,
                  height: s.size,
                  objectFit: 'contain',
                  scale: String(1.45 - 0.45 * p),
                  opacity: Math.min(1, p * 2.5),
                  filter: `drop-shadow(0 ${14 * p}px ${10 * p}px rgba(40,20,90,0.35))`,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: s.x - 200,
                  width: 400,
                  top: s.y + s.size / 2 + 18,
                  textAlign: 'center',
                  fontFamily: FONT.game,
                  fontWeight: 700,
                  fontSize: 46,
                  color: C.ink,
                  opacity: interpolate(t, [3, 8], [0, 1], clamp),
                }}
              >
                {d.name}
              </div>
            </React.Fragment>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Build: React.FC = () => {
  const [a] = SECTIONS.build;
  const d = (b0: number, b1: number) => ({ from: lf(a, b0), durationInFrames: lf(a, b1) - lf(a, b0) });
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="card" {...d(14, 16)}>
        <Card text={CARDS.build} />
      </Sequence>
      <Sequence name="base: AA gun placed" {...d(16, 18)}>
        <AbsoluteFill style={{ background: C.night }}>
          <Backlight />
          <Glass box={GLASS_WIDE}>
            <UiClip clip={UI_CLIPS.base} dur={d(16, 18).durationInFrames} push={[1.02, 1.08]} />
          </Glass>
        </AbsoluteFill>
      </Sequence>
      <Sequence name="Port City" {...d(18, 20)}>
        <PortCity dur={d(18, 20).durationInFrames} />
      </Sequence>
      <Sequence name="defence snaps in" {...d(20, 22)}>
        <DefenceSnap dur={d(20, 22).durationInFrames} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- FLEET
const SHIP_ASPECT: Record<string, number> = { battleship: 1918 / 557, cruiser: 1878 / 504, destroyer: 1720 / 535, boat: 1746 / 541 };

const Ship: React.FC<{ i: number; x: number; w: number; land: number }> = ({ i, x, w, land }) => {
  const frame = useCurrentFrame();
  const s = FLEET[i];
  const h = w / SHIP_ASPECT[s.art];
  const t = frame - land;
  const p = interpolate(t, [-5, 0], [0, 1], { ...clamp, easing: EASE_IN });
  const dx = (1 - p) * 1500;
  const baseY = 520;
  const label = interpolate(t, [1, 7], [0, 1], { ...clamp, easing: EASE_IN });
  if (t < -5) return null;
  return (
    <>
      <Img
        src={staticFile(`art/fleet/${s.art}.png`)}
        style={{ position: 'absolute', left: x + dx, top: baseY - h / 2, width: w, height: h, objectFit: 'contain' }}
      />
      {/* reflection */}
      <Img
        src={staticFile(`art/fleet/${s.art}.png`)}
        style={{
          position: 'absolute',
          left: x + dx,
          top: baseY + h / 2 + 6,
          width: w,
          height: h,
          objectFit: 'contain',
          scale: '1 -1',
          opacity: 0.13,
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0) 65%)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0) 65%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: x + w / 2 - 200,
          width: 400,
          top: 680,
          textAlign: 'center',
          opacity: label,
          translate: `0px ${(1 - label) * 16}px`,
        }}
      >
        <div style={{ fontFamily: FONT.game, fontWeight: 700, fontSize: 44, color: C.offWhite }}>{s.name}</div>
        <div style={{ fontFamily: FONT.game, fontWeight: 600, fontSize: 30, color: C.inkFaint, marginTop: 6 }}>
          ×{s.count} · {s.len} {s.len === 1 ? 'cell' : 'cells'}
        </div>
      </div>
    </>
  );
};

export const Fleet: React.FC = () => {
  const frame = useCurrentFrame();
  const [a, b] = SECTIONS.fleet;
  const total = FLEET.reduce((n, s) => n + s.len, 0);
  const gap = 56;
  const unit = (1760 - gap * (FLEET.length - 1)) / total;
  let x = 80;
  const xs = FLEET.map((s) => {
    const v = x;
    x += s.len * unit + gap;
    return v;
  });
  const lineup = lf(a, 24);
  const drift = interpolate(frame, [lineup, lf(a, b)], [1, 1.045], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="card" durationInFrames={lineup}>
        <Card text={CARDS.fleet} />
      </Sequence>
      <Sequence name="lineup" from={lineup}>
        <AbsoluteFill style={{ background: C.night }}>
          <Backlight y={560} r={1100} a={0.16} />
          <AbsoluteFill style={{ scale: String(drift) }}>
            {FLEET.map((s, i) => {
              const land = f(24 + i * 0.5) - f(24) + 4;
              const moving = frame - lineup >= land - 5 && frame - lineup <= land;
              const ship = <Ship i={i} x={xs[i]} w={s.len * unit} land={land} />;
              return (
                <AbsoluteFill key={s.art}>
                  {moving ? (
                    <CameraMotionBlur shutterAngle={200} samples={6}>
                      {ship}
                    </CameraMotionBlur>
                  ) : (
                    ship
                  )}
                </AbsoluteFill>
              );
            })}
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- ARSENAL
const hero = ARSENAL[ARSENAL.length - 1];
const ARSENAL_HERO_INFO = 'info' in hero ? hero.info : '';
export const Arsenal: React.FC = () => {
  const frame = useCurrentFrame();
  const [a, b] = SECTIONS.arsenal;
  const start = lf(a, 32);
  const ticks = [32, 32.5, 33, 33.25, 33.5, 33.75, 34].map((bt) => lf(a, bt));
  const n = ARSENAL.length;
  // steps completed (fractional during each tick's 4-frame ease)
  let steps = 0;
  for (const tk of ticks) steps += interpolate(frame, [tk - 1, tk + 3], [0, 1], { ...clamp, easing: EASE_MOVE });
  const landed = frame - ticks[ticks.length - 1];
  const glow = interpolate(landed, [0, 5], [0, 1], { ...clamp, easing: EASE_IN });
  const R = 980;
  const persp = 1500;
  const drift = interpolate(frame, [start, lf(a, b)], [1, 1.05], clamp);
  const items = ARSENAL.map((it, i) => {
    const ang = ((i - steps) * 2 * Math.PI) / n;
    const x = Math.sin(ang) * R;
    const z = Math.cos(ang) * R - R; // 0 at the front, negative behind
    const sc = persp / (persp - z);
    return { it, i, ang, x, z, sc };
  }).sort((p, q) => p.z - q.z);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="card" durationInFrames={start}>
        <Card text={CARDS.arsenal} />
      </Sequence>
      <Sequence name="carousel" from={start}>
        <AbsoluteFill style={{ background: C.night }}>
          <Backlight y={470} r={900} a={0.12 + 0.28 * glow} />
          <AbsoluteFill style={{ scale: String(drift * (1 + 0.06 * glow)) }}>
            {items.map(({ it, i, ang, x, z, sc }) => {
              const front = Math.cos(ang);
              const isHero = i === n - 1;
              const dim = landed >= 0 && !isHero ? 1 - 0.75 * glow : 1;
              const size = (isHero ? 430 * (1 + 0.28 * glow) : 400) * sc;
              return (
                <div
                  key={it.name}
                  style={{
                    position: 'absolute',
                    left: 960 + x * sc - size / 2,
                    top: 470 - size / 2 + (1 - sc) * 90,
                    width: size,
                    height: size,
                    opacity: Math.max(0, (0.25 + 0.75 * (front * 0.5 + 0.5)) * dim),
                    transform: `perspective(1200px) rotateY(${(-ang * 180) / Math.PI * 0.8}deg)`,
                    filter: isHero && glow > 0 ? `drop-shadow(0 0 ${30 * glow}px ${C.accent}) drop-shadow(0 0 ${70 * glow}px rgba(124,108,255,0.6))` : `brightness(${0.6 + 0.4 * (front * 0.5 + 0.5)})`,
                  }}
                >
                  <Img src={staticFile(`art/${it.art}.png`)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              );
            })}
            <div style={{ position: 'absolute', top: 745, width: '100%', textAlign: 'center', opacity: glow, translate: `0px ${(1 - glow) * 20}px` }}>
              <div style={{ fontFamily: FONT.game, fontWeight: 800, fontSize: 64, color: C.offWhite }}>{ARSENAL[n - 1].name}</div>
              <div style={{ fontFamily: FONT.game, fontWeight: 600, fontSize: 32, color: C.inkFaint, marginTop: 10 }}>
                {ARSENAL_HERO_INFO}
              </div>
            </div>
            {/* names ticking by under the carousel before the landing */}
            {landed < 0 && (
              <div style={{ position: 'absolute', top: 745, width: '100%', textAlign: 'center', fontFamily: FONT.game, fontWeight: 700, fontSize: 44, color: C.inkFaint, opacity: 0.8 }}>
                {ARSENAL[Math.min(n - 1, Math.round(steps)) % n].name}
              </div>
            )}
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- RIVAL
const Brackets: React.FC<{ box: { x: number; y: number; w: number; h: number }; t: number }> = ({ box, t }) => {
  if (t < 0) return null;
  const p = interpolate(t, [0, 5], [0, 1], { ...clamp, easing: EASE_IN });
  const pad = 26 + (1 - p) * 60;
  const L = 54;
  const col = C.accent;
  const corner = (cx: number, cy: number, sx: number, sy: number, k: string) => (
    <div key={k} style={{ position: 'absolute', left: cx - (sx < 0 ? L : 0), top: cy - (sy < 0 ? L : 0), width: L, height: L, opacity: p }}>
      <div style={{ position: 'absolute', [sx > 0 ? 'left' : 'right']: 0, [sy > 0 ? 'top' : 'bottom']: 0, width: L, height: 6, background: col, boxShadow: `0 0 14px ${col}` }} />
      <div style={{ position: 'absolute', [sx > 0 ? 'left' : 'right']: 0, [sy > 0 ? 'top' : 'bottom']: 0, width: 6, height: L, background: col, boxShadow: `0 0 14px ${col}` }} />
    </div>
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

export const Rival: React.FC = () => {
  const frame = useCurrentFrame();
  const [a] = SECTIONS.rival;
  const ui = lf(a, 40);
  const vs = lf(a, 41.5);
  const cam = lf(a, 42);
  const lock = lf(a, 42.5);
  const end = lf(a, 43);
  const glass = { x: 80, y: 150, w: 1300, h: 584 };
  const fc = { x: 1300, y: 560, w: 560, h: 315 };
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="card" durationInFrames={ui}>
        <Card text={CARDS.rival} />
      </Sequence>
      <Sequence name="matchmaking" from={ui}>
        <AbsoluteFill style={{ background: C.night }}>
          <Backlight x={700} r={900} a={0.16} />
          <Glass box={glass} style={{ scale: String(punchAt(frame, vs, 0.05, 5)) }}>
            <Sequence name="radar" durationInFrames={vs - ui}>
              <UiClip clip={UI_CLIPS.radar} dur={vs - ui} push={[1.0, 1.05]} />
            </Sequence>
            <Sequence name="versus" from={vs - ui}>
              <UiClip clip={UI_CLIPS.versus} dur={end - vs} push={[1.08, 1.12]} />
            </Sequence>
          </Glass>
          <Ping x={glass.x + glass.w * 0.5} y={glass.y + glass.h * 0.34} t={frame - ui} size={40} dur={18} max={9} />
          <Facecam src="cast/hero/admiral.jpg" box={fc} at={cam - ui} from="right" />
          <Brackets box={fc} t={frame - lock} />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- FIRE.
export const Fire: React.FC = () => {
  const frame = useCurrentFrame();
  const [a, b] = SECTIONS.silence;
  const push = interpolate(frame, [0, lf(a, b)], [1, 1.035], clamp);
  return (
    <AbsoluteFill style={{ background: C.black, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ scale: String(push) }}>
        <Slam text={CARDS.fire} size={190} at={-10} />
      </div>
    </AbsoluteFill>
  );
};
