// Copies the supplied assets into public/ and builds the high-quality
// intermediates the composition renders from. Source files are only read.
//
//   node scripts/prepare-media.mjs
//
// Paths to the supplied assets and the game's audio are set in
// scripts/media-sources.json. Uses Remotion's bundled ffmpeg
// (`npx remotion ffmpeg`), so no system ffmpeg is needed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'scripts/media-sources.json'), 'utf8'));
const assetsDir = path.resolve(root, sources.assetsDir);
const gameAudioDir = path.resolve(root, sources.gameAudioDir);
const pub = path.join(root, 'public');

const ffmpeg = (args) =>
  execFileSync('npx', ['remotion', 'ffmpeg', '-hide_banner', '-v', 'error', '-y', ...args], {
    cwd: root,
    stdio: 'inherit',
  });

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const copy = (from, to) => {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  console.log('copy   ', path.relative(root, to));
};

// Lanczos upscale; keeps alpha for PNGs.
const upscalePng = (from, to, factor) => {
  ensureDir(path.dirname(to));
  ffmpeg(['-i', from, '-vf', `scale=iw*${factor}:ih*${factor}:flags=lanczos+accurate_rnd+full_chroma_int`, to]);
  console.log('scale  ', path.relative(root, to), `x${factor}`);
};

// 3x Lanczos proxy of a gameplay recording. Timestamps pass through untouched
// (the recordings are variable frame rate), so trims in src/config.ts refer to
// the same seconds as the originals.
const upscaleVideo = (from, to, factor) => {
  ensureDir(path.dirname(to));
  ffmpeg([
    '-i', from,
    '-an',
    '-vf', `scale=iw*${factor}:ih*${factor}:flags=lanczos+accurate_rnd+full_chroma_int`,
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    to,
  ]);
  console.log('proxy  ', path.relative(root, to), `x${factor}`);
};

// --- gameplay recordings ----------------------------------------------------
for (const name of sources.recordings) {
  const src = path.join(assetsDir, name);
  copy(src, path.join(pub, 'footage/source', name));
  upscaleVideo(src, path.join(pub, 'footage', name.replace(/\.mp4$/, '.3x.mp4')), 3);
}

// The Atomic Bomb is armed and aimed only on arsenal-attack.mp4's first frame;
// scene 1 holds that exact frame, so it is extracted as a still.
ffmpeg([
  '-i', path.join(assetsDir, 'arsenal-attack.mp4'),
  '-frames:v', '1',
  '-vf', 'scale=iw*3:ih*3:flags=lanczos+accurate_rnd+full_chroma_int',
  path.join(pub, 'footage/arsenal-attack.frame0.3x.png'),
]);
console.log('still   public/footage/arsenal-attack.frame0.3x.png');

// --- brand ------------------------------------------------------------------
copy(path.join(assetsDir, 'logo.png'), path.join(pub, 'brand/logo.png'));
copy(path.join(assetsDir, 'solana-badge.png'), path.join(pub, 'brand/solana-badge.png'));
copy(path.join(assetsDir, 'website.txt'), path.join(pub, 'brand/website.txt'));

// --- fleet icons used as caption marks (native size, scaled 2x) -------------
for (const icon of sources.fleetIcons) {
  upscalePng(path.join(assetsDir, 'fleet', icon), path.join(pub, 'fleet', icon), 2);
}

// --- v2: the fleet battleship that crosses the camera, at 2x ----------------
for (const ship of sources.fleetLarge ?? []) {
  upscalePng(path.join(assetsDir, 'fleet', ship), path.join(pub, 'fleet', ship.replace('.png', '@2x.png')), 2);
}

// --- v2: the game's own Victory banner and gull (game repo assets) -----------
const gameAssetsDir = path.resolve(root, sources.gameAssetsDir);
for (const { from, to, scale } of sources.gameArt ?? []) {
  if (scale === 1) copy(path.join(gameAssetsDir, from), path.join(pub, to));
  else upscalePng(path.join(gameAssetsDir, from), path.join(pub, to), scale);
}

// --- Port City: map, buildings and on-map labels at 2x ----------------------
const port = path.join(assetsDir, 'port_city_assets');
upscalePng(
  path.join(port, 'backgrounds_and_reference/port_city_map_background.png'),
  path.join(pub, 'port/map@2x.png'),
  2,
);
for (const f of fs.readdirSync(path.join(port, 'buildings')).filter((f) => f.endsWith('.png'))) {
  upscalePng(path.join(port, 'buildings', f), path.join(pub, 'port/buildings', f.replace('.png', '@2x.png')), 2);
}
for (const f of sources.portUi) {
  upscalePng(path.join(port, 'ui', f), path.join(pub, 'port/ui', f.replace('.png', '@2x.png')), 2);
}

// --- the game's own sound effects and music ---------------------------------
for (const f of sources.sfx) copy(path.join(gameAudioDir, 'sfx', f), path.join(pub, 'audio/sfx', f));
for (const f of sources.music) copy(path.join(gameAudioDir, 'music', f), path.join(pub, 'audio/music', f));

// Two effects are mastered far quieter than the rest (explosion peaks at
// -27 dBFS, plane_down at -17.5 dBFS). Lift them once, losslessly, so every
// volume in src/config.ts stays <= 1.
for (const { file, gainDb } of sources.sfxGain) {
  const out = path.join(pub, 'audio/sfx', file.replace('.mp3', `+${gainDb}db.wav`));
  ffmpeg(['-i', path.join(gameAudioDir, 'sfx', file), '-af', `volume=${gainDb}dB`, '-c:a', 'pcm_s16le', out]);
  console.log('gain   ', path.relative(root, out));
}

// --- Bitter, the game's display face (SIL OFL) ------------------------------
const bitter = path.join(root, 'node_modules/@fontsource/bitter');
for (const w of [600, 700, 800]) {
  copy(path.join(bitter, `files/bitter-latin-${w}-normal.woff2`), path.join(pub, `fonts/bitter-latin-${w}-normal.woff2`));
}
if (fs.existsSync(path.join(bitter, 'LICENSE'))) copy(path.join(bitter, 'LICENSE'), path.join(pub, 'fonts/OFL-Bitter.txt'));

console.log('\nDone. public/ is ready.');
