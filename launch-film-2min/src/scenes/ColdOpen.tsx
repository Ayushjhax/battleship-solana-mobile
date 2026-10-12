import {measureText} from '@remotion/layout-utils';
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {Bit} from '../components/Bit';
import {Freeze} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {GridField} from '../components/GridField';
import {KineticText} from '../components/KineticText';
import {SonarPing} from '../components/SonarPing';
import {COPY} from '../config/copy';
import {COLD_OPEN as B, f} from '../config/timeline';
import {cam, CLAMP, enter, exit, mix} from '../lib/anim';
import {fontsReady} from '../lib/fonts';
import {EASE, FONT} from '../theme';

const FS = 168; // cold-open type: quieter than a headline
const W8 = 600;
const TRACKING = '-0.03em';
const BIT = 30;
/** baseline of the lines (px) */
const BASE_Y = 1040;
/** Inter Tight: with line-height 1, the baseline sits 0.864em below the line box top */
const ASC = 0.864;

/** A 3-frame flash of battle between the words. */
const Flash: React.FC<{clip: 'arsenal' | 'defense'; at: number; u: number; v: number; zoom?: number}> = ({clip, at, u, v, zoom = 4.4}) => (
  <AbsoluteFill style={{opacity: 0.92}}>
    <Framed source={SOURCE.battle} u={u} v={v} zoom={zoom}>
      <Freeze clip={clip} at={at} fit="fill" />
    </Framed>
  </AbsoluteFill>
);

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('fonts for measureText'));
  useEffect(() => {
    fontsReady.then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);

  // where the period of line 2 sits: the line is centred, the bit is its final glyph
  let periodX = 1920;
  if (ready) {
    const w = measureText({text: COPY.coldOpen.line2, fontFamily: FONT.head, fontSize: FS, fontWeight: String(W8), letterSpacing: TRACKING}).width;
    const gap = FS * 0.07;
    const total = w + gap + BIT;
    periodX = 1920 - total / 2 + w + gap + BIT / 2;
  }
  const periodY = BASE_Y - BIT / 2;

  // the bit: fades up, breathes, glides into the period, pings
  const fadeUp = enter(frame, f(B.pixelIn), 30);
  const breath = 1 + 0.12 * Math.sin(((frame - f(B.pixelIn)) / 30) * Math.PI) ** 2;
  const glide = cam(frame, f(B.pixelToPeriod) - 18, f(B.pixelToPeriod) + 6);
  const bx = mix(1920, periodX, glide);
  const by = mix(1080 + 170, periodY, glide);
  const pingGlow = interpolate(frame, [f(B.ping1), f(B.ping1) + 4, f(B.ping1) + 30], [1, 1.9, 1], CLAMP) *
    interpolate(frame, [f(B.ping2), f(B.ping2) + 4, f(B.ping2) + 30], [1, 1.9, 1], CLAMP);
  const cutOut = exit(frame, f(B.cut) - 6, 6);

  // the grid draws in with the first ring and keeps drifting
  const ring = interpolate(frame, [f(B.ping1), f(B.ping1) + 70], [0, 2600], {...CLAMP, easing: EASE.enter});
  const ring2 = interpolate(frame, [f(B.ping2), f(B.ping2) + 70], [0, 1400], {...CLAMP, easing: EASE.enter});

  const lineTop = BASE_Y - ASC * FS;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{scale: 1 + 0.05 * (frame / f(B.cut))}}>
        <GridField opacity={0.11} reveal={Math.max(ring, 0)} cx={1920} cy={1250} driftX={-frame * 0.6} driftY={-frame * 0.3} feather={700} />
        <GridField opacity={0.1 * (1 - interpolate(frame, [f(B.ping2), f(B.ping2) + 70], [0, 1], CLAMP))} reveal={ring2} cx={periodX} cy={periodY} feather={260} cell={120} />
      </AbsoluteFill>

      <SonarPing x={1920} y={1250} at={f(B.ping1)} radius={2400} rings={3} dur={80} />
      <SonarPing x={periodX} y={periodY} at={f(B.ping2)} radius={2200} rings={3} dur={80} />

      {/* line 1 */}
      <div style={{position: 'absolute', left: 0, right: 0, top: lineTop}}>
        <KineticText text={COPY.coldOpen.line1} at={f(B.line1In)} out={f(B.line1Out)} fontSize={FS} weight={W8} tracking={TRACKING} />
      </div>
      {/* line 2, with room for the bit as its period */}
      <div style={{position: 'absolute', left: 0, right: 0, top: lineTop}}>
        <KineticText
          text={COPY.coldOpen.line2}
          at={f(B.line2In)}
          out={f(B.cut) - 6}
          fontSize={FS}
          weight={W8}
          tracking={TRACKING}
          tail={<span style={{display: 'inline-block', width: FS * 0.07 + BIT}} />}
        />
      </div>

      <div style={{position: 'absolute', left: bx - BIT / 2, top: by - BIT / 2, opacity: fadeUp * (1 - cutOut), scale: breath * (0.6 + 0.4 * fadeUp)}}>
        <Bit size={BIT} glow={pingGlow} />
      </div>

      {/* flashes of battle between the words */}
      <Sequence from={f(B.flashes[0])} durationInFrames={B.flashFrames} layout="none">
        <Flash clip="arsenal" at={1.45} u={0.72} v={0.5} />
      </Sequence>
      <Sequence from={f(B.flashes[1])} durationInFrames={B.flashFrames} layout="none">
        <Flash clip="defense" at={1.8} u={0.2} v={0.62} />
      </Sequence>
      <Sequence from={f(B.flashes[2])} durationInFrames={B.flashFrames} layout="none">
        <Flash clip="arsenal" at={1.75} u={0.72} v={0.45} zoom={5.2} />
      </Sequence>
    </AbsoluteFill>
  );
};
