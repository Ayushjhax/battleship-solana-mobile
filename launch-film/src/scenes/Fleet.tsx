import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {KineticText} from '../components/KineticText';
import {COPY} from '../config/copy';
import {f, FLEET as B} from '../config/timeline';
import {cam, CLAMP, enter, exit, mix} from '../lib/anim';
import {C, FONT, TRACK, TYPE} from '../theme';

/** The four classes from src/engine/fleet.ts, with their lengths (cells); art is the Purple edition. */
const CLASSES = [
  {key: 'battleship', len: 4, aspect: 557 / 1918},
  {key: 'cruiser', len: 3, aspect: 504 / 1878},
  {key: 'destroyer', len: 2, aspect: 535 / 1720},
  {key: 'boat', len: 1, aspect: 541 / 1746},
] as const;
/** The full fleet: 1 battleship, 2 cruisers, 3 destroyers, 2 patrol boats = FLEET_SHIP_COUNT (8). */
const FLEET = [0, 1, 1, 2, 2, 2, 3, 3];

const CELL = 270; // px per cell length in the lineup (4+3+2+1 cells + gaps stay inside title-safe)
const GAP = 150;
const Y = 1090;

const Hull: React.FC<{cls: number; x: number; y: number; w: number; opacity?: number; blur?: number}> = ({cls, x, y, w, opacity = 1, blur = 0}) => {
  const c = CLASSES[cls];
  const h = w * c.aspect;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        opacity,
        filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
        WebkitBoxReflect: `below ${h * 0.12}px linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.22) 100%)`,
      }}
    >
      <Img src={staticFile(`art/fleet/${c.key}.png`)} style={{width: '100%', height: '100%', filter: 'drop-shadow(0 0 40px rgba(142,134,232,0.18))'}} />
    </div>
  );
};

/**
 * Meet the fleet: the four classes in a lineup on black with floor reflections and a slow
 * lateral dolly, one per beat, named in the game's face. Then the camera pulls back and the
 * rest of the fleet joins: 8 ships.
 */
export const Fleet: React.FC = () => {
  const frame = useCurrentFrame();
  const dolly = cam(frame, 0, f(12));
  const pull = cam(frame, f(B.stat) - 16, f(B.stat) + 10);

  // lineup of the four classes, lengths to scale
  const widths = CLASSES.map((c) => c.len * CELL);
  const total = widths.reduce((a, b) => a + b, 0) + GAP * 3;
  let acc = 1920 - total / 2;
  const xs = widths.map((w) => {
    const x = acc + w / 2;
    acc += w + GAP;
    return x;
  });

  // the full fleet of eight: two rows, same scale
  const fleetW = FLEET.map((i) => CLASSES[i].len * CELL * 0.62);
  const rowA = [0, 1, 2]; // battleship, cruiser, cruiser
  const rowB = [3, 4, 5, 6, 7]; // destroyers, boats
  const place = (row: number[], y: number) => {
    const t = row.reduce((a, i) => a + fleetW[i], 0) + (row.length - 1) * 120;
    let a = 1920 - t / 2;
    return row.map((i) => {
      const x = a + fleetW[i] / 2;
      a += fleetW[i] + 120;
      return {i, x, y};
    });
  };
  const formation = [...place(rowA, 900), ...place(rowB, 1230)].sort((a, b) => a.i - b.i);

  const namesOut = exit(frame, f(B.stat) - 18, 12);
  const panX = mix(120, -120, dolly) * (1 - pull);

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {/* soft floor light */}
      <AbsoluteFill style={{background: 'radial-gradient(ellipse 60% 22% at 50% 62%, rgba(108,95,214,0.10), rgba(0,0,0,0) 70%)'}} />
      <AbsoluteFill style={{translate: `${panX}px 0`, scale: mix(1, 1.04, dolly)}}>
        {FLEET.map((cls, n) => {
          const isLead = n === 0 || n === 1 || n === 3 || n === 6; // the first of each class leads the lineup
          const leadIdx = isLead ? [0, 1, -1, 2, -1, -1, 3, -1][n] : -1;
          const target = formation[n];
          if (isLead) {
            const inP = enter(frame, f(B.ships[leadIdx]) - (leadIdx === 0 ? 12 : 4), 24);
            const x0 = xs[leadIdx] + mix(700, 0, inP);
            const w = mix(widths[leadIdx], fleetW[n], pull);
            return (
              <Hull
                key={n}
                cls={cls}
                x={mix(x0, target.x, pull)}
                y={mix(Y, target.y, pull)}
                w={w}
                opacity={inP}
                blur={(1 - inP) * 18}
              />
            );
          }
          const j = enter(frame, f(B.stat) - 6 + (n % 4) * 2, 22);
          return <Hull key={n} cls={cls} x={target.x + mix(500, 0, j)} y={target.y} w={fleetW[n]} opacity={j} blur={(1 - j) * 14} />;
        })}
        {/* names */}
        {CLASSES.map((c, i) => {
          const p = enter(frame, f(B.ships[i]) + 4, 20);
          return (
            <div
              key={c.key}
              style={{
                position: 'absolute',
                left: xs[i] - 400,
                width: 800,
                top: Y + 250,
                textAlign: 'center',
                fontFamily: FONT.game,
                fontWeight: 700,
                fontSize: 60,
                color: C.white,
                opacity: p * (1 - namesOut),
                translate: `0 ${(1 - p) * 24}px`,
              }}
            >
              {COPY.fleet.ships[i]}
            </div>
          );
        })}
      </AbsoluteFill>

      <div style={{position: 'absolute', left: 0, right: 0, top: 300}}>
        <KineticText text={COPY.fleet.headline} at={f(B.headline)} out={f(B.stat) - 16} size="headline" />
      </div>
      {/* the stat */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 1520,
          textAlign: 'center',
          fontFamily: FONT.head,
          fontWeight: 700,
          fontSize: TYPE.hero,
          letterSpacing: TRACK.hero,
          color: C.white,
          lineHeight: 1,
          opacity: interpolate(frame, [f(B.stat), f(B.stat) + 3], [0, 1], CLAMP),
          scale: mix(1.18, 1, enter(frame, f(B.stat), 12)),
        }}
      >
        {COPY.fleet.statNumber}{' '}
        <span style={{fontWeight: 600, color: C.white}}>{COPY.fleet.statWord}</span>
      </div>
    </AbsoluteFill>
  );
};
