// ffprobe + loudness report for the delivered master → out/REPORT.md (and stdout).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const F = process.argv[2] ?? 'out/EmpireOfBits_Trailer45_1080p.mp4';
const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', F]).toString());
const v = p.streams.find((s) => s.codec_type === 'video');
const a = p.streams.find((s) => s.codec_type === 'audio');
const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', F, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const sum = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
const num = (re) => Number((sum.match(re) ?? [])[1]);
const I = num(/I:\s+(-?[\d.]+) LUFS/);
const LRA = num(/LRA:\s+(-?[\d.]+) LU/);
const TP = num(/Peak:\s+(-?[\d.]+) dBFS/);
const dur = Number(p.format.duration);
const [fn, fd] = v.r_frame_rate.split('/').map(Number);
const checks = [
  ['Runtime ≤ 50 s (40–50)', `${dur.toFixed(3)} s`, dur <= 50 && dur >= 40],
  ['1920×1080', `${v.width}×${v.height}`, v.width === 1920 && v.height === 1080],
  ['Frame rate', `${(fn / fd).toFixed(3)} fps (${v.nb_frames} frames)`, fn / fd === 30],
  ['Video codec', `${v.codec_name} ${v.profile} ${v.pix_fmt}, ${v.color_space ?? '?'}/${v.color_primaries ?? '?'}/${v.color_transfer ?? '?'}`, v.codec_name === 'h264'],
  ['Audio', `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch ${Math.round(a.bit_rate / 1000)} kb/s`, a.codec_name === 'aac' && Number(a.sample_rate) === 48000 && a.channels === 2],
  ['Integrated loudness −14 LUFS (±0.5)', `${I} LUFS (LRA ${LRA} LU)`, Math.abs(I + 14) <= 0.5],
  ['True peak ≤ −1 dBTP', `${TP} dBTP`, TP <= -1.0],
  ['File size', `${(Number(p.format.size) / 1e6).toFixed(1)} MB`, Number(p.format.size) < 100e6],
];
const md = ['# Trailer45 — delivery report', '', `File: \`${F}\``, '', '| Check | Measured | OK |', '|---|---|---|',
  ...checks.map(([k, m, ok]) => `| ${k} | ${m} | ${ok ? '✅' : '❌'} |`), '', '```', sum.trim(), '```', ''].join('\n');
fs.writeFileSync('out/REPORT.md', md);
console.log(md);
