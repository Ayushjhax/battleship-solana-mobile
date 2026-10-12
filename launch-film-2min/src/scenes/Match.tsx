import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {FloatingScreen} from '../components/FloatingScreen';
import {Footage} from '../components/Footage';
import {ZoomPunch} from '../components/Impact';
import {KineticText} from '../components/KineticText';
import {SonarPing} from '../components/SonarPing';
import {COPY} from '../config/copy';
import {f, MATCH as B} from '../config/timeline';
import {cam, enter, mix} from '../lib/anim';
import {C} from '../theme';

const SW = 2800;
const SH = SW * (1200 / 2670);
const k = SW / 2670;

/**
 * Find your rival: the matchmaking radar, with the film's own sweep laid over the game's dial
 * and spilling onto the black; then a punch into VS.
 */
export const Match: React.FC = () => {
  const frame = useCurrentFrame();
  const lock = cam(frame, f(B.lockOn) - 6, f(B.lockOn) + 8);
  const s = mix(1, 1.36, lock);
  const cx = 1920;
  const cy = mix(1200, 1150, lock);
  // the game's radar dial in the recording (2670-px coords ≈ (1372, 414))
  const dialX = cx + (1372 - 1335) * k * s;
  const dialY = cy + (414 - 600) * k * s;
  const sweepAngle = (frame / 30) * 360 * 0.55;
  const sweepOn = enter(frame, 6, 18) * (1 - enter(frame, f(B.lockOn) - 4, 8));
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ZoomPunch hits={[{at: f(B.lockOn), amount: 0.05}]}>
        <FloatingScreen width={SW} height={SH} x={cx} y={cy} at={-10} scale={s} reflection={lock < 0.5}>
          <Footage shot={B.screen} fit="cover" />
        </FloatingScreen>
        {/* the film's radar sweep, centred on the game's dial */}
        <AbsoluteFill
          style={{
            opacity: sweepOn * 0.85,
            background: `conic-gradient(from ${sweepAngle}deg at ${dialX}px ${dialY}px, rgba(142,134,232,0) 0deg, rgba(142,134,232,0) 300deg, rgba(142,134,232,0.28) 356deg, rgba(220,216,255,0.6) 360deg)`,
            WebkitMaskImage: `radial-gradient(circle 1900px at ${dialX}px ${dialY}px, #000 0%, rgba(0,0,0,0.5) 55%, transparent 100%)`,
            maskImage: `radial-gradient(circle 1900px at ${dialX}px ${dialY}px, #000 0%, rgba(0,0,0,0.5) 55%, transparent 100%)`,
            mixBlendMode: 'screen',
          }}
        />
        <SonarPing x={dialX} y={dialY} at={f(0.5)} radius={2200} rings={2} dur={60} intensity={0.8} />
        <SonarPing x={dialX} y={dialY} at={f(2.5)} radius={2200} rings={2} dur={60} intensity={0.7} />
      </ZoomPunch>
      <div style={{position: 'absolute', left: 0, right: 0, top: 150, color: C.white}}>
        <KineticText text={COPY.match.line} at={f(B.line)} out={f(B.lockOn) - 6} size="headline" />
      </div>
    </AbsoluteFill>
  );
};
