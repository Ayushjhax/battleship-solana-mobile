// Trailer45 renders.
//   npm run draft            → out/draft.mp4 (960x540, CRF 23) — fast review copy
//   npm run render           → the master: 1080p H.264 CRF 16 BT.709, then a two-pass
//                               loudnorm to -14 LUFS / -1 dBTP remuxed as AAC 320k 48 kHz,
//                               poster, thumbnail and the ffprobe + loudness report.
// Uses the preinstalled Chromium (set BX to override) because Remotion's own download host may be blocked.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const draft = process.argv.includes('--draft');
const BX = process.env.BX ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const conc = process.env.CONCURRENCY ?? '4';
fs.mkdirSync('out', { recursive: true });

const run = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const raw = draft ? 'out/draft.mp4' : 'out/.master_raw.mp4';
run('npx', [
  'remotion', 'render', 'Trailer45', raw,
  '--codec=h264', `--crf=${draft ? 23 : 16}`, '--color-space=bt709', '--pixel-format=yuv420p',
  ...(draft ? ['--scale=0.5'] : []),
  '--audio-codec=aac', '--audio-bitrate=320k',
  `--browser-executable=${BX}`, `--concurrency=${conc}`, '--log=error',
]);
if (draft) process.exit(0);

// ---- master: two-pass loudnorm (-14 LUFS integrated, -1 dBTP), video stream copied untouched
const FINAL = 'out/EmpireOfBits_Trailer45_1080p.mp4';
const stats = (() => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/\{[\s\S]*?\}/g);
  return JSON.parse(m[m.length - 1]);
})();
const ln = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`;
run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', `${ln},aresample=48000`, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', FINAL]);
fs.rmSync(raw);

// ---- poster + thumbnail from the best hook frame (frame 3: the fireball at its fullest)
run('ffmpeg', ['-v', 'error', '-y', '-ss', '0.1', '-i', FINAL, '-frames:v', '1', '-q:v', '2', 'out/poster.jpg']);
run('ffmpeg', ['-v', 'error', '-y', '-i', 'out/poster.jpg', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', 'out/thumbnail_1280x720.jpg']);
run('node', ['scripts/report.mjs']);
