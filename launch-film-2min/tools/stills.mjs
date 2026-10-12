// Render many stills from one bundle.
// node tools/stills.mjs <outDir> <scale> <frame|a-b/step> [...]
//   e.g. node tools/stills.mjs build/stills 0.5 200 300 400-900/15
// Env: FINISH=0 disables grain/vignette, CONCURRENCY=n parallel tabs (default 3).
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition, openBrowser} from '@remotion/renderer';
import {mkdirSync, existsSync} from 'node:fs';
import path from 'node:path';

const [outDir, scaleArg, ...specs] = process.argv.slice(2);
const scale = Number(scaleArg || 0.5);
const frames = [];
for (const s of specs) {
  const m = s.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (m) for (let i = +m[1]; i <= +m[2]; i += +(m[3] || 1)) frames.push(i);
  else frames.push(+s);
}
mkdirSync(outDir, {recursive: true});
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PRE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browserExecutable = existsSync(PRE) ? PRE : null;
const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public')});
const inputProps = {audio: false, finish: process.env.FINISH !== '0'};
const browser = await openBrowser('chrome', {browserExecutable, chromiumOptions: {gl: 'angle'}});
const composition = await selectComposition({serveUrl, id: process.env.COMP || 'LaunchFilm', inputProps, puppeteerInstance: browser, browserExecutable});
const conc = Number(process.env.CONCURRENCY || 3);
let next = 0;
const t0 = Date.now();
async function worker() {
  while (next < frames.length) {
    const fr = frames[next++];
    const out = path.join(outDir, `f${String(fr).padStart(4, '0')}.jpg`);
    await renderStill({composition, serveUrl, frame: fr, output: out, scale, imageFormat: 'jpeg', jpegQuality: 90, inputProps, puppeteerInstance: browser, browserExecutable, timeoutInMilliseconds: 120000});
    process.stdout.write(`${fr} `);
  }
}
await Promise.all(Array.from({length: conc}, worker));
await browser.close({silent: true});
console.log(`\n${frames.length} stills in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outDir}`);
