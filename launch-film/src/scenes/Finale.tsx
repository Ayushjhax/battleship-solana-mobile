import {measureText} from '@remotion/layout-utils';
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Bit} from '../components/Bit';
import {GridField} from '../components/GridField';
import {KineticText} from '../components/KineticText';
import {LightSweep} from '../components/Reveal';
import {SonarPing} from '../components/SonarPing';
import {COPY} from '../config/copy';
import {f, FINALE as B} from '../config/timeline';
import {cam, CLAMP, enter, exit, inOut, mix} from '../lib/anim';
import {fontsReady} from '../lib/fonts';
import {C, FONT, TRACK} from '../theme';

const BADGE_W = 1040; // 1.5× the 696-px badge
const BADGE_H = (BADGE_W * 273) / 696;
const MOVE_FS = 200;
const MOVE_W8 = 680;
const BIT = 36;
const MOVE_TOP = 1070;
const ASC = 0.864;

/**
 * Black and silence. "One more thing." Then the Solana dApp Store badge as the hero, with a
 * light sweep. Then the name and "Your move." — the period is the bit. It holds, pings once,
 * and goes to black.
 */
export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('fonts for the period'));
  useEffect(() => {
    fontsReady.then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);

  // "Your move" + the bit, centred as one line
  let periodX = 1920;
  if (ready) {
    const w = measureText({text: COPY.finale.yourMove, fontFamily: FONT.head, fontSize: MOVE_FS, fontWeight: String(MOVE_W8), letterSpacing: TRACK.headline}).width;
    const gap = MOVE_FS * 0.06;
    periodX = 1920 - (w + gap + BIT) / 2 + w + gap + BIT / 2;
  }
  const periodY = MOVE_TOP + ASC * MOVE_FS - BIT / 2;

  const badge = inOut(frame, f(B.badge), f(B.badgeOut), 26, 14);
  const lock = enter(frame, f(B.lockup), 26);
  const bitIn = enter(frame, f(B.period), 18);
  const toBlack = interpolate(frame, [f(B.ping) + 10, f(B.black)], [0, 1], {...CLAMP});
  const hold = cam(frame, f(B.lockup), f(B.black));
  const pingGlow = interpolate(frame, [f(B.ping), f(B.ping) + 4, f(B.ping) + 34], [1, 2.1, 1], CLAMP);
  const gridReveal = interpolate(frame, [f(B.ping), f(B.ping) + 70], [0, 2600], CLAMP);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* One more thing. */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <KineticText text={COPY.finale.oneMore} at={f(B.oneMore)} out={f(B.oneMoreOut)} size="sub" weight={560} fontSize={96} stagger={4} />
      </AbsoluteFill>

      {/* Live on the Solana dApp Store. */}
      <AbsoluteFill style={{opacity: badge}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 690}}>
          <KineticText text={COPY.finale.live} at={f(B.badge)} fontSize={124} weight={650} tracking="-0.03em" />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 1920 - BADGE_W / 2,
            top: 1060,
            width: BADGE_W,
            height: BADGE_H,
            opacity: enter(frame, f(B.badge) + 6, 26),
            translate: `0 ${mix(60, 0, enter(frame, f(B.badge) + 6, 26))}px`,
            scale: mix(1, 1.03, cam(frame, f(B.badge), f(B.badgeOut) + 10)),
            borderRadius: 40,
          }}
        >
          <LightSweep at={f(B.sweep)} dur={36} intensity={0.9} style={{borderRadius: 40, overflow: 'hidden'}}>
            <Img src={staticFile('art/ui/solana-badge.png')} style={{width: BADGE_W, height: BADGE_H, display: 'block'}} />
          </LightSweep>
        </div>
      </AbsoluteFill>

      {/* the lockup */}
      <AbsoluteFill style={{opacity: 1 - toBlack, scale: mix(1, 1.025, hold)}}>
        <GridField opacity={0.08 * (1 - exit(frame, f(B.ping) + 30, 30))} reveal={gridReveal} cx={periodX} cy={periodY} feather={600} />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 700,
            textAlign: 'center',
            fontFamily: FONT.game,
            fontWeight: 800,
            fontSize: 150,
            letterSpacing: '-0.015em',
            color: C.white,
            opacity: lock,
            translate: `0 ${(1 - lock) * 40}px`,
            filter: lock < 1 ? `blur(${(1 - lock) * 14}px)` : undefined,
          }}
        >
          {COPY.finale.lockupName}
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, top: MOVE_TOP}}>
          <KineticText
            text={COPY.finale.yourMove}
            at={f(B.lockup) + 8}
            fontSize={MOVE_FS}
            weight={MOVE_W8}
            tail={<span style={{display: 'inline-block', width: MOVE_FS * 0.06 + BIT}} />}
          />
        </div>
        <div style={{position: 'absolute', left: periodX - BIT / 2, top: periodY - BIT / 2, opacity: bitIn, scale: mix(2.2, 1, bitIn)}}>
          <Bit size={BIT} glow={pingGlow} />
        </div>
        <SonarPing x={periodX} y={periodY} at={f(B.ping)} radius={2600} rings={3} dur={80} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
