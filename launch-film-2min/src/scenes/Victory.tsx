import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {Callout} from '../components/Callout';
import {Footage, Freeze} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {ZoomPunch} from '../components/Impact';
import {LightSweep} from '../components/Reveal';
import {COPY} from '../config/copy';
import {EVENTS, f, VICTORY as B} from '../config/timeline';
import {cam, enter, exit, mix} from '../lib/anim';
import {C, FONT, TRACK} from '../theme';

const WORD_FS = 400;

/**
 * Victory. After half a beat of silence: the word, huge, with a light sweep, over the result
 * screen held dark; then the screen comes up and the points count in.
 */
export const Victory: React.FC = () => {
  const frame = useCurrentFrame();
  const wordIn = enter(frame, 0, 14);
  const wordOut = exit(frame, f(B.wordOut), 14);
  const reveal = cam(frame, f(B.wordOut) - 4, f(B.wordOut) + 20);
  const push = cam(frame, 0, f(12));
  const play = f(B.screen.at);
  // "Points gained +24" value in the recording (1280-px coords ≈ (868, 190))
  const zoom = mix(3.8, 4.25, push);
  const u = 0.52;
  const v = 0.5;
  const px = 1920 + (868 / 1280 - u) * 1280 * zoom;
  const py = 1080 + (190 / 576 - v) * 576 * zoom;
  const style: React.CSSProperties = {
    fontFamily: FONT.head,
    fontWeight: 700,
    fontSize: WORD_FS,
    letterSpacing: TRACK.hero,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ZoomPunch hits={[{at: 0, amount: 0.08, flash: true, shake: true}]}>
        <AbsoluteFill style={{filter: `brightness(${mix(0.28, 1, reveal)}) blur(${mix(18, 0, reveal)}px)`}}>
          <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom}>
            {frame < play ? <Freeze clip="base" at={EVENTS.base.victoryCut + 0.03} fit="fill" /> : null}
            <Sequence from={play} layout="none">
              <Footage shot={{...B.screen, at: 0}} fit="fill" />
            </Sequence>
          </Framed>
        </AbsoluteFill>
      </ZoomPunch>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            opacity: wordIn * (1 - wordOut),
            scale: mix(1.12, 1, wordIn) * mix(1, 0.94, wordOut),
            filter: wordOut > 0 ? `blur(${wordOut * 14}px)` : wordIn < 1 ? `blur(${(1 - wordIn) * 16}px)` : undefined,
          }}
        >
          <LightSweep at={f(B.sweep)} dur={34} text={COPY.victory.word} textStyle={style}>
            <div style={{...style, color: C.white}}>{COPY.victory.word}</div>
          </LightSweep>
        </div>
      </AbsoluteFill>
      <Callout x={px - 60} y={py} dx={0} dy={-330} label={COPY.victory.callout} at={f(B.screen.at + 3.5)} />
    </AbsoluteFill>
  );
};
