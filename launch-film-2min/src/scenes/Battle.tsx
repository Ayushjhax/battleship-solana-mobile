import React from 'react';
import {AbsoluteFill, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {Callout} from '../components/Callout';
import {paperStyle} from '../components/Card';
import {Footage, Freeze} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {FxSprite, type FxName} from '../components/FxSprite';
import {ZoomPunch} from '../components/Impact';
import {KineticText} from '../components/KineticText';
import {BottomShade, WeaponLabel} from '../components/Lower';
import {COPY} from '../config/copy';
import {BATTLE as B, EVENTS, f, type Shot} from '../config/timeline';
import {cam, CLAMP, exit, mix} from '../lib/anim';
import {INNER_HIGHLIGHT, RADIUS, SAFE, SHADOW} from '../theme';

// ── geometry of the battle recording (1280 × 576 source px) ──
const TARGET = {u: 928 / 1280, v: 308 / 576}; // the Atomic Bomber's 3×3 target
const ENEMY = {u: 952 / 1280, v: 333 / 576};
const OWN = {u: 468 / 1280, v: 333 / 576};
const SHOT_DOWN = {u: 360 / 1280, v: 395 / 576};
const LAST_HIT = {u: 965 / 1280, v: 140 / 576};

/** frame (scene-relative) at which a source second plays in a shot */
const tIn = (shot: Shot, src: number) => f(shot.at + ((src - shot.from) * 2) / (shot.rate ?? 1));

// ── a) establishing: letterboxed full width, callouts on both boards ──
const Establish: React.FC = () => {
  const frame = useCurrentFrame();
  const push = cam(frame, 0, f(8) + 30);
  const zoom = mix(3.0, 3.16, push);
  const top = 1080 - (576 * zoom) / 2;
  const at = (u: number, v: number) => ({x: 1920 + (u - 0.5) * 1280 * zoom, y: top + v * 576 * zoom});
  const own = at(OWN.u, 548 / 576);
  const enemy = at(ENEMY.u, 548 / 576);
  const deck = at(137 / 1280, 118 / 576);
  return (
    <AbsoluteFill>
      <Framed source={SOURCE.battle} u={0.5} v={0.5} zoom={zoom} cover={false}>
        <Freeze clip="arsenal" at={0} fit="fill" />
      </Framed>
      <Callout x={own.x} y={own.y - 10} dx={0} dy={2040 - own.y} label={COPY.battle.calloutOwn} at={f(B.calloutsAt[0])} out={f(8) - 12} />
      <Callout x={enemy.x} y={enemy.y - 10} dx={0} dy={2040 - enemy.y} label={COPY.battle.calloutEnemy} at={f(B.calloutsAt[1])} out={f(8) - 12} />
      <Callout x={deck.x} y={deck.y + 10} dx={0} dy={150 - deck.y} label={COPY.battle.calloutDeck} at={f(B.calloutsAt[2])} out={f(8) - 12} />
    </AbsoluteFill>
  );
};

// ── b) Aim. Fire. Hit. ──
const Strike: React.FC = () => {
  // local frame 0 = B.aim
  const frame = useCurrentFrame();
  const aimIn = cam(frame, -6, 16);
  const fire = f(B.fire - B.aim);
  const hit = f(B.hit - B.aim);
  // camera: from the letterboxed wide into the target, across the board with the plane, then into the fireball
  const z1 = mix(3.16, 4.5, aimIn);
  const toBoard = cam(frame, fire - 4, fire + 12);
  const toHit = cam(frame, hit, hit + f(4));
  const zoom = mix(mix(z1, 4.1, toBoard), 5.3, toHit);
  const u = mix(mix(mix(0.5, TARGET.u, aimIn), ENEMY.u, toBoard), TARGET.u, toHit);
  const v = mix(mix(mix(0.5, TARGET.v, aimIn), 0.48, toBoard), 0.47, toHit);
  const dof = aimIn * (1 - toBoard);
  const words = f(B.wordsOut - B.aim);
  return (
    <AbsoluteFill>
      <ZoomPunch hits={[{at: hit, amount: 0.09, flash: true, shake: true}]}>
        <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom} cover={zoom >= 3.75}>
          {frame < fire ? <Freeze clip="arsenal" at={0} fit="fill" style={{filter: dof > 0.01 ? `blur(${14 * dof}px) brightness(${1 - 0.28 * dof})` : undefined}} /> : null}
          <Sequence from={fire} layout="none">
            <Footage shot={{...B.strike, at: 0}} fit="fill" />
          </Sequence>
        </Framed>
        {/* depth of field while aiming: the target stays sharp, the board around it falls away */}
        {frame < fire && dof > 0.01 ? (
          <AbsoluteFill
            style={{
              WebkitMaskImage: 'radial-gradient(circle 560px at 50% 50%, #000 55%, transparent 100%)',
              maskImage: 'radial-gradient(circle 560px at 50% 50%, #000 55%, transparent 100%)',
            }}
          >
            <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom} cover={zoom >= 3.75}>
              <Freeze clip="arsenal" at={0} fit="fill" />
            </Framed>
          </AbsoluteFill>
        ) : null}
      </ZoomPunch>
      <BottomShade opacity={1 - exit(frame, words, 12)} height={820} />
      <div style={{position: 'absolute', left: SAFE.x + 20, bottom: SAFE.y + 70, display: 'flex', gap: 70}}>
        <KineticText text={COPY.battle.aim} at={0} out={words} size="headline" align="left" />
        <KineticText text={COPY.battle.fire} at={fire} out={words} size="headline" align="left" />
        <KineticText text={COPY.battle.hit} at={hit} out={words} size="headline" align="left" />
      </div>
    </AbsoluteFill>
  );
};

// ── c) montage ──
const Montage1: React.FC = () => {
  // fire marks bloom on the 3×3 (Atomic Bomber), macro
  const frame = useCurrentFrame();
  const shot = {...B.montage[0], at: 0};
  const push = cam(frame, 0, f(3));
  return (
    <AbsoluteFill>
      <ZoomPunch hits={[{at: tIn(shot, EVENTS.arsenal.fireMarks), amount: 0.05}]}>
        <Framed source={SOURCE.battle} u={TARGET.u} v={TARGET.v} zoom={mix(5.6, 6.0, push)}>
          <Footage shot={shot} fit="fill" />
        </Framed>
      </ZoomPunch>
      <BottomShade height={600} />
      <WeaponLabel name={COPY.battle.labelAtomic} at={4} />
    </AbsoluteFill>
  );
};

const Montage2: React.FC = () => {
  // the AA gun shoots an enemy plane down over your own board
  const frame = useCurrentFrame();
  const shot = {...B.montage[1], at: 0};
  const push = cam(frame, 0, f(5));
  return (
    <AbsoluteFill>
      <ZoomPunch hits={[{at: tIn(shot, EVENTS.defense.planeHit), amount: 0.04}, {at: tIn(shot, EVENTS.defense.shotDown), amount: 0.06, shake: true}]}>
        <Framed source={SOURCE.battle} u={mix(OWN.u, SHOT_DOWN.u, push)} v={mix(0.55, SHOT_DOWN.v, push)} zoom={mix(4.2, 5.0, push)}>
          <Footage shot={shot} fit="fill" />
        </Framed>
      </ZoomPunch>
      <BottomShade height={600} />
      <WeaponLabel name={COPY.battle.labelAa} at={4} />
    </AbsoluteFill>
  );
};

/** The game's FX strips on graph paper cards; a whip-pan (horizontal motion blur) between them. */
const INSERTS = B.inserts;
const Inserts: React.FC = () => {
  const frame = useCurrentFrame();
  const per = f(4);
  const CARD_W = 2600;
  const PITCH = 3300;
  // position: hold on each card, whip to the next in 7 frames at the boundary
  let pos = 0;
  let speed = 0;
  for (let i = 1; i < INSERTS.length; i++) {
    const s = i * per - 4;
    const p = interpolate(frame, [s, s + 7], [0, 1], {...CLAMP, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)});
    pos += p;
    if (frame >= s && frame <= s + 7) speed = Math.sin(((frame - s) / 7) * Math.PI);
  }
  const drift = interpolate(frame, [0, per * INSERTS.length], [0, 120], CLAMP);
  const cur = Math.min(INSERTS.length - 1, Math.floor(frame / per));
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <svg width="0" height="0" style={{position: 'absolute'}}>
        <filter id="whip">
          <feGaussianBlur stdDeviation={`${speed * 60} 0`} />
        </filter>
      </svg>
      <AbsoluteFill style={{filter: speed > 0.02 ? 'url(#whip)' : undefined, translate: `${-pos * PITCH - drift}px 0`}}>
        {INSERTS.map((ins, i) => (
          <div
            key={ins.fx}
            style={{
              position: 'absolute',
              left: 1920 - CARD_W / 2 + i * PITCH,
              top: 1080 - 720,
              width: CARD_W,
              height: 1440,
              borderRadius: RADIUS.tile,
              overflow: 'hidden',
              boxShadow: `${SHADOW}, ${INNER_HIGHLIGHT}`,
              ...paperStyle(96),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FxSprite fx={ins.fx as FxName} at={i === 0 ? -2 : i * per - 2} size={1100} hold={3} loop />
          </div>
        ))}
      </AbsoluteFill>
      <WeaponLabel key={cur} name={INSERTS[cur].label} at={cur * per + (cur === 0 ? 4 : 5)} out={(cur + 1) * per - 6} />
    </AbsoluteFill>
  );
};

/** Four one-beat hits into the break. */
const Hits: React.FC = () => {
  const frame = useCurrentFrame();
  const beat = Math.floor(frame / 15);
  const local = frame - beat * 15;
  const cuts = [
    <Framed key={0} source={SOURCE.battle} u={0.725} v={0.5} zoom={6.2}>
      <Freeze clip="arsenal" at={1.35} fit="fill" />
    </Framed>,
    <Framed key={1} source={SOURCE.battle} u={0.36} v={0.72} zoom={6.2}>
      <Freeze clip="defense" at={1.2} fit="fill" />
    </Framed>,
    <AbsoluteFill key={2} style={{...paperStyle(120), justifyContent: 'center', alignItems: 'center'}}>
      <FxSprite fx="explosionFire" at={0} size={1500} hold={2} holdLast />
    </AbsoluteFill>,
    <Framed key={3} source={SOURCE.battle} u={0.725} v={0.42} zoom={5.6}>
      <Freeze clip="arsenal" at={1.8} fit="fill" />
    </Framed>,
  ];
  return (
    <ZoomPunch hits={[0, 15, 30, 45].map((a, i) => ({at: a, amount: 0.05 + i * 0.012, flash: i === 3}))}>
      <AbsoluteFill style={{scale: 1 + local * 0.004}}>
        <Sequence from={beat * 15} durationInFrames={15} layout="none">
          {cuts[Math.min(3, beat)]}
        </Sequence>
      </AbsoluteFill>
    </ZoomPunch>
  );
};

// ── d) the last ship ──
const LastShip: React.FC = () => {
  // local frame 0 = B.tension.at
  const frame = useCurrentFrame();
  const clear = cam(frame, f(B.lastRun.at - B.tension.at) - 20, f(B.lastRun.at - B.tension.at) + 6);
  const lineOut = f(B.lineOut - B.tension.at);
  const run = f(B.lastRun.at - B.tension.at);
  const hit = f(B.lastHit - B.tension.at);
  const push = cam(frame, 0, run);
  const toHit = cam(frame, run, hit);
  const after = cam(frame, hit, hit + f(3.5));
  const zoom = mix(mix(3.9, 4.3, push), 5.4, toHit) + 0.7 * after;
  const u = mix(ENEMY.u, LAST_HIT.u, toHit);
  const v = mix(0.5, LAST_HIT.v, toHit);
  const blurAmt = 16 * (1 - clear);
  const dim = 0.7 * (1 - clear);
  // heartbeat: a faint pulse in the plate every two beats
  const hb = frame < run ? Math.max(0, 1 - ((frame % 30) / 8)) * 0.05 : 0;
  return (
    <AbsoluteFill>
      <ZoomPunch hits={[{at: hit, amount: 0.1, flash: true, shake: true}]}>
        <AbsoluteFill style={{filter: `blur(${blurAmt}px) brightness(${1 - dim + hb})`}}>
          <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom}>
            {frame < run ? <Freeze clip="base" at={1.5} fit="fill" /> : null}
            <Sequence from={run} layout="none">
              <Footage shot={{...B.lastRun, at: 0}} fit="fill" />
            </Sequence>
          </Framed>
        </AbsoluteFill>
      </ZoomPunch>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <KineticText text={COPY.battle.line} at={f(B.line - B.tension.at)} out={lineOut} size="headline" />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** THE DROP. 56 beats: establishing, Aim/Fire/Hit, montage, inserts, hits, the last ship. */
export const Battle: React.FC = () => {
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Sequence name="Establish" from={0} durationInFrames={f(B.aim)}>
        <Establish />
      </Sequence>
      <Sequence name="Aim Fire Hit" from={f(B.aim)} durationInFrames={f(16 - B.aim)}>
        <Strike />
      </Sequence>
      <Sequence name="Montage 1" from={f(B.montage[0].at)} durationInFrames={f(B.montage[0].beats)}>
        <Montage1 />
      </Sequence>
      <Sequence name="Montage 2" from={f(B.montage[1].at)} durationInFrames={f(B.montage[1].beats)}>
        <Montage2 />
      </Sequence>
      <Sequence name="FX inserts" from={f(B.inserts[0].at)} durationInFrames={f(12)}>
        <Inserts />
      </Sequence>
      <Sequence name="Hits" from={f(B.build.at)} durationInFrames={f(B.build.beats)}>
        <Hits />
      </Sequence>
      <Sequence name="Last ship" from={f(B.tension.at)} durationInFrames={f(B.silence - B.tension.at)}>
        <LastShip />
      </Sequence>
    </AbsoluteFill>
  );
};

