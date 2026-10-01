import React from 'react';
import { Composition, Folder } from 'remotion';
import { Trailer45 } from './trailer45/Trailer45';
import { DURATION } from './trailer45/timeline';
import { Deck30 } from './deck30/Deck30';
import { DURATION as DECK30_DURATION } from './deck30/timeline';

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
    <Composition
      id="Deck30"
      component={Deck30}
      durationInFrames={DECK30_DURATION}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ audio: true }}
    />
  </Folder>
);
