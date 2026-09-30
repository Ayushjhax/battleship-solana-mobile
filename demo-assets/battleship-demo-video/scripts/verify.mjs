// Checks the rendered deliverables against the brief.
//
//   node scripts/verify.mjs        # v1 deliverables
//   node scripts/verify.mjs --v2   # v2 deliverables

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => path.join(root, 'out', f);
const V2 = process.argv.includes('--v2');
const tag = V2 ? '-v2' : '';

const tool = (name, args, opts = {}) =>
  execFileSync('npx', ['remotion', name, ...args], { cwd: root, maxBuffer: 1 << 28, ...opts });
const probe = (file) =>
  JSON.parse(
    tool('ffprobe', ['-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', file]).toString(),
  );

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

/** Top-level MP4 boxes in file order. */
function boxes(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.statSync(file).size;
  const order = [];
  let pos = 0;
  const head = Buffer.alloc(16);
  while (pos < size) {
    fs.readSync(fd, head, 0, 16, pos);
    let len = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (len === 1) len = Number(head.readBigUInt64BE(8));
    if (len === 0) len = size - pos;
    order.push(type);
    pos += len;
  }
  fs.closeSync(fd);
  return order;
}

function checkVideo(file, { width, height, audio }) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) return check(`${name} exists`, false);
  const info = probe(file);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const mb = (fs.statSync(file).size / 1e6).toFixed(1);
  check(`${name} exists`, true, `${mb} MB`);
  check(`${name} H.264`, v.codec_name === 'h264', v.codec_name);
  check(`${name} ${width}×${height}`, v.width === width && v.height === height, `${v.width}×${v.height}`);
  check(`${name} 16:9`, v.width * 9 === v.height * 16);
  check(`${name} 60 fps`, v.r_frame_rate === '60/1' && v.avg_frame_rate === '60/1', `${v.r_frame_rate}, avg ${v.avg_frame_rate}`);
  check(`${name} 900 frames`, Number(v.nb_read_frames) === 900, v.nb_read_frames);
  check(`${name} video 15.000 s`, Math.abs(Number(v.duration) - 15) < 0.0005, v.duration);
  check(`${name} container 15.000 s`, Math.abs(Number(info.format.duration) - 15) < 0.0005, info.format.duration);
  check(`${name} yuv420p`, v.pix_fmt === 'yuv420p', v.pix_fmt);
  check(`${name} BT.709 tagged`, v.color_space === 'bt709', `${v.color_space}/${v.color_primaries}/${v.color_transfer}`);
  if (audio) {
    check(`${name} AAC audio`, a?.codec_name === 'aac', a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch ${a.bit_rate} b/s` : 'none');
    check(`${name} audio ≤ 15.000 s`, a && Number(a.duration) <= 15.0005, a?.duration);
  } else {
    check(`${name} no audio track`, !a);
  }
  const order = boxes(file);
  check(`${name} fast start (moov before mdat)`, order.indexOf('moov') < order.indexOf('mdat'), order.join(' '));
}

/** Every frame of a video from `fromSeconds`, as grey 240×135 bytes. */
function greyFramesFrom(file, fromSeconds) {
  const w = 240;
  const h = 135;
  const raw = tool('ffmpeg', [
    '-hide_banner', '-v', 'error',
    '-i', file,
    '-ss', String(fromSeconds),
    '-s', `${w}x${h}`, '-pix_fmt', 'gray',
    '-c:v', 'rawvideo', '-f', 'image2pipe', '-',
  ]);
  const size = w * h;
  const frames = [];
  for (let i = 0; i + size <= raw.length; i += size) frames.push(raw.subarray(i, i + size));
  return frames;
}

console.log('\n— master —');
checkVideo(out(`empire-of-bits-demo${tag}-4k.mp4`), { width: 3840, height: 2160, audio: true });
console.log('\n— presentation copies —');
checkVideo(out(`empire-of-bits-demo${tag}-1080p.mp4`), { width: 1920, height: 1080, audio: true });
if (!V2) checkVideo(out('empire-of-bits-demo-1080p-muted.mp4'), { width: 1920, height: 1080, audio: false });

console.log('\n— frames —');
{
  const master = out(`empire-of-bits-demo${tag}-4k.mp4`);
  // every frame: no black frames anywhere
  const all = greyFramesFrom(master, 0);
  const means = all.map((f) => f.reduce((s, v) => s + v, 0) / f.length);
  const darkest = Math.min(...means);
  check('decoded 900 frames', all.length === 900, String(all.length));
  check('no black frames', darkest > 12, `darkest frame mean ${darkest.toFixed(1)} at ${means.indexOf(darkest)}`);

  // the end card holds still from 780 to 899
  const tail = all.slice(780);
  const last = tail[tail.length - 1];
  let worst = 0;
  let worstAt = 780;
  tail.forEach((f, i) => {
    let d = 0;
    for (let k = 0; k < f.length; k++) d = Math.max(d, Math.abs(f[k] - last[k]));
    if (d > worst) {
      worst = d;
      worstAt = 780 + i;
    }
  });
  check('end card unchanged 780–899', tail.length === 120 && worst <= 6, `max pixel difference ${worst} at frame ${worstAt}`);
}

console.log('\n— end card still —');
if (!V2) {
  const f = out('empire-of-bits-end-card-4k.png');
  if (!fs.existsSync(f)) check('end card PNG exists', false);
  else {
    const b = fs.readFileSync(f);
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    check('end card PNG 3840×2160', w === 3840 && h === 2160, `${w}×${h}, ${(b.length / 1e6).toFixed(1)} MB`);
  }
}

console.log('\n— website —');
{
  const url = fs.readFileSync(path.join(root, 'public/brand/website.txt'), 'utf8').trim();
  const supplied = fs.readFileSync(path.join(root, '..', 'website.txt'), 'utf8').trim();
  check('website.txt copied unchanged', url === supplied, url);
  console.log(`      the end card renders: ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
