import React from 'react';
import { Composition, Folder } from 'remotion';
import { Trailer45 } from './trailer45/Trailer45';
import { DURATION } from './trailer45/timeline';

export const RemotionRoot: React.FC = () => (
  <Folder name="Launch">
    <Composition
      id="Trailer45"
      component={Trailer45}
      durationInFrames={DURATION}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ audio: true }}
    />
  </Folder>
);
