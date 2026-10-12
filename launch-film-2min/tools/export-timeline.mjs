// Exports src/config/timeline.ts to build/timeline.json for the Python audio build.
// Run: node --experimental-strip-types tools/export-timeline.mjs
import {writeFileSync, mkdirSync} from 'node:fs';
import * as T from '../src/config/timeline.ts';

const out = {
  fps: T.FPS,
  bpm: T.BPM,
  beatOffset: T.BEAT_OFFSET,
  musicFile: T.MUSIC_FILE,
  totalBeats: T.TOTAL_BEATS,
  durationInFrames: T.DURATION_IN_FRAMES,
  scenes: T.SCENES,
  cues: T.SFX_CUES ?? [],

};
mkdirSync(new URL('../build/', import.meta.url), {recursive: true});
writeFileSync(new URL('../build/timeline.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`timeline: ${out.totalBeats} beats, ${out.durationInFrames} frames (${(out.durationInFrames / out.fps).toFixed(2)} s), ${out.cues.length} cues`);
