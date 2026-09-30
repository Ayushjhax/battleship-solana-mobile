/**
 * Beats 46–82: THE DROP (the battle), VICTORY and the economy. All inside the
 * 2.39:1 letterbox, so everything important sits in the band y 138–942.
 */
import { Video } from '@remotion/media';
import { CameraMotionBlur } from '@remotion/motion-blur';
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { PHOTOS } from '../cast';
import { CARDS, ECONOMY } from '../copy';
import { BAR } from '../components/Finish';
import { Facecam, Glass } from '../components/Frames';
import { Footage, cameraAt, toScreen } from '../components/Footage';
import { GridReveal, punchAt } from '../components/Motion';
import { Slam } from '../components/Slam';
import { Bloom } from './Opening';
import { C, EASE_IN, clamp } from '../theme';
import { FPS, SECTIONS, SHOTS, UI_CLIPS, f, type Shot } from '../timeline';

const lf = (a: number, beat: number) => f(beat) - f(a);
const TOP = BAR; // first visible row under the letterbox
const BOTTOM = 1080 - BAR;

/** A shot inside a section that starts at beat `a`, with optional tail overlap for a wipe over it. */
const ShotSeq: React.FC<{ a: number; shot: Shot; tail?: number; name: string; children?: React.ReactNode }> = ({ a, shot, tail = 0, name, children }) => (
  <Sequence name={name} from={lf(a, shot.from)} durationInFrames={lf(a, shot.to) - lf(a, shot.from) + tail}>
    {children}
  </Sequence>
);

/** The micro-card on the biggest hits: the game's red ink, big. */
const InkCard: React.FC<{ text: string; at: number; x: number; y: number; size?: number; dur?: number }> = ({ text, at, x, y, size = 230, dur = 999 }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame >= at + dur) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, transformOrigin: 'left center' }}>
      <Slam
        text={text}
        at={at}
        size={size}
        color={C.inkRed}
        origin="left center"
        style={{ textShadow: '0 0 1px #2a0806, 0 6px 0 rgba(40,8,6,0.35), 0 18px 40px rgba(0,0,0,0.35)' }}
      />
    </div>
  );
};

const Strike: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.strike;
  const cam = cameraAt(shot, f(shot.from) + frame, 1920, 1080);
  const e = toScreen(cam, 925, 296);
  const heat = interpolate(frame, [0, 4, 38], [1.4, 1, 0.5], clamp);
  return (
    <AbsoluteFill style={{ scale: String(punchAt(frame, 0, 0.08, 5)) }}>
      <Footage shot={shot} filter="contrast(1.1) saturate(1.2)" />
      <Bloom x={e.x} y={e.y} r={300} heat={heat} dark={0.72} />
    </AbsoluteFill>
  );
};

const Marks: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.marks;
  const cam = cameraAt(shot, f(shot.from) + frame, 1920, 1080);
  const e = toScreen(cam, 925, 318);
  return (
    <AbsoluteFill>
      <Footage shot={shot} filter="contrast(1.08) saturate(1.15)" />
      <Bloom x={e.x} y={e.y} r={380} heat={0.35} dark={0.55} />
      <InkCard text={CARDS.hit} at={lf(49, 50)} x={150} y={TOP + 150} />
      <Facecam src="cast/face/fc-crew.jpg" box={{ x: 1490, y: BOTTOM - 380, w: 340, h: 340 }} at={lf(49, 49.5)} />
    </AbsoluteFill>
  );
};

const Raid: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.raid;
  const g = f(shot.from) + frame;
  const whip = g >= f(56.5) - 1 && g <= f(57.1) + 1;
  const pic = <Footage shot={shot} filter="contrast(1.06) saturate(1.1)" />;
  return <AbsoluteFill>{whip ? <CameraMotionBlur shutterAngle={270} samples={6}>{pic}</CameraMotionBlur> : pic}</AbsoluteFill>;
};

const Split: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.hit;
  const cam = cameraAt(shot, f(shot.from) + frame, 960, 1080);
  const e = toScreen(cam, 900, 212);
  const hunter = PHOTOS.find((p) => p.id === 'hunter')!;
  const push = interpolate(frame, [0, 26], [1.02, 1.08], clamp);
  const heat = interpolate(frame, [0, 3, 26], [1.3, 1, 0.4], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 960, height: 1080, overflow: 'hidden', scale: String(punchAt(frame, 0, 0.08, 4)) }}>
        <Footage shot={shot} vw={960} vh={1080} filter="contrast(1.1) saturate(1.2)" />
        <AbsoluteFill style={{ width: 960 }}>
          <Bloom x={e.x} y={e.y} r={260} heat={heat} dark={0.6} />
        </AbsoluteFill>
      </div>
      <div style={{ position: 'absolute', left: 966, top: 0, width: 954, height: 1080, overflow: 'hidden' }}>
        <Img
          src={staticFile(`cast/photo/${hunter.id}.jpg`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${hunter.focus[0] * 100}% ${hunter.focus[1] * 100 + 6}%`, scale: String(push) }}
        />
      </div>
      <div style={{ position: 'absolute', left: 960, top: 0, width: 6, height: 1080, background: C.accent, boxShadow: `0 0 24px ${C.accent}` }} />
    </AbsoluteFill>
  );
};

const Sunk: React.FC = () => {
  const frame = useCurrentFrame();
  const stop = lf(61, 65);
  const dim = interpolate(frame, [stop, stop + 6], [0, 0.18], clamp);
  return (
    <AbsoluteFill>
      <Footage shot={SHOTS.sunk} filter="contrast(1.08) saturate(1.15)" />
      <AbsoluteFill style={{ background: `rgba(5,4,11,${dim})` }} />
    </AbsoluteFill>
  );
};

const SunkOverlay: React.FC = () => (
  <AbsoluteFill>
    <InkCard text={CARDS.sunk} at={0} x={150} y={TOP + 150} />
    <Facecam src="cast/face/fc-captain.jpg" box={{ x: 1490, y: BOTTOM - 380, w: 340, h: 340 }} at={lf(61, 63)} />
  </AbsoluteFill>
);

export const Drop: React.FC = () => {
  const a = SECTIONS.drop[0];
  const WIPE = 14; // frames the outgoing shot stays under a grid wipe
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ShotSeq a={a} shot={SHOTS.strike} name="strike">
        <Strike />
      </ShotSeq>
      <ShotSeq a={a} shot={SHOTS.marks} name="marks + HIT." tail={WIPE}>
        <Marks />
      </ShotSeq>
      <ShotSeq a={a} shot={SHOTS.defense} name="defence (grid wipe 1)">
        <GridReveal seed="w1" dur={10}>
          <Footage shot={SHOTS.defense} filter="contrast(1.06) saturate(1.1)" />
        </GridReveal>
      </ShotSeq>
      <ShotSeq a={a} shot={SHOTS.raid} name="raid + whip">
        <Raid />
      </ShotSeq>
      <ShotSeq a={a} shot={SHOTS.hit} name="split screen" tail={WIPE}>
        <Split />
      </ShotSeq>
      <ShotSeq a={a} shot={SHOTS.sunk} name="SUNK. (grid wipe 2)">
        <GridReveal seed="w2" dur={10}>
          <Sunk />
        </GridReveal>
        <SunkOverlay />
      </ShotSeq>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- VICTORY
type Box = { x: number; y: number; w: number; h: number };
const G = 18;
const BENTO_TOP = TOP + 22;
const BENTO_BOT = BOTTOM - 22;
const colW = 420;
const L = 70;
const R = 1920 - 70 - colW;
const midX = L + colW + G;
const midW = R - G - midX;
const rowH = (BENTO_BOT - BENTO_TOP - G) / 2;
const stripH = 150;
const CENTER: Box = { x: midX, y: BENTO_TOP + stripH + G, w: midW, h: BENTO_BOT - BENTO_TOP - 2 * (stripH + G) };
const TILES: Box[] = [
  { x: L, y: BENTO_TOP, w: colW, h: rowH },
  { x: R, y: BENTO_TOP, w: colW, h: rowH },
  { x: midX, y: BENTO_TOP, w: (midW - G) / 2, h: stripH },
  { x: midX + (midW + G) / 2, y: BENTO_TOP, w: (midW - G) / 2, h: stripH },
  { x: L, y: BENTO_TOP + rowH + G, w: colW, h: rowH },
  { x: R, y: BENTO_TOP + rowH + G, w: colW, h: rowH },
  { x: midX, y: BENTO_BOT - stripH, w: (midW - G) / 2, h: stripH },
  { x: midX + (midW + G) / 2, y: BENTO_BOT - stripH, w: (midW - G) / 2, h: stripH },
];
/** which celebration photo goes in which tile (faces in the big tiles, hands/screens in the strips) */
const TILE_PHOTO = ['sofa', 'duo', 'hands', 'glow', 'pair', 'focus', 'topdown', 'overhead'];
/** per-tile focus overrides so no face is cut by a tile edge */
const TILE_FOCUS: Record<string, [number, number]> = { duo: [1, 0.45], focus: [0.75, 0.3], pair: [0.3, 0.5], hands: [0.6, 0.58], glow: [0.5, 0.5], topdown: [0.45, 0.42], overhead: [0.5, 0.36] };

const Tile: React.FC<{ id: string; box: Box; at: number }> = ({ id, box, at }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return null;
  const p = interpolate(t, [0, 8], [0, 1], { ...clamp, easing: EASE_IN });
  const photo = PHOTOS.find((q) => q.id === id)!;
  const fo = TILE_FOCUS[id] ?? photo.focus;
  const push = 1 + 0.06 * interpolate(t, [0, 80], [0, 1], clamp);
  return (
    <Glass box={box} radius={20} style={{ opacity: p, scale: String(0.9 + 0.1 * p), translate: `0px ${(1 - p) * 24}px` }}>
      <Img src={staticFile(`cast/photo/${id}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${fo[0] * 100}% ${fo[1] * 100}%`, scale: String(push) }} />
    </Glass>
  );
};

export const Victory: React.FC = () => {
  const frame = useCurrentFrame();
  const [a] = SECTIONS.victory;
  const bento = lf(a, 68);
  const glow = interpolate(frame, [0, 26], [1, 0.4], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="VICTORY." durationInFrames={bento}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: `radial-gradient(circle 700px at 960px 540px, rgba(124,108,255,${0.28 * glow}), rgba(0,0,0,0) 70%)` }}>
          <div style={{ scale: String(interpolate(frame, [0, bento], [1, 1.05], clamp)) }}>
            <Slam text={CARDS.victory} size={210} />
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence name="bento" from={bento}>
        <AbsoluteFill style={{ background: C.night }}>
          <AbsoluteFill style={{ background: 'radial-gradient(circle 900px at 960px 540px, rgba(124,108,255,0.16), rgba(0,0,0,0) 70%)' }} />
          <Glass box={CENTER} radius={24}>
            <Footage shot={SHOTS.victory} vw={CENTER.w} vh={CENTER.h} />
          </Glass>
          {TILES.map((box, i) => (
            <Tile key={i} id={TILE_PHOTO[i]} box={box} at={Math.round(i * 3.2)} />
          ))}
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- ECONOMY
const ECON_CLIPS = [UI_CLIPS.buy, UI_CLIPS.sell, UI_CLIPS.gear] as const;
const ECON_GLASS: Box = { x: 800, y: 540 - 232, w: 1040, h: 465 };
/** the rank row only (y 292–398 of the result screen): no wager line, no buttons */
const CLIMB_GLASS: Box = { x: 800, y: 540 - 120, w: 1040, h: 240 };

const EconClip: React.FC<{ i: number; dur: number }> = ({ i, dur }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 6], [0.35, 1], { ...clamp, easing: EASE_IN });
  const push = interpolate(frame, [0, dur], [1.02, 1.07], clamp);
  return (
    <Glass box={i < 3 ? ECON_GLASS : CLIMB_GLASS} style={{ translate: `${(1 - p) * 140}px 0px`, opacity: p }}>
      {i < 3 ? (
        <Video
          src={staticFile(`media/${ECON_CLIPS[i].src}.mp4`)}
          trimBefore={Math.round(ECON_CLIPS[i].in * FPS)}
          muted
          style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', scale: String(push) }}
        />
      ) : (
        <Footage shot={SHOTS.climb} vw={CLIMB_GLASS.w} vh={CLIMB_GLASS.h} />
      )}
    </Glass>
  );
};

export const Economy: React.FC = () => {
  const [a] = SECTIONS.economy;
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <AbsoluteFill style={{ background: 'radial-gradient(circle 800px at 1320px 540px, rgba(124,108,255,0.18), rgba(0,0,0,0) 70%)' }} />
      {ECONOMY.map((text, i) => {
        const from = lf(a, a + i * 2);
        const dur = lf(a, a + i * 2 + 2) - from;
        const [w1, ...rest] = text.split(' ');
        return (
          <Sequence key={text} name={text} from={from} durationInFrames={dur}>
            <AbsoluteFill>
              <div style={{ position: 'absolute', left: 110, top: 0, height: 1080, display: 'flex', alignItems: 'center' }}>
                <Slam text={rest.length ? `${w1}\n${rest.join(' ')}` : w1} size={rest.length ? 150 : 170} origin="left center" style={{ lineHeight: 0.95 }} />
              </div>
              <EconClip i={i} dur={dur} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

