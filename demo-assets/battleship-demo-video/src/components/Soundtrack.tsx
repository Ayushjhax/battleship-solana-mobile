import { Audio } from '@remotion/media';
import React from 'react';
import { interpolate, Sequence, staticFile } from 'remotion';

import { MUSIC, SFX, VIDEO } from '../config';

interface Cue {
  id: string;
  src: string;
  at: number;
  volume: number;
}

interface Bed {
  src: string;
  volume: number;
  fadeIn: readonly [number, number];
  fadeOut: readonly [number, number];
}

/**
 * The game's own music under everything, its effects on the frames the game
 * plays them. The bed fades to silence before the last frame.
 */
export const Soundtrack: React.FC<{ music?: Bed; sfx?: readonly Cue[] }> = ({ music: bed = MUSIC, sfx = SFX }) => {
  return (
    <>
      <Sequence durationInFrames={VIDEO.durationInFrames} name="music" layout="none">
        <Audio
          src={staticFile(bed.src)}
          volume={(f) =>
            bed.volume *
            interpolate(f, bed.fadeIn, [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
            interpolate(f, bed.fadeOut, [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          }
        />
      </Sequence>
      {sfx.map((cue) => (
        <Sequence key={cue.id} from={cue.at} durationInFrames={VIDEO.durationInFrames - cue.at} name={`sfx:${cue.id}`} layout="none">
          <Audio src={staticFile(cue.src)} volume={cue.volume} />
        </Sequence>
      ))}
    </>
  );
};
