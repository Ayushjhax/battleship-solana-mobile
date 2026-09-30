/** Every font is local (public/fonts, SIL OFL). */
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const fontsReady = Promise.all([
  loadFont({ family: 'Anton', url: staticFile('fonts/anton-latin-400-normal.woff2'), weight: '400' }),
  loadFont({ family: 'Inter Tight', url: staticFile('fonts/inter-tight-latin-wght-normal.woff2'), weight: '100 900' }),
  loadFont({ family: 'Bitter', url: staticFile('fonts/bitter-latin-600-normal.woff2'), weight: '600' }),
  loadFont({ family: 'Bitter', url: staticFile('fonts/bitter-latin-700-normal.woff2'), weight: '700' }),
  loadFont({ family: 'Bitter', url: staticFile('fonts/bitter-latin-800-normal.woff2'), weight: '800' }),
]);
