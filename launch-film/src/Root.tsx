import React from 'react';
import {Composition} from 'remotion';
import {DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH} from './config/timeline';
import {LaunchFilm} from './LaunchFilm';
import './lib/fonts';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LaunchFilm"
        component={LaunchFilm}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{audio: true}}
      />
    </>
  );
};
