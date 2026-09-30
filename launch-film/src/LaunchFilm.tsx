import {Audio} from '@remotion/media';
import React from 'react';
import {AbsoluteFill, Sequence, staticFile} from 'remotion';
import {Grain, Vignette} from './components/Finish';
import {sceneFrames, sceneFrom} from './config/timeline';
import {Arsenal} from './scenes/Arsenal';
import {Battle} from './scenes/Battle';
import {Bento} from './scenes/Bento';
import {Build} from './scenes/Build';
import {ColdOpen} from './scenes/ColdOpen';
import {Economy} from './scenes/Economy';
import {Finale} from './scenes/Finale';
import {Fleet} from './scenes/Fleet';
import {Match} from './scenes/Match';
import {Supercut} from './scenes/Supercut';
import {Title} from './scenes/Title';
import {Victory} from './scenes/Victory';
import {Wallet} from './scenes/Wallet';

/**
 * THE FILM. Scenes sit on the beat grid from src/config/timeline.ts; the soundtrack is the
 * mixed score + sound design (npm run audio). The finish (vignette, grain, a slight contrast
 * lift) sits over everything.
 */
export const LaunchFilm: React.FC<{audio?: boolean; finish?: boolean}> = ({audio = true, finish = true}) => {
  return (
    <AbsoluteFill style={{background: '#000', filter: finish ? 'contrast(1.035)' : undefined}}>
      <Sequence name="Cold open" from={sceneFrom('coldOpen')} durationInFrames={sceneFrames('coldOpen')}>
        <ColdOpen />
      </Sequence>
      <Sequence name="Title" from={sceneFrom('title')} durationInFrames={sceneFrames('title')}>
        <Title />
      </Sequence>
      <Sequence name="Wallet" from={sceneFrom('wallet')} durationInFrames={sceneFrames('wallet')}>
        <Wallet />
      </Sequence>
      <Sequence name="Build your base" from={sceneFrom('build')} durationInFrames={sceneFrames('build')}>
        <Build />
      </Sequence>
      <Sequence name="Meet the fleet" from={sceneFrom('fleet')} durationInFrames={sceneFrames('fleet')}>
        <Fleet />
      </Sequence>
      <Sequence name="Arsenal" from={sceneFrom('arsenal')} durationInFrames={sceneFrames('arsenal')}>
        <Arsenal />
      </Sequence>
      <Sequence name="Find your rival" from={sceneFrom('match')} durationInFrames={sceneFrames('match')}>
        <Match />
      </Sequence>
      <Sequence name="Battle" from={sceneFrom('battle')} durationInFrames={sceneFrames('battle')}>
        <Battle />
      </Sequence>
      <Sequence name="Victory" from={sceneFrom('victory')} durationInFrames={sceneFrames('victory')}>
        <Victory />
      </Sequence>
      <Sequence name="Rhythm run" from={sceneFrom('economy')} durationInFrames={sceneFrames('economy')}>
        <Economy />
      </Sequence>
      <Sequence name="Bento recap" from={sceneFrom('bento')} durationInFrames={sceneFrames('bento')}>
        <Bento />
      </Sequence>
      <Sequence name="Supercut" from={sceneFrom('supercut')} durationInFrames={sceneFrames('supercut')}>
        <Supercut />
      </Sequence>
      <Sequence name="Finale" from={sceneFrom('finale')} durationInFrames={sceneFrames('finale')}>
        <Finale />
      </Sequence>
      {finish ? <Vignette strength={0.45} /> : null}
      {finish ? <Grain amount={0.035} /> : null}
      {audio ? <Audio src={staticFile('audio/mix.wav')} /> : null}
    </AbsoluteFill>
  );
};
