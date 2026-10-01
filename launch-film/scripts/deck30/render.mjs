// Deck30 renders (from launch-film/).
//   node scripts/deck30/render.mjs --draft [out]  → a 960x540 review copy with the soundtrack (default build/deck30/draft.mp4)
//   node scripts/deck30/render.mjs                → the master and everything delivered with it, in out/deck30/:
//        EmpireOfBits_Deck30_1080p.mp4       1920x1080 H.264 CRF 16 BT.709 (video copied untouched) + the score WAV
//                                            through a two-pass loudnorm −14 LUFS / −1 dBTP as AAC 320k 48 kHz stereo, +faststart
//        EmpireOfBits_Deck30_1080p_deck.mp4  two-pass H.264 High@4.1, ≤ 25 MB (35 MB if the grain needs it), +faststart
//        poster_frame0.png, endcard.png      exactly the first and the last frame (lossless, from the composition)
//        thumbnail_1280x720.jpg              from the poster frame
//        REPORT.md                           ffprobe + loudness (scripts/deck30/report.mjs)
// The soundtrack is public/deck30/audio/soundtrack.wav (npm run deck30:score). Uses the preinstalled Chromium
// headless shell (set BX to override) because Remotion's own browser download may be blocked.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const BX = process.env.BX ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const conc = process.env.CONCURRENCY ?? '4';
const OUT = 'out/deck30';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync('build/deck30', { recursive: true });

const run = (cmd, a, opts = {}) => {
  console.log(`$ ${cmd} ${a.join(' ')}`);
  const r = spawnSync(cmd, a, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const probeDur = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim());

// Picture only: Remotion's AAC carries 2048 samples of encoder priming without an edit list, which plays the whole
// soundtrack 42.7 ms late. The score WAV is muxed in by ffmpeg instead (frame-accurate, and encoded only once).
const WAV = 'public/deck30/audio/soundtrack.wav';
const target = draft ? (args.find((a) => !a.startsWith('--')) ?? 'build/deck30/draft.mp4') : null;
const raw = draft ? 'build/deck30/draft_picture.mp4' : 'build/deck30/master_raw.mp4';
run('npx', [
  'remotion', 'render', 'Deck30', raw, '--muted',
  '--codec=h264', `--crf=${draft ? 22 : 16}`, '--color-space=bt709', '--pixel-format=yuv420p',
  ...(draft ? ['--scale=0.5'] : []),
  `--browser-executable=${BX}`, `--concurrency=${conc}`, '--log=error',
]);
if (draft) {
  run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-i', WAV, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', target]);
  fs.rmSync(raw);
  process.exit(0);
}

// ---- master: two-pass loudnorm (−14 LUFS integrated, −1 dBTP); the video stream is copied untouched
const FINAL = `${OUT}/EmpireOfBits_Deck30_1080p.mp4`;
const stats = (() => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', WAV, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/\{[\s\S]*?\}/g);
  return JSON.parse(m[m.length - 1]);
})();
const ln = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`;
run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-i', WAV, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', `${ln},aresample=48000`,
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', FINAL]);

// ---- the deck file: two-pass H.264 High@4.1 to a size budget (25 MB, or 35 MB when the grain needs it)
const dur = probeDur(FINAL);
const deck = `${OUT}/EmpireOfBits_Deck30_1080p_deck.mp4`;
const deckAt = (mb) => {
  const kbps = Math.floor((mb * 8 * 1000 * 0.985) / dur - 320); // leave the AAC 320k + container overhead
  const common = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
    '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.6)}k`, '-bufsize', `${kbps * 2}k`, '-tune', 'grain',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-x264-params', 'keyint=60:min-keyint=30'];
  run('ffmpeg', ['-v', 'error', '-y', '-i', FINAL, ...common, '-pass', '1', '-passlogfile', 'build/deck30/x264', '-an', '-f', 'mp4', '/dev/null']);
  run('ffmpeg', ['-v', 'error', '-y', '-i', FINAL, ...common, '-pass', '2', '-passlogfile', 'build/deck30/x264',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', deck]);
  return fs.statSync(deck).size / 1e6;
};
const budget = Number(process.env.DECK_MB ?? 24.5);
const size = deckAt(budget);
console.log(`deck file: ${size.toFixed(2)} MB at a ${budget} MB budget`);

// ---- exactly the first and the last frame (lossless, straight from the composition) + the thumbnail
run('node', ['scripts/deck30/stills.mjs', 'build/deck30/ends', '0', '899', '--png']);
fs.copyFileSync('build/deck30/ends/f0000.png', `${OUT}/poster_frame0.png`);
fs.copyFileSync('build/deck30/ends/f0899.png', `${OUT}/endcard.png`);
run('ffmpeg', ['-v', 'error', '-y', '-i', `${OUT}/poster_frame0.png`, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', `${OUT}/thumbnail_1280x720.jpg`]);
fs.rmSync(raw);
run('node', ['scripts/deck30/report.mjs']);
