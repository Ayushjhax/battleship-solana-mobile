import {Img} from 'remotion';
import React from 'react';
import {AbsoluteFill, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Footage} from '../components/Footage';
import {KineticText} from '../components/KineticText';
import {PhoneFrame} from '../components/PhoneFrame';
import {COPY} from '../config/copy';
import {anchored, ECONOMY as B, f, STILLS, type ClipName} from '../config/timeline';
import {cam, enter, mix} from '../lib/anim';
import {SAFE} from '../theme';

const SW = 1860;

/** One block: the word on one side, the screen on the other, cut on the beat. */
const Block: React.FC<{i: number}> = ({i}) => {
  const frame = useCurrentFrame();
  const b = B.blocks[i];
  const right = b.side === 'right';
  const phoneX = right ? 3840 - SAFE.x - 1010 : SAFE.x + 1010;
  const drift = cam(frame, 0, f(b.beats));
  const slide = enter(frame, 0, 16);
  const isBoard = b.clip === 'leaderboard';
  // the leaderboard: punch into the #1 row (2670-px coords ≈ (1376, 467))
  const punch = isBoard ? cam(frame, f(B.punch - b.at) - 4, f(B.punch - b.at) + 10) : 0;
  const k = SW / 2670;
  const rowY = (467 - 600) * k;
  const rowX = (1376 - 1335) * k;
  const s = mix(1, 1.55, punch);
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', inset: 0, translate: `${(right ? 1 : -1) * mix(160, 0, slide) + (right ? -40 : 40) * drift}px 0`}}>
        <PhoneFrame
          screenWidth={SW}
          x={phoneX - rowX * (s - 1)}
          y={1130 - rowY * (s - 1)}
          rotateY={(right ? -8 : 8) * (1 - drift * 0.6)}
          scale={s}
        >
          {isBoard ? (
            <AbsoluteFill>
              <Img src={staticFile(STILLS.leaderboard)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
              {/* depth of field on the punch: everything but the #1 row falls away */}
              <AbsoluteFill
                style={{
                  opacity: punch,
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.55) 33%, rgba(0,0,0,0) 35.5%, rgba(0,0,0,0) 42.5%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.55) 100%)',
                }}
              />
            </AbsoluteFill>
          ) : (
            <Footage shot={anchored(b.clip as ClipName, b.event, b.onBeat, 0, b.beats)} fit="cover" />
          )}
        </PhoneFrame>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 900,
          left: right ? SAFE.x + 40 : undefined,
          right: right ? undefined : SAFE.x + 40,
          maxWidth: 1500,
        }}
      >
        <KineticText text={COPY.economy.words[i]} at={2} size="headline" align={right ? 'left' : 'right'} stagger={2} />
      </div>
    </AbsoluteFill>
  );
};

/** The rhythm run: buy points, sell points, the store, the ladder: 4 × 6 beats, hard cuts. */
export const Economy: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    {B.blocks.map((b, i) => (
      <Sequence key={i} name={COPY.economy.words[i]} from={f(b.at)} durationInFrames={f(b.beats)}>
        <Block i={i} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
