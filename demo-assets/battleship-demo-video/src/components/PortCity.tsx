import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { COLOR, PORT, WINDOW } from '../config';
import { cameraAt, framing } from '../lib/camera';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type Building = (typeof PORT.buildings)[number];
const hasLabel = (b: Building): b is Building & { label: { dy: number; w: number } } => 'label' in b;

/**
 * Port City, rebuilt from the game's own layout: the empty-plot map, the
 * fifteen buildings on their plots in painter's order, the "Your Harbour"
 * ribbon and the six landmark ribbons — all placed in map pixels, exactly as
 * src/features/city/cityLayout.ts places them.
 */
export const PortCity: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const T = PORT.timing;

  if (frame < T.dip[0] || frame >= T.end) return null;

  // --- the window opening to full frame, and closing again ---------------
  const open =
    frame < T.contract[0]
      ? smooth(interpolate(frame, T.expand, [0, 1], clamp))
      : 1 - smooth(interpolate(frame, T.contract, [0, 1], clamp));
  const inset = {
    top: WINDOW.y * (1 - open),
    left: WINDOW.x * (1 - open),
    right: (width - WINDOW.x - WINDOW.w) * (1 - open),
    bottom: (height - WINDOW.y - WINDOW.h) * (1 - open),
    radius: WINDOW.radius * (1 - open),
  };
  // dip through paper: the defence fades to the game's sheet, the port comes up out of it
  const [dipIn, dipPeak, dipOut] = T.dip;
  const paper =
    frame < dipPeak
      ? smooth(interpolate(frame, [dipIn, dipPeak], [0, 1], clamp))
      : 1 - smooth(interpolate(frame, [dipPeak, dipOut], [0, 1], clamp));
  const showPort = frame >= dipPeak;

  // --- camera: a gentle pull-back over the whole harbour -----------------
  const cam = cameraAt(PORT.camera.keys, [], frame);
  const { scale, tx, ty } = framing(cam, PORT.map.w, PORT.map.h, width, height);
  const endZoom = PORT.camera.keys[PORT.camera.keys.length - 1].zoom;
  const lift = Math.pow(cam.zoom / endZoom, PORT.heightParallax);

  const buildings = [...PORT.buildings].sort((a, b) => a.y - b.y);
  const [labelW, labelH] = PORT.labelArt;

  const ribbon = PORT.harbourRibbon;
  const ribbonH = (ribbon.w * ribbon.art[1]) / ribbon.art[0];
  const ribbonIn = easeOut(interpolate(frame, T.ribbonIn, [0, 1], clamp));

  return (
    <AbsoluteFill
      style={{
        clipPath: `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px round ${inset.radius}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: PORT.map.w,
          height: PORT.map.h,
          opacity: showPort ? 1 : 0,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        {/* ground: terrain, water, bridge and piers */}
        <Img src={staticFile(PORT.map.src)} style={{ position: 'absolute', left: 0, top: 0, width: PORT.map.w, height: PORT.map.h }} />

        {/* "Your Harbour", on the water under the bridge (beneath the buildings, as in the game) */}
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

        {/* buildings on their plots, nearer ones drawn over farther ones */}
        {buildings.map((b) => {
          const h = (b.w * b.art[1]) / b.art[0];
          return (
            <Img
              key={b.id}
              src={staticFile(`port/buildings/${b.id}@2x.png`)}
              style={{
                position: 'absolute',
                left: b.x - b.w / 2,
                top: b.y - h,
                width: b.w,
                height: h,
                transformOrigin: '50% 100%',
                transform: `scale(${lift})`,
              }}
            />
          );
        })}

        {/* landmark ribbons, introduced one by one as the harbour opens up */}
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
      </div>

      {/* a pool of ink behind the caption only, so it keeps its contrast over the paper */}
      <AbsoluteFill
        style={{
          opacity: open,
          background:
            'radial-gradient(ellipse 36% 27% at 20% 89%, rgba(6,7,44,0.8) 0%, rgba(6,7,44,0.55) 48%, rgba(6,7,44,0) 100%), linear-gradient(0deg, rgba(6,7,44,0.38) 0%, rgba(6,7,44,0) 19%)',
        }}
      />
      <AbsoluteFill style={{ backgroundColor: COLOR.sheet, opacity: paper }} />
    </AbsoluteFill>
  );
};
