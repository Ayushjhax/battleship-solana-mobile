/**
 * Trailer45 — the 45 s launch trailer. Sections sit on the beat grid in
 * timeline.ts; the finish (letterbox, flashes, grain, vignette) is on top.
 */
import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { Flashes, Grain, Letterbox, Vignette } from './components/Finish';
import { Shake } from './components/Motion';
import { CastCards, Claim, Hook, Sting } from './scenes/Opening';
import { Arsenal, Build, Fire, Fleet, Rival } from './scenes/Middle';
import { Drop, Economy, Victory } from './scenes/Battle';
import { Finale } from './scenes/Finale';
import { C, FONT } from './theme';
import { SECTIONS, f, type SectionId } from './timeline';
import './fonts';

const span = (id: SectionId) => ({ from: f(SECTIONS[id][0]), durationInFrames: f(SECTIONS[id][1]) - f(SECTIONS[id][0]) });

const Placeholder: React.FC<{ id: string }> = ({ id }) => (
  <AbsoluteFill style={{ background: '#111', alignItems: 'center', justifyContent: 'center', color: '#666', fontFamily: FONT.card, fontSize: 80 }}>
    {id.toUpperCase()}
  </AbsoluteFill>
);

/** these three are one continuous piece (the logo carries through) */
const FINALE: SectionId[] = ['breath', 'swarm', 'live', 'yourMove'];

export type Trailer45Props = { audio: boolean };

export const Trailer45: React.FC<Trailer45Props> = ({ audio }) => {
  const scenes: Partial<Record<SectionId, React.ReactNode>> = {
    hook: <Hook />,
    cast: <CastCards />,
    claim: <Claim />,
    sting: <Sting />,
    build: <Build />,
    fleet: <Fleet />,
    arsenal: <Arsenal />,
    rival: <Rival />,
    silence: <Fire />,
    drop: <Drop />,
    victory: <Victory />,
    economy: <Economy />,
    breath: <AbsoluteFill style={{ background: C.black }} />,
  };
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Shake>
        {(Object.keys(SECTIONS) as SectionId[])
          .filter((id) => !FINALE.includes(id))
          .map((id) => (
            <Sequence key={id} name={id} {...span(id)}>
              {scenes[id] ?? <Placeholder id={id} />}
            </Sequence>
          ))}
        <Sequence name="finale: swarm → live → your move" from={f(SECTIONS.breath[0])}>
          <Finale />
        </Sequence>
      </Shake>
      <Letterbox />
      <Flashes />
      <Vignette />
      <Grain />
      {audio && <Audio src={staticFile('audio/soundtrack.wav')} />}
    </AbsoluteFill>
  );
};
