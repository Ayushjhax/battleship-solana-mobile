/**
 * Trailer45 — the beat grid. EVERY time in the film is written in BEATS here;
 * frames are derived, so a new song means a new `MUSIC.bpm` + `MUSIC.anchor`
 * (and, if its structure differs, new track beats in `MUSIC_EDIT`).
 *
 * Plain data + pure functions, no imports: scripts/score.py reads this file with
 * `node --experimental-strip-types` to place every sound on the same frames.
 *
 * The track (demo-assets/music/Music.mp3, 180 s, A minor) measures 140.0 BPM
 * (librosa: scripts/analyze_music.py). Its first drop lands at 20.579 s, after
 * a built-in 3-beat gap; its drums enter exactly 8 bars earlier. That shape IS
 * the brief's build → silence → drop, so the film is gridded to the track:
 * 105 beats at 140 BPM = 45.0 s = 1350 frames.
 */

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const MUSIC = {
  /** relative to launch-film/ (read only, never modified) */
  file: '../demo-assets/music/Music.mp3',
  bpm: 140,
  /** source seconds of track beat 0 (the track's first drop, by onset) */
  anchor: 20.5787,
  key: 'A minor',
} as const;

export const BEAT_SEC = 60 / MUSIC.bpm;
/** frame of a (possibly fractional) film beat */
export const f = (beat: number): number => Math.round(beat * BEAT_SEC * FPS);
/** seconds of a film beat */
export const sec = (beat: number): number => beat * BEAT_SEC;

/** [startBeat, endBeat) of every section. */
export const SECTIONS = {
  hook: [0, 1], //       biggest explosion, full bleed, mid-blast on frame 0
  cast: [1, 5], //       four hero cards, one per beat
  claim: [5, 9], //      REAL PLAYERS. / REAL BATTLES.
  sting: [9, 14], //     the bit pings, bursts into the line (sonic logo)
  build: [14, 22], //    track drums enter on 14
  fleet: [22, 30],
  arsenal: [30, 38], //  track hit on 34 = the strongest weapon lands
  rival: [38, 43], //    track kick roll 38–42
  silence: [43, 46], //  letterbox in, FIRE., one click
  drop: [46, 66], //     the battle (65 is a one-beat stop)
  victory: [66, 74], //  track drop 2 = biggest hit of the film
  economy: [74, 82], //  four cards, two beats each
  breath: [82, 83], //   black, silence, letterbox out
  swarm: [83, 91], //    players build the logo; lands on 91
  live: [91, 96], //     logo up, dApp Store badge in
  yourMove: [96, 105], // "Your move." — held to the last frame
} as const satisfies Record<string, readonly [number, number]>;

export type SectionId = keyof typeof SECTIONS;
export const TOTAL_BEATS = 105;
export const DURATION = f(TOTAL_BEATS);

/**
 * The music edit. Film beats [from, to) play the track starting at track beat
 * `track` (0 = MUSIC.anchor, so source seconds = anchor + track * BEAT_SEC).
 * Cuts are on beats and get short crossfades in score.py. Gaps are silence.
 */
export const MUSIC_EDIT = [
  { from: 0, to: 43, track: -46, note: 'intro pad; drums enter on 14; kick roll 38–42' },
  { from: 46, to: 65, track: 0, note: 'drop 1 — the battle' },
  { from: 66, to: 82, track: 156, note: 'drop 2 — VICTORY; fill; hit on 74 = economy' },
  { from: 83, to: 91, track: 284, note: 'last build: kick roll, one-beat gap on 90' },
  { from: 91, to: 105, track: 356, note: 'final chord rings out under the end card' },
] as const;

/**
 * Footage. `src` is a file in public/media (scripts/prepare_media.py); `in` is
 * seconds into that file. `cam` keys are [beat, x, y, zoom] in recording pixels
 * (1280 x 576 for gameplay); zoom 1 = the recording covers the frame.
 */
export type CamKey = readonly [beat: number, x: number, y: number, zoom: number];
export type Shot = {
  readonly src: string;
  readonly from: number; // film beat
  readonly to: number; // film beat
  readonly in: number; // seconds into src at `from`
  readonly rate?: number;
  readonly freezeAt?: number; // film beat after which the picture holds
  /** speed ramps: from film beat `beat`, play from `in` seconds at `rate` */
  readonly ramps?: readonly (readonly [beat: number, inSec: number, rate: number])[];
  readonly cam: readonly CamKey[];
};

export const SHOTS = {
  // HOOK — the Atomic Bomb's fireball, already mid-blast on frame 0
  hook: { src: 'atomic', from: 0, to: 1, in: 1.3, cam: [[0, 925, 296, 2.05], [1, 925, 298, 2.12]] },
  // THE DROP — flash (1.00 s) → fireball → mushroom cloud
  strike: { src: 'atomic', from: 46, to: 49, in: 1.0, cam: [[46, 928, 300, 1.75], [49, 930, 296, 1.9]] },
  // hit marks bloom inside the 3x3 (2.8–3.3 s)
  marks: { src: 'atomic', from: 49, to: 51, in: 2.47, cam: [[49, 930, 318, 1.9], [51, 930, 318, 2.0]] },
  // enemy bomber over your board → AA gun fires (0.71) → downed → "Shot down!" (1.50)
  // speed ramp: the approach at 1.8x, then real time from the moment the gun fires
  defense: {
    src: 'defense', from: 51, to: 55, in: 0.35, rate: 1.8, ramps: [[51.4667, 0.71, 1]],
    cam: [[51, 420, 380, 1.45], [53, 380, 400, 1.6], [55, 372, 402, 1.66]],
  },
  // Bomber armed → released → whip along row A → the bomb lands on beat 59 (2.833 s)
  // speed ramp: armed and released at 1.5x, then real time along row A into the hit
  raid: {
    src: 'raid', from: 55, to: 59, in: 0.8, rate: 1.5, ramps: [[56.5, 1.75, 1]],
    cam: [[55, 330, 300, 1.35], [56.5, 380, 300, 1.4], [57.1, 860, 230, 1.55], [59, 950, 205, 1.7]],
  },
  // split screen, left half: the hit and the sinking (2.97–3.13 s)
  hit: { src: 'raid', from: 59, to: 61, in: 2.833, cam: [[59, 960, 205, 2.1], [61, 962, 208, 2.25]] },
  // SUNK — the wreck, then freeze and push in through the one-beat stop
  sunk: { src: 'raid', from: 61, to: 66, in: 3.1, freezeAt: 62, cam: [[61, 955, 215, 1.7], [66, 960, 212, 2.05]] },
  // VICTORY — the game's own result screen: coins count up, rank bar fills (4.95 → 6.55 s)
  victory: { src: 'raid', from: 68, to: 74, in: 4.95, freezeAt: 71.7, cam: [[68, 640, 288, 1.0], [74, 640, 288, 1.0]] },
  // CLIMB. — the rank bar on the same result screen, filling 125 → 145 / 2000
  climb: { src: 'raid', from: 80, to: 82, in: 5.55, cam: [[80, 655, 338, 2.3], [82, 655, 338, 2.5]] },
} as const satisfies Record<string, Shot>;

/** UI clips shown in glass screens: seconds into public/media/<src>.mp4 */
export const UI_CLIPS = {
  base: { src: 'build', in: 3.05 }, //      board turns green → AA gun placed (source 4.05–4.9 s)
  radar: { src: 'matchmaking', in: 0.75 }, // "Finding an opponent" sweep
  versus: { src: 'matchmaking', in: 2.5 }, // VS → Ayush vs Saad, Ironwater Sound
  buy: { src: 'buy', in: 3.4 }, //           Buy 100 points → purchase complete, 200 → 300
  sell: { src: 'sell', in: 1.3 }, //         Sell 100 points → 300 → 200
  gear: { src: 'store', in: 1.1 }, //        Crimson → Emerald → Purple editions
  climb: { src: 'raid', in: 5.6 }, //        rank bar 125 → 145 / 2000 on the result screen
} as const;

/** Beats (film) where the grid-wipe transition runs — used 3 times at most. */
export const GRID_WIPES = [51, 61, 83] as const;

/** The three biggest hits get the micro-shake; flash frames only on the first and last. */
export const SHAKES = [46, 59, 66] as const;
export const FLASHES = [46, 66] as const;

/** Letterbox: in over the silence, out during the breath. */
export const LETTERBOX = { in: 43, out: 82 } as const;

/**
 * Sound cues, all on the grid. `sfx` names a designed sound (score.py) or a game
 * effect from the game's assets/audio/sfx. Gains in dB.
 */
export type Cue = { readonly beat: number; readonly sfx: string; readonly db?: number; readonly note?: string };

export const CUES: readonly Cue[] = [
  { beat: 0, sfx: 'nuke', db: 2, note: 'hook: the blast' },
  { beat: 0, sfx: 'boom', db: -1, note: 'hook: sub boom from frame 0' },
  { beat: 0, sfx: 'explosion', db: -2 },
  ...[1, 2, 3, 4].map((b) => ({ beat: b, sfx: 'stab', db: -3, note: 'cast card' })),
  { beat: 5, sfx: 'slam', db: -3, note: 'REAL PLAYERS.' },
  { beat: 7, sfx: 'slam', db: -3, note: 'REAL BATTLES.' },
  { beat: 5, sfx: 'riser4', db: -6 },
  { beat: 9, sfx: 'sonic', db: 0, note: 'sonic logo: ping on 9, BOOM on 11' },
  { beat: 14, sfx: 'slam', db: -4, note: 'BUILD YOUR BASE.' },
  { beat: 16, sfx: 'stamp', db: -4 },
  { beat: 18, sfx: 'stamp', db: -4 },
  { beat: 18.5, sfx: 'tick', db: -9 },
  { beat: 19, sfx: 'tick', db: -9 },
  { beat: 19.5, sfx: 'tick', db: -9 },
  { beat: 20, sfx: 'stamp', db: -4 },
  { beat: 20.5, sfx: 'stamp', db: -7 },
  { beat: 22, sfx: 'slam', db: -4, note: 'ASSEMBLE YOUR FLEET.' },
  ...[24, 24.5, 25, 25.5].map((b) => ({ beat: b, sfx: 'whoosh', db: -6, note: 'ship whips in' })),
  { beat: 30, sfx: 'slam', db: -4, note: 'LOAD YOUR ARSENAL.' },
  ...[32, 32.5, 33, 33.25, 33.5, 33.75].map((b, i) => ({ beat: b, sfx: 'metal', db: -10 + i, note: 'carousel tick, rising' })),
  { beat: 34, sfx: 'lock', db: -3, note: 'Atomic Bomber lands' },
  { beat: 38, sfx: 'slam', db: -4, note: 'FIND YOUR RIVAL.' },
  { beat: 40, sfx: 'ping', db: -4, note: 'sonar' },
  { beat: 41.5, sfx: 'stamp', db: -3, note: 'VS punch' },
  { beat: 42, sfx: 'whoosh', db: -8, note: 'facecam slides in' },
  { beat: 42.5, sfx: 'lock', db: -4, note: 'locked in' },
  { beat: 45.4, sfx: 'click', db: -2, note: 'the one click before the drop' },
  { beat: 46, sfx: 'nuke', db: 0, note: 'DROP: flash' },
  { beat: 46, sfx: 'boom', db: -2 },
  { beat: 49.5, sfx: 'pop', db: -8, note: 'facecam' },
  { beat: 50, sfx: 'explosion', db: -3, note: 'HIT.' },
  { beat: 51, sfx: 'wipe', db: -8, note: 'grid wipe: cells land like shots' },
  { beat: 51.85, sfx: 'shot_fire', db: -4, note: 'AA gun fires' },
  { beat: 52.3, sfx: 'plane_down', db: 2 },
  { beat: 53.75, sfx: 'stamp', db: -5, note: '"Shot down!"' },
  { beat: 55, sfx: 'ui_tap', db: -6, note: 'Bomber armed' },
  { beat: 56.5, sfx: 'whoosh', db: -5, note: 'whip-pan' },
  { beat: 57.4, sfx: 'bomb_drop', db: -4 },
  { beat: 59, sfx: 'explosion', db: 0, note: 'HIT (split screen)' },
  { beat: 59, sfx: 'boom', db: -4 },
  { beat: 59.15, sfx: 'ship_sink', db: -2 },
  { beat: 59.5, sfx: 'pop', db: -8, note: 'reaction' },
  { beat: 61, sfx: 'wipe', db: -8 },
  { beat: 61, sfx: 'slam', db: -3, note: 'SUNK.' },
  { beat: 63, sfx: 'pop', db: -8, note: 'facecam' },
  { beat: 66, sfx: 'victory', db: -2, note: 'VICTORY — biggest hit' },
  { beat: 66, sfx: 'boom', db: 0 },
  { beat: 66, sfx: 'slam', db: -2 },
  ...[68, 68.5, 69, 69.5].map((b) => ({ beat: b, sfx: 'pop', db: -10, note: 'bento tile' })),
  { beat: 69.2, sfx: 'coin_flow', db: -8 },
  ...[74, 76, 78, 80].map((b) => ({ beat: b, sfx: 'slam', db: -4, note: 'economy card' })),
  { beat: 80.5, sfx: 'rank_up', db: -8 },
  { beat: 83, sfx: 'riser8', db: -4, note: 'swarm: swelling riser' },
  { beat: 83, sfx: 'wipe', db: -10 },
  { beat: 90, sfx: 'sweep', db: -8, note: 'light sweep locks the logo' },
  { beat: 91, sfx: 'landing', db: 0, note: 'the landing' },
  { beat: 92, sfx: 'pad', db: -6, note: 'warm pad under the end card' },
  { beat: 93, sfx: 'soft', db: -8, note: 'badge settles' },
  { beat: 97, sfx: 'sonic', db: -1, note: 'end: the empty bit pings → BOOM on 99' },
];

/** Where the music ducks (dB) under the key hits; score.py ramps in/out around each. */
export const DUCKS: readonly { readonly beat: number; readonly beats: number; readonly db: number }[] = [
  { beat: 46, beats: 1.5, db: -5 },
  { beat: 50, beats: 1, db: -3 },
  { beat: 59, beats: 1.5, db: -5 },
  { beat: 61, beats: 1, db: -3 },
  { beat: 66, beats: 2, db: -6 },
  { beat: 91, beats: 1.5, db: -4 },
  { beat: 97, beats: 3, db: -5 },
];
