/** All fonts load locally from public/fonts: nothing depends on the network at render time. */
import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';
import {FONT} from '../theme';

export const fontsReady = Promise.all([
  loadFont({family: FONT.head, url: staticFile('fonts/inter-tight-latin-wght-normal.woff2'), weight: '100 900'}),
  loadFont({family: FONT.label, url: staticFile('fonts/inter-latin-wght-normal.woff2'), weight: '100 900'}),
  loadFont({family: FONT.game, url: staticFile('fonts/bitter-latin-600-normal.woff2'), weight: '600'}),
  loadFont({family: FONT.game, url: staticFile('fonts/bitter-latin-700-normal.woff2'), weight: '700'}),
  loadFont({family: FONT.game, url: staticFile('fonts/bitter-latin-800-normal.woff2'), weight: '800'}),
]);
