// Deck30 — ffprobe + loudness report of the delivered files → out/deck30/REPORT.md (and stdout).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'out/deck30';
const files = [`${OUT}/EmpireOfBits_Deck30_1080p.mp4`, `${OUT}/EmpireOfBits_Deck30_1080p_deck.mp4`];
const probe = (F) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', F]).toString());
const loud = (F) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', F, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const sum = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => Number((sum.match(re) ?? [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/), sum: sum.trim() };
};
const md = ['# Deck30 — delivery report', ''];
let allOk = true;
for (const F of files) {
  if (!fs.existsSync(F)) continue;
  const p = probe(F);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const L = loud(F);
  const dur = Number(p.format.duration);
  const [fn, fd] = v.r_frame_rate.split('/').map(Number);
  const mb = Number(p.format.size) / 1e6;
  const deck = F.includes('_deck');
  // +faststart: the moov atom comes before mdat
  const head = fs.readFileSync(F).subarray(0, 64 * 1024).toString('latin1');
  const faststart = head.indexOf('moov') >= 0 && (head.indexOf('mdat') < 0 || head.indexOf('moov') < head.indexOf('mdat'));
  const checks = [
    ['Runtime ≤ 32 s (28–32)', `${dur.toFixed(3)} s (${v.nb_frames} frames)`, dur <= 32 && dur >= 28],
    ['1920×1080', `${v.width}×${v.height}`, v.width === 1920 && v.height === 1080],
    ['Frame rate (the trailer\'s 30 fps)', `${(fn / fd).toFixed(3)} fps`, fn / fd === 30],
    ['Video', `${v.codec_name} ${v.profile}${v.level ? ` L${v.level / 10}` : ''} ${v.pix_fmt}, ${v.color_space ?? '?'}/${v.color_primaries ?? '?'}/${v.color_transfer ?? '?'}, ${Math.round(Number(v.bit_rate) / 1000)} kb/s`,
      v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && (!deck || (v.profile === 'High' && v.level <= 41))],
    ['Audio AAC 320k 48 kHz stereo', `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch ${Math.round(a.bit_rate / 1000)} kb/s`,
      a.codec_name === 'aac' && Number(a.sample_rate) === 48000 && a.channels === 2 && Number(a.bit_rate) >= 300e3],
    ['Integrated loudness −14 LUFS (±0.5)', `${L.I} LUFS (LRA ${L.LRA} LU)`, Math.abs(L.I + 14) <= 0.5],
    ['True peak ≤ −1 dBTP', `${L.TP} dBTP`, L.TP <= -1.0],
    ['Fast start (moov first)', faststart ? 'yes' : 'no', faststart],
    [deck ? 'File size ≤ 25 MB (deck)' : 'File size < 100 MB (git)', `${mb.toFixed(2)} MB`, deck ? mb <= 25 : mb < 100],
  ];
  allOk &&= checks.every((c) => c[2]);
  md.push(`## \`${F.split('/').pop()}\``, '', '| Check | Measured | OK |', '|---|---|---|', ...checks.map(([k, m, ok]) => `| ${k} | ${m} | ${ok ? '✅' : '❌'} |`), '',
    '```', L.sum, '```', '');
}
for (const f of ['poster_frame0.png', 'endcard.png', 'thumbnail_1280x720.jpg', 'deck30-music.wav']) {
  const p = `${OUT}/${f}`;
  if (fs.existsSync(p)) {
    const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p]).toString());
    const st = s.streams[0];
    md.push(`- \`${f}\`: ${st.width ? `${st.width}×${st.height}` : `${st.sample_rate} Hz ${st.channels} ch ${st.codec_name}, ${Number(s.format.duration).toFixed(3)} s`}, ${(Number(s.format.size) / 1e6).toFixed(2)} MB`);
  }
}
md.push('', allOk ? 'All checks pass.' : 'SOME CHECKS FAIL — see ❌ above.', '');
fs.writeFileSync(`${OUT}/REPORT.md`, md.join('\n'));
console.log(md.join('\n'));
