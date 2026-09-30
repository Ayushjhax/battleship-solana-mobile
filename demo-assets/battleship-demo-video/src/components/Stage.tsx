import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { COLOR, END_CARD } from '../config';

/**
 * The backdrop: the game's graph paper turned to deep ink — minor rules every
 * 64 px, major every 320 px — drifting slowly so the frame never sits dead,
 * then fixed once the end card lands.
 */
export const Stage: React.FC = () => {
  const frame = useCurrentFrame();
  const t = Math.min(frame, END_CARD.from);
  const dx = -t * 0.22;
  const dy = -t * 0.34;

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${COLOR.stageTop} 0%, ${COLOR.stageBottom} 100%)` }}>
      <AbsoluteFill
        style={{
          backgroundImage: [
            'linear-gradient(rgba(166,216,238,0.10) 2px, transparent 2px)',
            'linear-gradient(90deg, rgba(166,216,238,0.10) 2px, transparent 2px)',
            'linear-gradient(rgba(207,233,246,0.045) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(207,233,246,0.045) 1px, transparent 1px)',
          ].join(','),
          backgroundSize: '320px 320px, 320px 320px, 64px 64px, 64px 64px',
          backgroundPosition: `${dx}px ${dy}px, ${dx}px ${dy}px, ${dx}px ${dy}px, ${dx}px ${dy}px`,
        }}
      />
      {/* light pooled behind the window, dark at the edges */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 60% 55% at 50% 44%, rgba(92,96,220,0.22) 0%, rgba(92,96,220,0) 70%), radial-gradient(ellipse 85% 85% at 50% 50%, rgba(0,0,0,0) 55%, rgba(2,2,20,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
