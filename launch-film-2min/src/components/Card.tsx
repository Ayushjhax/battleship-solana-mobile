import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';
import {enter, mix} from '../lib/anim';
import {C, FONT, INNER_HIGHLIGHT, RADIUS, SHADOW} from '../theme';

/** The game's graph paper as a surface (paper #FBFCFE, gridMinor/gridMajor rules). */
export const paperStyle = (cell = 64): React.CSSProperties => ({
  backgroundColor: '#FBFCFE',
  backgroundImage: [
    'linear-gradient(to right, #A6D8EE 2px, transparent 2px)',
    'linear-gradient(to bottom, #A6D8EE 2px, transparent 2px)',
    'linear-gradient(to right, #CFE9F6 1.5px, transparent 1.5px)',
    'linear-gradient(to bottom, #CFE9F6 1.5px, transparent 1.5px)',
  ].join(','),
  backgroundSize: `${cell * 5}px ${cell * 5}px, ${cell * 5}px ${cell * 5}px, ${cell}px ${cell}px, ${cell}px ${cell}px`,
  backgroundPosition: 'center center',
});

/**
 * A floating card of in-game art: rounded glass tile on black (or graph paper), the art
 * centred, the in-game name beneath in Bitter. Flies in from `fromX/fromY` with a tilt.
 */
export const ArtCard: React.FC<{
  src: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
  fromX?: number;
  fromY?: number;
  paper?: boolean;
  artScale?: number;
  opacity?: number;
}> = ({src, name, x, y, w, h, at, fromX = 0, fromY = 300, paper = false, artScale = 0.72, opacity = 1}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, at, 26);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2 + mix(fromX, 0, p),
        top: y - h / 2 + mix(fromY, 0, p),
        width: w,
        height: h,
        opacity: p * opacity,
        perspective: 3000,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `rotateX(${mix(18, 0, p)}deg) rotateY(${mix(fromX > 0 ? -14 : fromX < 0 ? 14 : 0, 0, p)}deg)`,
          borderRadius: RADIUS.tile,
          overflow: 'hidden',
          boxShadow: `${SHADOW}, ${INNER_HIGHLIGHT}`,
          ...(paper ? paperStyle() : {background: 'linear-gradient(160deg, #17171d 0%, #0c0c10 100%)'}),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: p < 1 ? `blur(${(1 - p) * 12}px)` : undefined,
        }}
      >
        <Img src={staticFile(src)} style={{maxWidth: `${artScale * 100}%`, maxHeight: `${artScale * 100}%`, objectFit: 'contain'}} />
      </div>
      {name ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: h + 48,
            textAlign: 'center',
            fontFamily: FONT.game,
            fontWeight: 700,
            fontSize: 68,
            color: C.white,
          }}
        >
          {name}
        </div>
      ) : null}
    </div>
  );
};
