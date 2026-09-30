import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Callout} from '../components/Callout';
import {ArtCard} from '../components/Card';
import {FloatingScreen} from '../components/FloatingScreen';
import {Footage} from '../components/Footage';
import {KineticText} from '../components/KineticText';
import {COPY} from '../config/copy';
import {BUILD as B, EVENTS, f} from '../config/timeline';
import {cam, CLAMP, mix} from '../lib/anim';

// screen geometry (the 2670×1200 recording at 0.97×)
const SW = 2600;
const SH = SW * (1200 / 2670);
const k = SW / 2670;

/** time (scene frames) at which a source second of the recording plays */
const at = (src: number) => f((src - B.screen.from) * 2);

/** a point in the recording (2670-px coords) → screen px, given the camera */
const pt = (x: number, y: number, cx: number, cy: number, s: number) => ({
  x: cx + (x - 1335) * k * s,
  y: cy + (y - 600) * k * s,
});

/**
 * Build your base: the placement screen (fleet + Arsenal panel) on a floating screen. The
 * camera leans into the board as the AA gun and the mine go down, then the defence art flies
 * in as floating cards.
 */
export const Build: React.FC = () => {
  const frame = useCurrentFrame();
  // camera: settle → macro on the board (left) → pull back and dim for the cards
  const lean = cam(frame, f(B.macroIn), f(B.macroIn) + 40);
  const back = cam(frame, f(B.cards) - 10, f(B.cards) + 24);
  const s = mix(1, 1.24, lean) * mix(1, 0.86, back);
  const cx = mix(1920, 2270, lean) + mix(0, -350, back);
  const cy = mix(1230, 1140, lean) + mix(0, 110, back);
  const dim = back * 0.86;
  const blur = back * 16;

  const aa = pt(639, 959, cx, cy, s);
  const mine = pt(728, 871, cx, cy, s);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <FloatingScreen width={SW} height={SH} x={cx} y={cy} at={-10} scale={s} reflection={back < 0.5 && lean < 0.5}>
        <div style={{width: '100%', height: '100%', filter: `brightness(${1 - dim}) blur(${blur}px)`}}>
          <Footage shot={B.screen} fit="cover" />
        </div>
      </FloatingScreen>

      <Callout x={aa.x} y={aa.y} dx={-40} dy={380} label={COPY.build.calloutAa} at={at(EVENTS.build.aaPlaced) + 2} out={f(B.cards) - 4} />
      <Callout x={mine.x} y={mine.y} dx={260} dy={-240} label={COPY.build.calloutMine} at={at(EVENTS.build.minePlaced) + 2} out={f(B.cards) - 4} />
      {/* depth of field: the room around the board falls away while the camera leans in */}
      <AbsoluteFill
        style={{
          opacity: lean * (1 - back),
          background: `radial-gradient(ellipse 1500px 1150px at ${pt(860, 651, cx, cy, s).x}px ${pt(860, 651, cx, cy, s).y}px, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%)`,
        }}
      />

      {/* headline, above the screen */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 170, opacity: interpolate(frame, [f(B.macroIn) - 4, f(B.macroIn) + 6], [1, 0], CLAMP)}}>
        <KineticText text={COPY.build.headline} at={f(B.headline)} out={f(B.headlineOut)} size="headline" />
      </div>

      {/* defence cards */}
      <ArtCard src="art/weapons/aa-gun.png" name={COPY.build.cards[0]} x={1230} y={1150} w={1180} h={1060} at={f(B.cards)} fromX={-500} fromY={200} />
      <ArtCard src="art/weapons/mine.png" name={COPY.build.cards[1]} x={2610} y={1150} w={1180} h={1060} at={f(B.cards) + 7} fromX={500} fromY={200} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 250}}>
        <KineticText text={COPY.build.line2} at={f(B.line2)} out={f(24) - 12} size="headline" />
      </div>
    </AbsoluteFill>
  );
};
