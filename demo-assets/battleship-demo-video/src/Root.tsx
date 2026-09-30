import React from 'react';
import { Composition } from 'remotion';

import { VIDEO } from './config';
import { Demo } from './Demo';
import { DemoV2 } from './v2/DemoV2';
import { fontsReady } from './lib/assets';

// Start loading Bitter as soon as the bundle runs; loadFont holds every frame
// until the faces are ready.
void fontsReady;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="EmpireOfBitsDemo"
        component={Demo}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={VIDEO.durationInFrames}
      />
      <Composition
        id="EmpireOfBitsDemoV2"
        component={DemoV2}
        width={VIDEO.width}
        height={VIDEO.height}
        fps={VIDEO.fps}
        durationInFrames={VIDEO.durationInFrames}
      />
    </>
  );
};
