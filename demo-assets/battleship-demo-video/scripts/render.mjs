// Renders every deliverable into out/.
//
//   node scripts/render.mjs                 # v1 deliverables
//   node scripts/render.mjs --v2            # v2 deliverables (4K + 1080p)
//   node scripts/render.mjs [--v2] --preview  # quick 960×540 check in out/review/
//
// 1. picture: 3840×2160, 60 fps, H.264 CRF 17, yuv420p, BT.709 (Remotion)
// 2. sound:   the same timeline as 48 kHz WAV (Remotion)
// 3. master:  picture copied untouched + AAC 320 kb/s, cut to exactly 15.000 s,
//             fast-start (ffmpeg bundled with Remotion)
// 4. 1080p:   Lanczos downscale of the master, CRF 17, audio copied; muted copy
// 5. end card still: frame 899 as a lossless 4K PNG

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
const build = path.join(out, '.build');
fs.mkdirSync(build, { recursive: true });

const V2 = process.argv.includes('--v2');
const COMP = V2 ? 'EmpireOfBitsDemoV2' : 'EmpireOfBitsDemo';
const tag = V2 ? '-v2' : '';
// 4K frames are heavy; on an 8 GB machine three tabs is the safe ceiling.
const concurrency = process.env.CONCURRENCY ?? String(Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2))));

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
};
const remotion = (args) => run('npx', ['remotion', ...args]);
const ffmpeg = (args) => run('npx', ['remotion', 'ffmpeg', '-hide_banner', '-v', 'error', '-y', ...args]);

if (process.argv.includes('--preview')) {
  fs.mkdirSync(path.join(out, 'review'), { recursive: true });
  remotion(['render', COMP, `out/review/${V2 ? 'v2-' : ''}preview-540p.mp4`, '--scale=0.25', '--crf=20', `--concurrency=${concurrency}`]);
  process.exit(0);
}

const picture = path.join(build, `picture${tag}-4k.mp4`);
const sound = path.join(build, `sound${tag}.wav`);
const master = path.join(out, `empire-of-bits-demo${tag}-4k.mp4`);
const hd = path.join(out, `empire-of-bits-demo${tag}-1080p.mp4`);
const hdMuted = V2 ? null : path.join(out, 'empire-of-bits-demo-1080p-muted.mp4');
const still = V2 ? null : path.join(out, 'empire-of-bits-end-card-4k.png');

// 1. picture
remotion([
  'render', COMP, picture,
  '--muted',
  '--codec=h264',
  '--crf=17',
  '--x264-preset=slow',
  '--pixel-format=yuv420p',
  '--color-space=bt709',
  '--image-format=jpeg',
  '--jpeg-quality=95',
  `--concurrency=${concurrency}`,
]);

// 2. sound
remotion(['render', COMP, sound, '--codec=wav']);

// 3. master: exact 15 s, AAC, moov atom first
ffmpeg([
  '-i', picture,
  '-i', sound,
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'copy',
  '-af', 'atrim=end=15,asetpts=PTS-STARTPTS',
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
  '-t', '15',
  '-movflags', '+faststart',
  master,
]);

// 4. presentation copies from the finished master
ffmpeg([
  '-i', master,
  '-vf', 'scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'copy',
  '-movflags', '+faststart',
  hd,
]);
if (hdMuted) ffmpeg(['-i', hd, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', hdMuted]);

// 5. the end card, lossless (v1)
if (still) remotion(['still', COMP, still, '--frame=899', '--image-format=png']);

console.log(`\nDone. Run \`npm run verify${V2 ? ':v2' : ''}\` to check the deliverables.`);
