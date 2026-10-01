/**
 * Deck30 — the 30-second deck film. Sections sit on the beat grid in timeline.ts; the finish (letterbox, flashes,
 * halation, grain, vignette) is on top. Frame 0 is the poster; the last frame is the trailer's end card.
 */
import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { Grain, Vignette } from '../trailer45/components/Finish';
import { C } from '../trailer45/theme';
import '../trailer45/fonts';
import { Flashes, Halation, Letterbox, Shake } from './components/Finish';
import { PosterFreeze, Real } from './scenes/Opening';
import { TheBit } from './scenes/TheBit';
import { Flip } from './scenes/Flip';
import { Drop } from './scenes/Drop';
import { Victory } from './scenes/Victory';
import { Finale } from './scenes/Finale';
import { PERIOD_FRAMES, SECTIONS, f, type SectionId } from './timeline';

const span = (a: SectionId, b: SectionId = a) => ({ from: f(SECTIONS[a][0]), durationInFrames: f(SECTIONS[b][1]) - f(SECTIONS[a][0]) });

export type Deck30Props = { audio: boolean };

export const Deck30: React.FC<Deck30Props> = ({ audio }) => (
  <AbsoluteFill style={{ background: C.black }}>
    <Shake>
      <Sequence name="poster → ALIVE" {...span('poster', 'alive')}>
        <PosterFreeze />
      </Sequence>
      <Sequence name="REAL strobe" {...span('real')}>
        <Real />
      </Sequence>
      <Sequence name="the bit (sonic logo)" {...span('bit')}>
        <TheBit />
      </Sequence>
      <Sequence name="the flip → FIRE → silence → the period" from={f(SECTIONS.flip[0])} durationInFrames={f(SECTIONS.silence[1]) - f(SECTIONS.flip[0]) + PERIOD_FRAMES}>
        <Flip />
      </Sequence>
      <Sequence name="THE DROP" {...span('drop')}>
        <Drop />
      </Sequence>
      <Sequence name="VICTORY → economy" {...span('victory', 'economy')}>
        <Victory />
      </Sequence>
      <Sequence name="one becomes all → end card" from={f(SECTIONS.mitosis[0])}>
        <Finale />
      </Sequence>
    </Shake>
    <Letterbox />
    <Flashes />
    <Halation />
    <Vignette />
    <Grain />
    {audio && <Audio src={staticFile('deck30/audio/soundtrack.wav')} />}
  </AbsoluteFill>
);
