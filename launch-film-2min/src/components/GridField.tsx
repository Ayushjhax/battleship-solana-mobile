import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C} from '../theme';

/**
 * The game's graph paper, glowing faintly on black: a minor rule every `cell` px and a major
 * rule every 5th (like the board). Revealed by a radial mask of radius `reveal` around (cx, cy).
 * `drift` moves the paper for parallax.
 */
export const GridField: React.FC<{
  cell?: number;
  opacity?: number;
  reveal?: number;
  cx?: number;
  cy?: number;
  driftX?: number;
  driftY?: number;
  feather?: number;
}> = ({cell = 120, opacity = 0.1, reveal = 99999, cx = 1920, cy = 1080, driftX = 0, driftY = 0, feather = 500}) => {
  const minor = `rgba(207,233,246,0.55)`;
  const major = C.grid;
  const mask = `radial-gradient(circle at ${cx}px ${cy}px, #000 ${Math.max(0, reveal - feather)}px, rgba(0,0,0,0.35) ${reveal - feather * 0.3}px, transparent ${reveal}px)`;
  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage: [
          `linear-gradient(to right, ${major} 3px, transparent 3px)`,
          `linear-gradient(to bottom, ${major} 3px, transparent 3px)`,
          `linear-gradient(to right, ${minor} 1.5px, transparent 1.5px)`,
          `linear-gradient(to bottom, ${minor} 1.5px, transparent 1.5px)`,
        ].join(','),
        backgroundSize: `${cell * 5}px ${cell * 5}px, ${cell * 5}px ${cell * 5}px, ${cell}px ${cell}px, ${cell}px ${cell}px`,
        backgroundPosition: `${cx + driftX}px ${cy + driftY}px`,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
};
