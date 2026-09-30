import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

import { liftAt, MAP, portXform } from './cameraV2';
import { CAPTIONS_V2, LIGHTHOUSE, PORT, PORT_V2 } from './configV2';
import { wakeLine, wipeActive } from './ShipWipe';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type Building = (typeof PORT.buildings)[number];
const hasLabel = (b: Building): b is Building & { label: { dy: number; w: number } } => 'label' in b;

const FIRST = LIGHTHOUSE.bloom.frames[0] - 20; // the board's edge comes into view
const LAST = 527;

/** The sailboat cut from expedition_dock.png, rocking at its mooring. */
const ExpeditionDock: React.FC<{ b: Building; frame: number }> = ({ b, frame }) => {
  const h = (b.w * b.art[1]) / b.art[0];
  const k = b.w / b.art[0];
  const boat = PORT_V2.boat;
  const pts = boat.polygon.map(([x, y]) => [x * k, y * k] as const);
  const hole = `M0 0 H${b.w} V${h} H0 Z ` + pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z';
  const phase = (frame / boat.period) * Math.PI * 2;
  const src = staticFile(`port/buildings/${b.id}@2x.png`);
  const style: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: b.w, height: h };
  return (
    <>
      <Img src={src} style={{ ...style, clipPath: `path(evenodd, "${hole}")` }} />
      <Img
        src={src}
        style={{
          ...style,
          clipPath: `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})`,
          transformOrigin: `${boat.pivot[0] * k}px ${boat.pivot[1] * k}px`,
          transform: `translateY(${boat.bob * k * Math.sin(phase + Math.PI / 2)}px) rotate(${boat.rock * Math.sin(phase)}deg)`,
        }}
      />
    </>
  );
};

export const PortV2: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < FIRST || frame > LAST) return null;

  const cam = portXform(frame);
  const T = PORT_V2.timing;
  const buildings = [...PORT.buildings].sort((a, b) => a.y - b.y);
  const [labelW, labelH] = PORT.labelArt;
  const ribbon = PORT.harbourRibbon;
  const ribbonH = (ribbon.w * ribbon.art[1]) / ribbon.art[0];
  const ribbonIn = easeOut(interpolate(frame, T.ribbonIn, [0, 1], clamp));

  // under the board until the harbour takes over; over the raid for the ship's wake
  const zIndex = frame < 420 ? 5 : 20;
  const clipPath = wipeActive(frame) ? `inset(0px 0px 0px ${Math.max(0, wakeLine(frame))}px)` : undefined;

  const caption = CAPTIONS_V2[2];
  const pool =
    interpolate(frame, [caption.inAt - 6, caption.inAt + 6], [0, 1], clamp) *
    interpolate(frame, [caption.outAt, caption.outAt + 10], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ zIndex, clipPath }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: MAP.w,
          height: MAP.h,
          transformOrigin: '0 0',
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`,
        }}
      >
        {/* the sea carries on past the map's edge */}
        <div style={{ position: 'absolute', left: -600, top: -300, width: MAP.w + 1200, height: MAP.h + 700, background: PORT_V2.seaTone }} />
        <Img src={staticFile(MAP.src)} style={{ position: 'absolute', left: 0, top: 0, width: MAP.w, height: MAP.h }} />

        {/* sun on the water: small glints, each on its own slow twinkle */}
        {PORT_V2.glints.map(([x, y], i) => {
          const period = 70 + ((i * 37) % 60);
          const v = Math.max(0, Math.sin(((frame + i * 23) / period) * Math.PI * 2));
          const o = 0.8 * Math.pow(v, 4);
          if (o < 0.02) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x - 8,
                top: y - 1.4,
                width: 16,
                height: 2.8,
                borderRadius: 2,
                background: 'radial-gradient(ellipse at center, rgba(255,255,255,1) 0%, rgba(255,255,255,0.7) 45%, rgba(255,255,255,0) 100%)',
                boxShadow: '0 0 3px 1px rgba(255,255,255,0.6)',
                opacity: o,
              }}
            />
          );
        })}

        <Img
          src={staticFile(ribbon.src)}
          style={{
            position: 'absolute',
            left: ribbon.x,
            top: ribbon.y,
            width: ribbon.w,
            height: ribbonH,
            opacity: ribbonIn,
            transformOrigin: '50% 50%',
            transform: `translateY(${(1 - ribbonIn) * 10}px) scale(${0.9 + 0.1 * ribbonIn})`,
          }}
        />

        {/* buildings on their plots; nearer ones stand up a little more as the camera moves */}
        {buildings.map((b) => {
          const h = (b.w * b.art[1]) / b.art[0];
          const lift = liftAt(cam.zoom, b.y);
          return (
            <div
              key={b.id}
              style={{
                position: 'absolute',
                left: b.x - b.w / 2,
                top: b.y - h,
                width: b.w,
                height: h,
                transformOrigin: '50% 100%',
                transform: `scale(${lift})`,
              }}
            >
              {b.id === 'expedition_dock' ? (
                <ExpeditionDock b={b} frame={frame} />
              ) : (
                <Img src={staticFile(`port/buildings/${b.id}@2x.png`)} style={{ position: 'absolute', left: 0, top: 0, width: b.w, height: h }} />
              )}
            </div>
          );
        })}

        {buildings.filter(hasLabel).map((b) => {
          const order = PORT.labelOrder.indexOf(b.id as (typeof PORT.labelOrder)[number]);
          const start = T.labelsIn + Math.max(0, order) * T.labelStagger;
          const p = easeOut(interpolate(frame, [start, start + 12], [0, 1], clamp));
          const lh = (b.label.w * labelH) / labelW;
          return (
            <Img
              key={`label-${b.id}`}
              src={staticFile(`port/ui/${b.id}_label@2x.png`)}
              style={{
                position: 'absolute',
                left: b.x - b.label.w / 2,
                top: b.y + b.label.dy - lh,
                width: b.label.w,
                height: lh,
                opacity: p,
                transformOrigin: '50% 100%',
                transform: `translateY(${(1 - p) * 8}px) scale(${0.88 + 0.12 * p})`,
              }}
            />
          );
        })}

        {/* two gulls over the harbour mouth — the battle screen's own */}
        {PORT_V2.gulls.map((g, i) => {
          const t = (frame - FIRST) / (LAST - FIRST);
          return (
            <Img
              key={i}
              src={staticFile('game/seagull@2x.png')}
              style={{
                position: 'absolute',
                left: g.x + g.drift * t - g.w / 2,
                top: g.y + 2.2 * Math.sin((frame / 48 + g.phase) * Math.PI * 2),
                width: g.w,
                height: (g.w * 40) / 71,
                opacity: 0.9,
              }}
            />
          );
        })}
      </div>

      {/* a pool of ink behind the caption so it keeps its contrast */}
      <AbsoluteFill
        style={{
          opacity: pool,
          background:
            'radial-gradient(ellipse 36% 27% at 20% 89%, rgba(6,7,44,0.78) 0%, rgba(6,7,44,0.52) 48%, rgba(6,7,44,0) 100%), linear-gradient(0deg, rgba(6,7,44,0.36) 0%, rgba(6,7,44,0) 19%)',
        }}
      />
    </AbsoluteFill>
  );
};
