// Deck30 timeline checks: `node --experimental-strip-types scripts/deck30/check_timeline.mjs`
// anchors on downbeats · sections contiguous · runtime 28–32 s · music edit on bar lines · cues inside the film.
const m = await import('../../src/deck30/timeline.ts');
const errs = [];
const ok = (c, msg) => { if (!c) errs.push(msg); };
const secs = Object.entries(m.SECTIONS);
for (let i = 1; i < secs.length; i++) ok(secs[i][1][0] === secs[i - 1][1][1], `section ${secs[i][0]} does not start where ${secs[i - 1][0]} ends`);
ok(secs[0][1][0] === 0 && secs.at(-1)[1][1] === m.TOTAL_BEATS, 'sections do not span 0..TOTAL_BEATS');
const dur = m.DURATION / m.FPS;
ok(dur >= 28 && dur <= 32, `runtime ${dur.toFixed(2)} s is outside 28–32 s`);
for (const [k, b] of Object.entries(m.ANCHORS)) ok(m.isDownbeat(b), `anchor ${k} (beat ${b}) is not a downbeat`);
for (const e of m.MUSIC_EDIT) ok(((e.from - m.PICKUP - e.track) % 4 + 4) % 4 === 0, `music segment at film ${e.from} is not bar-aligned (track ${e.track})`);
for (const c of m.CUES) ok(c.beat >= 0 && c.beat < m.TOTAL_BEATS, `cue ${c.sfx} at ${c.beat} is outside the film`);
const land = m.SECTIONS.landing[0];
ok((m.TOTAL_BEATS - land) * m.BEAT_SEC >= 1.5, 'the end card holds < 1.5 s');
console.log(`Deck30: ${m.TOTAL_BEATS} beats @ ${m.MUSIC.bpm} BPM = ${m.DURATION} frames = ${dur.toFixed(3)} s; anchors ` +
  Object.entries(m.ANCHORS).map(([k, b]) => `${k} ${b} (f${m.f(b)}, ${(m.f(b) / m.FPS).toFixed(2)} s)`).join(', '));
for (const [k, [a, b]] of secs) console.log(`  ${k.padEnd(8)} beats ${String(a).padStart(2)}–${String(b).padEnd(2)} frames ${String(m.f(a)).padStart(3)}–${String(m.f(b)).padEnd(3)} ${(m.f(a) / m.FPS).toFixed(2)}–${(m.f(b) / m.FPS).toFixed(2)} s`);
if (errs.length) { console.error('FAIL\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('timeline OK');
