import React from 'react';
import {AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Footage, Freeze} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {ZoomPunch} from '../components/Impact';
import {f, STILLS, SUPERCUT as B} from '../config/timeline';

const full = (clip: 'build' | 'match' | 'store', at: number, u = 0.5, v = 0.5, zoom = 1.44) => (
  <Framed source={SOURCE.phone} u={u} v={v} zoom={zoom}>
    <Freeze clip={clip} at={at} fit="fill" />
  </Framed>
);
const battle = (clip: 'arsenal' | 'defense' | 'base', at: number, u: number, v: number, zoom = 4.6, play = false) => (
  <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom}>
    {play ? <Footage shot={{clip, at: 0, beats: 1, from: at}} fit="fill" /> : <Freeze clip={clip} at={at} fit="fill" />}
  </Framed>
);
const art = (src: string, w: number) => (
  <AbsoluteFill style={{background: '#000', justifyContent: 'center', alignItems: 'center'}}>
    <Img src={staticFile(src)} style={{width: w, filter: 'drop-shadow(0 0 80px rgba(142,134,232,0.35))'}} />
  </AbsoluteFill>
);

/** One beat each, the best moments, ending on the biggest explosion; then hard cut to silence. */
const CUTS: React.ReactNode[] = [
  full('build', 5.1, 0.3, 0.72, 1.44), //                 the AA gun goes down
  art('art/fleet/battleship.png', 2600), //                the fleet
  art('art/weapons/atomic-bomber.png', 1300), //           the arsenal
  full('match', 3.7, 0.5, 0.5, 1.44), //                   VS
  battle('arsenal', 0.35, 0.72, 0.42, 4.4, true), //       the bomber over enemy waters
  battle('defense', 1.9, 0.28, 0.66, 5.0), //              Shot down!
  battle('base', 3.05, 0.754, 0.26, 5.4), //               the last hit
  battle('base', 5.8, 0.52, 0.3, 4.6), //                  Victory
  full('store', 2.7, 0.5, 0.45, 1.44), //                  the store, Purple
  <Img key="lb" src={staticFile(STILLS.leaderboard)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 38%', scale: 1.35}} />,
];

export const Supercut: React.FC = () => {
  const frame = useCurrentFrame();
  const last = f(B.cuts - 2);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ZoomPunch hits={CUTS.map((_, i) => ({at: f(i), amount: 0.04}))}>
        {CUTS.map((c, i) => (
          <Sequence key={i} from={f(i)} durationInFrames={f(1)} layout="none">
            <AbsoluteFill style={{scale: 1 + (frame - f(i)) * 0.003}}>{c}</AbsoluteFill>
          </Sequence>
        ))}
      </ZoomPunch>
      {/* the biggest explosion: the atomic strike, two beats, everything on it */}
      <Sequence from={last} durationInFrames={f(2)} layout="none">
        <ZoomPunch hits={[{at: 0, amount: 0.1, flash: true, shake: true}]}>
          <AbsoluteFill style={{scale: 1 + (frame - last) * 0.004}}>{battle('arsenal', 1.2, 0.725, 0.47, 5.6, true)}</AbsoluteFill>
        </ZoomPunch>
      </Sequence>
    </AbsoluteFill>
  );
};
