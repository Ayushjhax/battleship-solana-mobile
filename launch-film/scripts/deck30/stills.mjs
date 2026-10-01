// Deck30 stills: render frames of a composition (default Deck30) with one bundle. Copy of scripts/stills.mjs plus --png.
//   node scripts/deck30/stills.mjs out_dir frame1 frame2 ...     (or --every=N for every N frames)
//   --scale=0.5  --comp=Deck30  --png (lossless)
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
const outDir = pos[0] ?? 'build/deck30/stills';
fs.mkdirSync(outDir, { recursive: true });
const browserExecutable = process.env.BX ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const inputProps = { audio: false };
const comp = await selectComposition({ serveUrl, id: opt.comp ?? 'Deck30', inputProps, browserExecutable });
let frames = pos.slice(1).map(Number);
if (opt.every) frames = Array.from({ length: Math.ceil(comp.durationInFrames / Number(opt.every)) }, (_, i) => Math.round(i * Number(opt.every)));
const browser = await openBrowser('chrome', { browserExecutable });
const scale = Number(opt.scale ?? 1);
const conc = Number(opt.conc ?? 3);
let i = 0;
async function worker() {
  while (i < frames.length) {
    const fr = frames[i++];
    await renderStill({ composition: comp, serveUrl, frame: fr, output: path.join(outDir, `f${String(fr).padStart(4, '0')}.${opt.png !== undefined ? 'png' : 'jpg'}`), inputProps, scale, imageFormat: opt.png !== undefined ? 'png' : 'jpeg', jpegQuality: 92, puppeteerInstance: browser, browserExecutable });
  }
}
await Promise.all(Array.from({ length: conc }, worker));
await browser.close({ silent: true });
console.log(`rendered ${frames.length} stills → ${outDir}`);
