import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { EndCard } from '../components/EndCard';
import { Soundtrack } from '../components/Soundtrack';
import { Stage } from '../components/Stage';
import { CaptionV2 } from './CaptionV2';
import { MUSIC_V2, SFX_V2 } from './configV2';
import { GameplayV2 } from './GameplayV2';
import { InkRim } from './InkRim';
import { PortV2 } from './PortV2';
import { ShipWipe } from './ShipWipe';

/**
 * v2 — the board becomes a world.
 *   0–179    Choose your attack.     close on the armed Atomic Bomb, settle, strike
 *   180–359  Build your defense.     swing to our board; AA gun; "Shot down!"
 *   ~336–370 the board's lighthouse becomes the harbour's; ink bloom
 *   360–509  Your home port.         pull back over a layered, living harbour
 *   ~494–526 the fleet battleship crosses; the battle is revealed in its wake
 *   510–779  Take the fight to them. Bomber → sunk → the real Victory banner lifts
 *   780–899  Availability card.
 */
export const DemoV2: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: '#05062C' }}>
      <Stage />
      <PortV2 />
      <GameplayV2 zIndex={frame < 420 ? 10 : 8} />
      <InkRim />
      <ShipWipe />
      <EndCard />
      <CaptionV2 />
      <Soundtrack music={MUSIC_V2} sfx={SFX_V2} />
    </AbsoluteFill>
  );
};
