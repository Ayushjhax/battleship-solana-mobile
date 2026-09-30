import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Footage} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {ZoomPunch} from '../components/Impact';
import {KineticText} from '../components/KineticText';
import {LightSweep, MaskReveal} from '../components/Reveal';
import {COPY} from '../config/copy';
import {f, TITLE as B} from '../config/timeline';
import {cam, CLAMP, enter, exit, inOut} from '../lib/anim';
import {C, FONT} from '../theme';

const TITLE_FS = 300;

/**
 * Hard cut on the hit: the Atomic Bomber's strike, full-bleed (upscaled plate), framed on the
 * fireball with a slow push. It dims; the title resolves with a mask reveal and a light sweep;
 * then the line.
 */
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const push = cam(frame, 0, f(12));
  const dim = interpolate(frame, [f(B.dim), f(B.dim) + 24], [0, 1], {...CLAMP});
  const titleOut = exit(frame, f(B.taglineIn) - 8, 14);
  const titleTextStyle: React.CSSProperties = {
    fontFamily: FONT.game,
    fontWeight: 800,
    fontSize: TITLE_FS,
    letterSpacing: '-0.02em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ZoomPunch hits={[{at: 0, amount: 0.08, flash: true, shake: true}]}>
        <AbsoluteFill style={{filter: `brightness(${1 - 0.72 * dim}) blur(${dim * 14}px) saturate(${1 - 0.25 * dim})`}}>
          <Framed source={SOURCE.battle} u={0.72} v={0.5} zoom={4.6 + 0.5 * push} cx={1920 + 120 * (1 - push)}>
            <Footage shot={B.hit} fit="fill" />
          </Framed>
        </AbsoluteFill>
      </ZoomPunch>

      {/* title */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: 1 - titleOut, filter: titleOut > 0 ? `blur(${titleOut * 10}px)` : undefined}}>
        <div style={{translate: `0 ${-40 - titleOut * 40}px`, scale: 1 + 0.03 * cam(frame, f(B.titleIn), f(12))}}>
          <MaskReveal at={f(B.titleIn)} dur={28}>
            <LightSweep at={f(B.sweep)} dur={36} text={COPY.title.name} textStyle={titleTextStyle}>
              <div style={{...titleTextStyle, color: C.white, textShadow: '0 0 60px rgba(0,0,0,0.35)'}}>{COPY.title.name}</div>
            </LightSweep>
          </MaskReveal>
          <div
            style={{
              marginTop: 44,
              textAlign: 'center',
              fontFamily: FONT.game,
              fontWeight: 600,
              fontSize: 96,
              letterSpacing: '0.01em',
              color: 'rgba(245,246,250,0.72)',
              opacity: inOut(frame, f(B.subIn), undefined),
              translate: `0 ${(1 - enter(frame, f(B.subIn))) * 30}px`,
            }}
          >
            {COPY.title.sub}
          </div>
        </div>
      </AbsoluteFill>

      {/* the line */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <KineticText text={COPY.title.tagline} at={f(B.taglineIn)} out={f(B.out)} size="headline" />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
