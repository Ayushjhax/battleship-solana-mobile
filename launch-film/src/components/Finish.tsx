import React from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';

/** 12 pre-generated tileable grain tiles (public/grain), one per frame, offset each frame. */
export const Grain: React.FC<{amount?: number}> = ({amount = 0.035}) => {
  const frame = useCurrentFrame();
  const i = frame % 12;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile(`grain/grain_${String(i).padStart(2, '0')}.png`)})`,
        backgroundSize: '512px 512px',
        backgroundPosition: `${(frame * 137) % 512}px ${(frame * 89) % 512}px`,
        opacity: amount,
        mixBlendMode: 'screen',
        pointerEvents: 'none',
      }}
    />
  );
};

/** Soft vignette. */
export const Vignette: React.FC<{strength?: number}> = ({strength = 0.5}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength * 0.6}) 85%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);
