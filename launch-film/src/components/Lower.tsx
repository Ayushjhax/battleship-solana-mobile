import React from 'react';
import {useCurrentFrame} from 'remotion';
import {enter, exit} from '../lib/anim';
import {C, FONT, SAFE} from '../theme';

/** Weapon-name label for the battle montage: accent dot + in-game name, lower left. */
export const WeaponLabel: React.FC<{name: string; at: number; out?: number}> = ({name, at, out}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, at, 18);
  const o = out === undefined ? 0 : exit(frame, out, 10);
  if (frame < at || o >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.x + 20,
        bottom: SAFE.y + 60,
        display: 'flex',
        alignItems: 'center',
        gap: 30,
        opacity: p * (1 - o),
        translate: `${(1 - p) * -30}px 0`,
      }}
    >
      <div style={{width: 22, height: 22, background: C.accent, boxShadow: `0 0 24px 4px rgba(142,134,232,0.6)`}} />
      <div style={{fontFamily: FONT.game, fontWeight: 700, fontSize: 72, color: C.white, textShadow: '0 4px 30px rgba(0,0,0,0.9)'}}>{name}</div>
    </div>
  );
};

/** A bottom gradient that dims the plate under type. */
export const BottomShade: React.FC<{opacity?: number; height?: number}> = ({opacity = 1, height = 900}) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height,
      opacity,
      background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0) 100%)',
    }}
  />
);
