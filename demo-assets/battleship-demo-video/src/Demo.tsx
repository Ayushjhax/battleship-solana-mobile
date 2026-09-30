import React from 'react';
import { AbsoluteFill } from 'remotion';

import { Caption } from './components/Caption';
import { EndCard } from './components/EndCard';
import { Gameplay } from './components/Gameplay';
import { PortCity } from './components/PortCity';
import { Soundtrack } from './components/Soundtrack';
import { Stage } from './components/Stage';

/**
 * Empire of Bits: Battleship — 15 s demo.
 *   0–179    Choose your attack.     arsenal-attack.mp4 (Atomic Bomb)
 *   180–359  Build your defense.     defense.mp4 (AA gun, "Shot down!")
 *   360–509  Your home port.         Port City, rebuilt from the game's layout
 *   510–779  Take the fight to them. base-attack.mp4 (Bomber → sunk → Victory)
 *   780–899  Availability card.
 */
export const Demo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#05062C' }}>
      <Stage />
      <Gameplay />
      <PortCity />
      <EndCard />
      <Caption />
      <Soundtrack />
    </AbsoluteFill>
  );
};
