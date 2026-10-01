/**
 * Beats 29–45: ★5 THE DROP, in the 2.39:1 letterbox (everything important sits in the band y 138–942).
 *
 *   29    the period's white bloom (Flip) hands straight into the game's own white flash; the fireball blooms wide
 *   30    HIT.
 *   31    smoke → the 3x3 marks burst on 32 (Crew facecam)
 *   33    the AA gun, speed-ramped: fires 33.46, plane hit 34.2, "Shot down!" on 35 (Captain facecam)
 *   36    the grid wipe into the split screen: the Bomber's run | the Hunter watching
 *   40    the last ship goes down; freeze on its biggest frame, push in; SUNK. on 41; sucked out on 44
 */
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Facecam } from '../../trailer45/components/Frames';
import { GridReveal, punchAt } from '../../trailer45/components/Motion';
import { Slam } from '../../trailer45/components/Slam';
import { Bloom } from '../../trailer45/scenes/Opening';
import { C, EASE_MOVE, clamp } from '../../trailer45/theme';
import { BAND } from '../components/Finish';
import { Footage, cameraAt, toScreen } from '../components/Footage';
import { DROP } from '../copy';
import { PERIOD_FRAMES, SECTIONS, SHOTS, f, type Shot } from '../timeline';

const A = SECTIONS.drop[0];
const L = (b: number) => f(b) - f(A);
const WIPE_TAIL = 14;

/** the micro-card on the biggest hits: the game's red ink, big, on a dimmed patch of the plate */
const InkCard: React.FC<{ text: string; at: number; x: number; y: number; size?: number }> = ({ text, at, x, y, size = 220 }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const dim = interpolate(frame - at, [0, 3], [0, 1], clamp);
  return (
    <>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 560px 300px at ${x + size * 0.9}px ${y + size * 0.5}px, rgba(5,4,11,${0.55 * dim}), rgba(5,4,11,0) 75%)` }} />
      <div style={{ position: 'absolute', left: x, top: y }}>
        <Slam text={text} at={at} size={size} color={C.inkRed} origin="left center" style={{ textShadow: '0 0 1px #2a0806, 0 6px 0 rgba(40,8,6,0.4), 0 18px 40px rgba(0,0,0,0.5)' }} />
      </div>
    </>
  );
};

const ShotSeq: React.FC<{ shot: Shot; tail?: number; name: string; children: React.ReactNode }> = ({ shot, tail = 0, name, children }) => (
  <Sequence name={name} from={L(shot.from)} durationInFrames={L(shot.to) - L(shot.from) + tail} premountFor={30}>
    {children}
  </Sequence>
);

const Strike: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < PERIOD_FRAMES) return null; // the period and its bloom are on screen
  const shot = SHOTS.strike;
  const cam = cameraAt(shot, f(shot.from) + frame, 1920, 1080);
  const e = toScreen(cam, 934, 286);
  const heat = interpolate(frame, [PERIOD_FRAMES, PERIOD_FRAMES + 4, 26], [1.5, 1.1, 0.55], clamp);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ scale: String(punchAt(frame, PERIOD_FRAMES, 0.08, 5)) }}>
        <Footage shot={shot} filter="contrast(1.1) saturate(1.22)" />
        <Bloom x={e.x} y={e.y} r={280} heat={heat} dark={0.6} />
      </AbsoluteFill>
      <InkCard text={DROP.hit} at={L(30)} x={130} y={BAND.bottom - 330} />
    </AbsoluteFill>
  );
};

const Marks: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.marks;
  const cam = cameraAt(shot, f(shot.from) + frame, 1920, 1080);
  const e = toScreen(cam, 905, 345);
  const burst = L(32) - L(31);
  const heat = frame < burst ? 0.25 : interpolate(frame - burst, [0, 3, 14], [1.3, 0.9, 0.4], clamp);
  return (
    <AbsoluteFill style={{ scale: String(punchAt(frame, burst, 0.05, 4)) }}>
      <Footage shot={shot} filter="contrast(1.08) saturate(1.18)" />
      <Bloom x={e.x} y={e.y} r={300} heat={heat} dark={0.5} />
    </AbsoluteFill>
  );
};

const Defense: React.FC = () => {
  const frame = useCurrentFrame();
  const stamp = L(35) - L(33);
  return (
    <AbsoluteFill style={{ scale: String(punchAt(frame, stamp, 0.05, 4)) }}>
      <Footage shot={SHOTS.defense} filter="contrast(1.06) saturate(1.12)" />
    </AbsoluteFill>
  );
};

const Split: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = L(40) - L(36);
  const push = interpolate(frame, [0, dur], [1.02, 1.08], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 954, height: 1080, overflow: 'hidden' }}>
        <Footage shot={SHOTS.run} vw={954} vh={1080} filter="contrast(1.08) saturate(1.15)" />
      </div>
      <div style={{ position: 'absolute', left: 966, top: 0, width: 954, height: 1080, overflow: 'hidden' }}>
        <Img src={staticFile('deck30/cast/split.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '45% 40%', scale: String(push) }} />
      </div>
      <div style={{ position: 'absolute', left: 954, top: 0, width: 12, height: 1080, background: C.accent, boxShadow: `0 0 28px ${C.accent}` }} />
    </AbsoluteFill>
  );
};

const Last: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = SHOTS.last;
  const cam = cameraAt(shot, f(shot.from) + frame, 1920, 1080);
  const e = toScreen(cam, 965, 140);
  const suck = interpolate(frame, [L(44) - L(40), L(45) - L(40)], [0, 1], { ...clamp, easing: EASE_MOVE });
  const heat = interpolate(frame, [0, 2, 10, 50], [1.6, 1.3, 0.9, 0.75], clamp) * (1 - suck);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill style={{ scale: String(punchAt(frame, 0, 0.08, 5)), filter: suck > 0 ? `saturate(${1 - 0.8 * suck}) blur(${4 * suck}px)` : undefined }}>
        <Footage shot={shot} filter="contrast(1.1) saturate(1.25)" />
        <Bloom x={e.x} y={e.y} r={260 + 80 * suck} heat={heat} dark={0.62} />
        {/* the HUD band recedes: the shot is the ship, not the scoreboard */}
        <AbsoluteFill style={{ background: `linear-gradient(to bottom, rgba(5,4,11,0.9) ${(BAND.top / 1080) * 100}%, rgba(5,4,11,0.55) ${((BAND.top + 90) / 1080) * 100}%, rgba(5,4,11,0) ${((BAND.top + 170) / 1080) * 100}%)` }} />
      </AbsoluteFill>
      <InkCard text={DROP.sunk} at={L(41) - L(40)} x={130} y={BAND.bottom - 330} />
      <AbsoluteFill style={{ background: C.black, opacity: 0.94 * suck }} />
    </AbsoluteFill>
  );
};

export const Drop: React.FC = () => (
  <AbsoluteFill>
    <ShotSeq shot={SHOTS.strike} name="strike + HIT.">
      <Strike />
    </ShotSeq>
    <ShotSeq shot={SHOTS.marks} name="3x3 marks burst">
      <Marks />
      <Facecam src="deck30/cast/face/fc-crew.jpg" box={{ x: 1490, y: BAND.bottom - 380, w: 340, h: 340 }} at={L(32) - L(31)} />
    </ShotSeq>
    <ShotSeq shot={SHOTS.defense} name="AA gun → Shot down!" tail={WIPE_TAIL}>
      <Defense />
      <Facecam src="deck30/cast/face/fc-captain.jpg" box={{ x: 1490, y: BAND.bottom - 380, w: 340, h: 340 }} at={L(35) - L(33)} />
    </ShotSeq>
    <ShotSeq shot={SHOTS.run} name="split screen (grid wipe)">
      <GridReveal seed="d30w" dur={10}>
        <Split />
      </GridReveal>
    </ShotSeq>
    <ShotSeq shot={SHOTS.last} name="the last ship → SUNK. → suck-out">
      <Last />
    </ShotSeq>
  </AbsoluteFill>
);
