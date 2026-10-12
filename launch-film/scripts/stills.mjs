// Render a set of frames as JPEG stills with one bundle.
//   node scripts/stills.mjs out_dir frame1 frame2 ...     (or --every=N for every N frames)
//   --scale=0.5  --comp=Trailer45
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
const outDir = pos[0] ?? 'build/stills';
fs.mkdirSync(outDir, { recursive: true });
const browserExecutable = process.env.BX ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const inputProps = { audio: false };
const comp = await selectComposition({ serveUrl, id: opt.comp ?? 'Trailer45', inputProps, browserExecutable });
let frames = pos.slice(1).map(Number);
if (opt.every) frames = Array.from({ length: Math.ceil(comp.durationInFrames / Number(opt.every)) }, (_, i) => Math.round(i * Number(opt.every)));
const browser = await openBrowser('chrome', { browserExecutable });
const scale = Number(opt.scale ?? 1);
const conc = Number(opt.conc ?? 3);
let i = 0;
async function worker() {
  while (i < frames.length) {
    const fr = frames[i++];
    await renderStill({ composition: comp, serveUrl, frame: fr, output: path.join(outDir, `f${String(fr).padStart(4, '0')}.jpg`), inputProps, scale, imageFormat: 'jpeg', jpegQuality: 88, puppeteerInstance: browser, browserExecutable });
  }
}
await Promise.all(Array.from({ length: conc }, worker));
await browser.close({ silent: true });
console.log(`rendered ${frames.length} stills → ${outDir}`);
