/**
 * Deck30 — the beat grid. EVERY time in the film is written in BEATS here; frames are derived, so a new song
 * means a new `MUSIC.bpm` + `MUSIC.anchor` (and new track beats in `MUSIC_EDIT` if its structure differs).
 *
 * Plain data + pure functions, no imports: scripts/deck30/score.py reads this file with
 * `node --experimental-strip-types` to place every sound on the same frames as the picture.
 *
 * The song is the trailer's (demo-assets/music/Music.mp3, A minor). librosa measures 139.7 BPM and the kick
 * locks on track beats 0, −8, −16, −24, −32 and +156 of a 140 BPM grid, so the film is gridded at 140: the
 * brief's 120-BPM beat sheet (61 beats, 30.5 s) became 70 beats = 30.0 s = 900 frames. One-beat pickup: the
 * poster holds for beat 0 and film beat 1 is the first downbeat, so downbeats are film beats 1 + 4k.
 */

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const MUSIC = {
  /** relative to launch-film/ (read only, never modified) — the trailer's song */
  file: '../demo-assets/music/Music.mp3',
  bpm: 140,
  /** source seconds of track beat 0: the track's first drop (the trailer's anchor) */
  anchor: 20.5787,
  key: 'A minor',
} as const;

// <music-analysis> written by scripts/deck30/analyze_music.py — do not edit by hand
export const ANALYSIS = { detectedBpm: 139.510, librosaTempo: 139.67, dropOnsetSec: 20.5845, downbeatPhase: 'track beats 0, 4, 8 … (kick on 1)', trackSec: 179.988 } as const;
// </music-analysis>

export const BEAT_SEC = 60 / MUSIC.bpm;
/** frame of a (possibly fractional) film beat */
export const f = (beat: number): number => Math.round(beat * BEAT_SEC * FPS);
/** seconds of a film beat */
export const sec = (beat: number): number => beat * BEAT_SEC;
/** film beat 1 is the first downbeat */
export const PICKUP = 1;
export const isDownbeat = (beat: number): boolean => Number.isInteger(beat) && (beat - PICKUP) % 4 === 0;

/** [startBeat, endBeat) of every section. */
export const SECTIONS = {
  poster: [0, 1], //    frame 0: the explosion frozen at its peak + the logo (the slide before it plays)
  alive: [1, 3], //     ★1 time cracks back on; the logo blows apart into bits
  real: [3, 9], //      strobe on the 8ths: REAL PLAYERS. / REAL BATTLES.
  bit: [9, 17], //      ★2 black; the bit pings (11), BOOMs (13); bits rush into the logo; collapse (16) → glass
  flip: [17, 25], //    ★3 the glass screen lands face-on on 17, 19, 21, 23: base → fleet → arsenal → rival
  fire: [25, 28], //    ★4 the back of the screen is the board; lock-ons 8ths → 16ths → 32nds spell FIRE
  silence: [28, 29], // total silence; the word hangs without its period
  drop: [29, 45], //    ★5 the trailer's drop: the period detonates into the battle; suck-out on 44
  victory: [45, 49], // ★6 VICTORY. as a window; through the O on 48
  economy: [49, 55], // the bento; into the leaderboard on 53, the #1 row on 54
  mitosis: [55, 61], // ★7 1 → 4 → 16 → 64 → 256 on the 8ths; the mosaic sculpts itself; locks on 61
  live: [61, 65], //    logo up, dApp Store in, "Your move."
  landing: [65, 70], // the empty bit pings; the end card holds to the last frame
} as const satisfies Record<string, readonly [number, number]>;

export type SectionId = keyof typeof SECTIONS;
export const TOTAL_BEATS = 70;
export const DURATION = f(TOTAL_BEATS);

/** The six moments that must land on downbeats (checked by scripts/deck30/check_timeline.mjs). */
export const ANCHORS = { alive: 1, boom: 13, drop: 29, victory: 45, lock: 61, ping: 65 } as const;

/**
 * The music edit: the same song cut to fit, on bar lines. Film beats [from, to) play the track from track beat
 * `track` (0 = MUSIC.anchor). Bar-aligned: film downbeats (1 + 4k) sit on track downbeats (4k). score.py puts
 * each segment's measured attack on its frame and joins touching segments with an equal-power crossfade.
 * Gaps are DIGITAL silence.
 */
export const MUSIC_EDIT = [
  { from: 0, to: 5, track: -33, note: 'the pickup (intro pad) → ALIVE on the drums entering (track −32)' },
  {
    from: 5, to: 28, track: -24,
    note: 'one bar skipped under the strobe (cut on the −24 kick); breakdown under the bit; the BOOM on the −16 hit; the build and kick roll under the flips; the built-in gap under FIRE',
  },
  { from: 29, to: 61, track: 0, note: "the trailer's drop: its first 16 beats untouched (suck-out on 44), VICTORY on 16, economy, mitosis" },
  { from: 61, to: 70, track: 356, note: 'the final chord rings out under the end card' },
] as const;

/** Music-only low-pass: the bit floats in a muffled breakdown; the BOOM throws the filter open. */
export const FILTERS = [{ from: 9, to: 13, hz: 360, db: -4, note: 'black: the ping sits clear above a muffled pulse' }] as const;

/** The drop's last beat: music sucked out (filter closes + level falls), then VICTORY slams in on the downbeat. */
export const SUCKOUT = { beat: 44, beats: 1 } as const;

// ------------------------------------------------------------------------------------------------ media

/**
 * Prepared media (scripts/deck30/prepare_media.py → public/deck30/media/<name>.mp4). `start` = the source second
 * the prepared file begins at, so shots below are written in SOURCE seconds (as in deck30/FOOTAGE_LOG.md).
 * Gameplay plates are Real-ESRGAN upscales; cameras still address them in recording pixels (1280 x 576).
 */
export const MEDIA = {
  poster: { file: 'arsenal-attack.mp4', start: 1.3, rec: true },
  atomic: { file: 'arsenal-attack.mp4', start: 0.8, rec: true },
  raid: { file: 'base-attack.mp4', start: 1.25, rec: true },
  victory: { file: 'base-attack.mp4', start: 4.9, rec: true },
  defense: { file: 'defense.mp4', start: 0.2, rec: true },
  build: { file: 'material/buildyourbase.mp4', start: 1.0, rec: false },
  matchmaking: { file: 'material/matchmaking.mp4', start: 0.5, rec: false },
  buy: { file: 'material/buy_points.mp4', start: 3.5, rec: false },
  sell: { file: 'material/sell_points.mp4', start: 1.3, rec: false },
  store: { file: 'material/store.mp4', start: 0.3, rec: false },
  wallet: { file: 'material/wallet_profile.mp4', start: 1.3, rec: false },
} as const;
export type MediaId = keyof typeof MEDIA;

/** cam keys are [beat, x, y, zoom] in recording pixels; zoom 1 = the recording just covers the viewport. */
export type CamKey = readonly [beat: number, x: number, y: number, zoom: number];
export type Shot = {
  readonly src: MediaId;
  readonly from: number; // film beat
  readonly to: number; // film beat
  readonly in: number; // SOURCE seconds at `from`
  readonly rate?: number;
  /** film beat after which the picture holds */
  readonly freezeAt?: number;
  /** speed ramps: from film beat `beat`, play from `in` source seconds at `rate` */
  readonly ramps?: readonly (readonly [beat: number, inSec: number, rate: number])[];
  readonly cam: readonly CamKey[];
};

/**
 * Footage. Positions measured on the recordings (frame differencing): the Atomic fireball at (934, 286), ~150 px
 * wide at 1.40 s; the 3x3 marks burst at (905, 345) at 2.85 s; the AA gun's plane hit at (466, 422) at 1.10 s;
 * the "Shot down!" stamp at (394, 403) from 1.50 s; the last hit at (965, 140), peak 3.067 s.
 * Zoom vs the 1.5x rule: at full frame zoom 1 = 1.875x the recording = 0.94x a 2x plate, so zoom <= 1.6 keeps a
 * 2x plate at <= 1.5x; the poster's 3x plate allows 2.4.
 */
export const SHOTS = {
  // the poster: frame 0 is source 1.40 (the fireball at its fullest), held for the pickup, then plays on
  poster: { src: 'poster', from: 0, to: 3, in: 1.4, cam: [[0, 934, 288, 2.05], [1, 934, 286, 2.08], [3, 930, 268, 2.3]] },
  // THE DROP — the game's own white flash (1.00) → fireball → mushroom, wide: the whole enemy board
  strike: { src: 'atomic', from: 29, to: 31, in: 1.0, cam: [[29, 900, 300, 1.0], [31, 925, 285, 1.18]] },
  // smoke, then the 3x3 marks burst on beat 32 (2.85 s)
  marks: { src: 'atomic', from: 31, to: 33, in: 2.4, cam: [[31, 915, 320, 1.42], [33, 905, 340, 1.58]] },
  // the AA gun: approach at 2x, fires on 33.46, plane hit 34.2, "Shot down!" lands on 35
  defense: {
    src: 'defense', from: 33, to: 36, in: 0.3, rate: 2.06, ramps: [[33.464, 0.71, 1.2], [35, 1.5, 1]],
    cam: [[33, 330, 410, 1.35], [34.2, 420, 410, 1.45], [35, 394, 405, 1.5], [36, 394, 405, 1.58]],
  },
  // split screen, left: the Bomber armed, released, across the enemy board — the impact lands on 40
  run: { src: 'raid', from: 36, to: 40, in: 1.286, cam: [[36, 900, 220, 1.0], [38, 820, 170, 1.05], [40, 950, 150, 1.25]] },
  // the last ship goes down on 40; freeze on the biggest frame (3.067) and push in; sucked out on 44
  last: { src: 'raid', from: 40, to: 45, in: 2.99, freezeAt: 40.16, cam: [[40, 960, 150, 1.35], [41, 964, 143, 1.5], [44, 965, 141, 1.72], [45, 965, 141, 2.3]] },
  // VICTORY. — the result screen inside the letters
  victory: { src: 'victory', from: 45, to: 49, in: 4.9, freezeAt: 48.6, cam: [[45, 640, 500, 1.0], [49, 600, 480, 1.08]] },
} as const satisfies Record<string, Shot>;

/** "REAL PLAYERS. / REAL BATTLES." — the strobe on the 8ths: a player, then a battle hit. */
export type StrobeHit = { readonly kind: 'hit'; readonly src: MediaId; readonly in: number; readonly x: number; readonly y: number; readonly zoom: number };
export type StrobeFace = { readonly kind: 'face'; readonly crop: string };
export const STROBE: readonly (StrobeHit | StrobeFace)[] = [
  { kind: 'face', crop: 'st-hunter' }, //                                         3.0
  { kind: 'hit', src: 'atomic', in: 1.0, x: 930, y: 300, zoom: 1.25 }, //         3.5  the game's white flash
  { kind: 'face', crop: 'st-sofa' }, //                                           4.0
  { kind: 'hit', src: 'defense', in: 1.08, x: 466, y: 418, zoom: 1.6 }, //       4.5  plane hit
  { kind: 'face', crop: 'st-admiral' }, //                                        5.0
  { kind: 'hit', src: 'atomic', in: 2.83, x: 905, y: 340, zoom: 1.6 }, //        5.5  3x3 marks burst
  { kind: 'face', crop: 'st-duo' }, //                                            6.0  REAL BATTLES.
  { kind: 'hit', src: 'defense', in: 1.5, x: 394, y: 405, zoom: 1.5 }, //        6.5  "Shot down!"
  { kind: 'face', crop: 'st-focus' }, //                                          7.0
  { kind: 'hit', src: 'raid', in: 3.02, x: 965, y: 142, zoom: 1.6 }, //          7.5  the last hit
  { kind: 'face', crop: 'st-topdown' }, //                                        8.0
  { kind: 'hit', src: 'atomic', in: 1.66, x: 920, y: 272, zoom: 1.6 }, //        8.5  mushroom cloud
];

/** UI clips in glass: SOURCE seconds at the moment the clip appears. */
export const UI_CLIPS = {
  base: { src: 'build', in: 3.9 }, //         tap AA Gun → green board → AA gun lands (5.0), Points 260 → 250
  fleet: { src: 'build', in: 1.35 }, //       the placement board, 8 ships
  arsenal: { src: 'build', in: 1.6 }, //      the Arsenal panel
  radar: { src: 'matchmaking', in: 0.8 }, //  "Finding an opponent", radar sweep
  versus: { src: 'matchmaking', in: 2.95 }, // the VS slams in; frozen at 3.17, before the name plates
  buy: { src: 'buy', in: 3.82 }, //           counter 200 → 300 at 4.25
  sell: { src: 'sell', in: 1.6 }, //          counter 300 → 200 at 2.0
  store: { src: 'store', in: 0.8 }, //        Crimson → Emerald → Purple
  wallet: { src: 'wallet', in: 1.3 }, //      Captain's wallet, Send tab (address blurred at prep)
} as const;

// ------------------------------------------------------------------------------------------------ finish

/** Flash frames (2 frames, white then accent) and the micro-shake: only the three biggest hits. */
export const FLASHES = [1, 29, 45] as const;
export const SHAKES = [1, 29, 45] as const;
/** Cinema mode: in as FIRE begins, held through the battle and VICTORY, out as we fly through the O. */
export const LETTERBOX = { in: 25, out: 48, outBeats: 1 } as const;
/** The one grid wipe (into the split screen). */
export const GRID_WIPES = [36] as const;

// ------------------------------------------------------------------------------------------------ sound

/**
 * Sound cues, all on the grid. `sfx` names a designed sound (scripts/score.py + scripts/deck30/score.py) or a
 * game effect from the game's assets/audio/sfx. Gains in dB, relative to the sound peak-normalised to -3 dBFS.
 */
export type Cue = { readonly beat: number; readonly sfx: string; readonly db?: number; readonly note?: string };

const EIGHTHS = (a: number, b: number) => Array.from({ length: Math.round((b - a) * 2) }, (_, i) => a + i / 2);

/** lock-on beats for FIRE: 8ths, then 16ths, then 32nds (14 strokes) */
export const LOCKS = [25, 25.5, 26, 26.25, 26.5, 26.75, 27, 27.125, 27.25, 27.375, 27.5, 27.625, 27.75, 27.875] as const;
/** mitosis: 1 → 4 → 16 → 64 → 256 on the 8ths, the 256 landing on the downbeat 57 */
export const DIVISIONS = [55, 55.5, 56, 56.5, 57] as const;
/** bento tiles snap in on the 8ths: LEADERBOARD, BUY, SELL, STORE, WALLET */
export const TILE_BEATS = [49, 49.5, 50, 50.5, 51] as const;

export const CUES: readonly Cue[] = [
  // poster → ALIVE
  { beat: 1, sfx: 'swell', db: -4, note: 'a breath in: reversed explosion tail, ends on the hit' },
  { beat: 1, sfx: 'nuke', db: 0, note: 'ALIVE: the hit' },
  { beat: 1, sfx: 'boom', db: -1, note: 'ALIVE: sub boom' },
  { beat: 1, sfx: 'explosion', db: -3 },
  { beat: 1.15, sfx: 'shatter', db: -5, note: 'granular glass sweep: the logo blows apart' },
  // REAL — ticks on the 8ths, a stab + slam per card, the game's explosion under each battle hit
  ...EIGHTHS(3, 9).map((b) => ({ beat: b, sfx: 'tick', db: -8, note: 'strobe' })),
  { beat: 3, sfx: 'stab', db: -3, note: 'REAL PLAYERS.' },
  { beat: 3, sfx: 'slam', db: -4 },
  { beat: 6, sfx: 'stab', db: -3, note: 'REAL BATTLES.' },
  { beat: 6, sfx: 'slam', db: -4 },
  ...[3.5, 5.5, 8.5].map((b) => ({ beat: b, sfx: 'explosion', db: -9, note: 'strobe hit' })),
  // THE BIT — the sonic logo: ping on 11, BOOM on 13; bits rush in; light sweep; collapse; unfold
  { beat: 11, sfx: 'sonic', db: 0, note: 'sonic logo: ping 11 → BOOM 13' },
  { beat: 13.1, sfx: 'rush', db: -7, note: 'the scattered bits rush back into the logo' },
  { beat: 14, sfx: 'sweep', db: -8, note: 'light sweep across the logo' },
  { beat: 16, sfx: 'collapse', db: -7, note: 'the logo collapses into the bit' },
  { beat: 16.5, sfx: 'unfold', db: -7, note: 'the bit unfolds into the glass screen' },
  // THE FLIP — a whoosh and a glassy tick per landing, a slam per label, metallic ticks for the pieces
  ...[17, 19, 21, 23, 25].map((b) => ({ beat: b, sfx: 'whoosh', db: -7, note: 'flip' })),
  ...[17, 19, 21, 23, 25].map((b) => ({ beat: b, sfx: 'glass', db: -6, note: 'glassy tick: face-on' })),
  ...[17, 19, 21, 23].map((b) => ({ beat: b, sfx: 'slam', db: -6, note: 'flip label' })),
  ...[17.5, 17.75, 18, 18.25, 18.5].map((b) => ({ beat: b, sfx: 'metal', db: -11, note: 'base pieces snap around the glass' })),
  ...[19.5, 19.75, 20, 20.25].map((b) => ({ beat: b, sfx: 'metal', db: -11, note: 'ships rise out of the glass' })),
  ...[21.25, 21.5, 21.75, 21.875].map((b) => ({ beat: b, sfx: 'metal', db: -10, note: 'carousel' })),
  { beat: 22, sfx: 'lock', db: -5, note: 'the Atomic Bomber centred, glowing' },
  { beat: 23.25, sfx: 'ping', db: -6, note: 'radar sweep' },
  { beat: 24, sfx: 'stamp', db: -3, note: 'the VS punch' },
  { beat: 24.5, sfx: 'pop', db: -8, note: 'the rival slides in' },
  { beat: 24.75, sfx: 'lock', db: -6, note: 'locked' },
  // FIRE — a rising digital tick per lock-on (score.py pitches them up along the run)
  ...LOCKS.map((b) => ({ beat: b, sfx: 'dtick', db: -6, note: 'lock-on' })),
  // THE DROP
  { beat: 29, sfx: 'nuke', db: 0, note: 'DROP: the period detonates → the strike' },
  { beat: 29, sfx: 'boom', db: -1 },
  { beat: 29, sfx: 'slam', db: -4, note: 'the period lands' },
  { beat: 30, sfx: 'slam', db: -4, note: 'HIT.' },
  { beat: 30, sfx: 'explosion', db: -4 },
  { beat: 32, sfx: 'explosion', db: -2, note: 'the 3x3 marks burst' },
  { beat: 32, sfx: 'pop', db: -8, note: 'facecam: crew' },
  { beat: 33.464, sfx: 'shot_fire', db: -3, note: 'the AA gun fires (on its frame)' },
  { beat: 34.22, sfx: 'plane_down', db: 0, note: 'plane hit' },
  { beat: 35, sfx: 'stamp', db: -3, note: '"Shot down!"' },
  { beat: 35, sfx: 'pop', db: -8, note: 'facecam: captain' },
  { beat: 36, sfx: 'wipe', db: -8, note: 'the grid wipe into the split screen' },
  { beat: 37.2, sfx: 'whoosh', db: -9, note: 'Bomber released (source 1.80)' },
  { beat: 38.5, sfx: 'bomb_drop', db: -4, note: 'whistle → impact on 40' },
  { beat: 40, sfx: 'explosion', db: 0, note: 'the last ship goes down' },
  { beat: 40, sfx: 'boom', db: -3 },
  { beat: 40.15, sfx: 'ship_sink', db: -3 },
  { beat: 41, sfx: 'slam', db: -3, note: 'SUNK.' },
  { beat: 44, sfx: 'suck', db: -5, note: 'suck-out into VICTORY' },
  // VICTORY — the biggest hit of the film
  { beat: 45, sfx: 'victory', db: -2, note: 'VICTORY.' },
  { beat: 45, sfx: 'boom', db: 0 },
  { beat: 45, sfx: 'slam', db: -3 },
  { beat: 45.5, sfx: 'sweep', db: -9, note: 'light sweep through the letters' },
  { beat: 48, sfx: 'openwhoosh', db: -5, note: 'through the O, opening up' },
  // ECONOMY
  ...TILE_BEATS.map((b) => ({ beat: b, sfx: 'tile', db: -9, note: 'bento tile' })),
  { beat: 50.4, sfx: 'coin_flow', db: -12, note: 'points counter' },
  { beat: 53, sfx: 'whoosh', db: -6, note: 'into the leaderboard' },
  { beat: 54, sfx: 'stamp', db: -6, note: 'the #1 row' },
  // ONE BECOMES ALL
  { beat: 55, sfx: 'collapse', db: -8, note: 'the #1 highlight collapses into the bit' },
  { beat: 55, sfx: 'riser6', db: -7, note: 'the stepped riser, 55 → 61' },
  ...DIVISIONS.map((b) => ({ beat: b, sfx: 'step', db: -6, note: 'division (pitched step)' })),
  { beat: 59, sfx: 'scatter', db: -9, note: 'tiles outside the logo fall away' },
  { beat: 61, sfx: 'landing', db: -1, note: 'the lock' },
  // LIVE + LANDING
  { beat: 61, sfx: 'pad', db: -7, note: 'warm pad to the last frame' },
  { beat: 62.5, sfx: 'soft', db: -9, note: 'the dApp Store badge settles' },
  { beat: 63, sfx: 'tick', db: -12, note: '"Your move."' },
  { beat: 65, sfx: 'sonic', db: -2, note: 'the empty bit pings → BOOM on 67; the tail rings out' },
];

/** Where the music ducks (dB) under the key hits; score.py ramps in/out around each. */
export const DUCKS: readonly { readonly beat: number; readonly beats: number; readonly db: number }[] = [
  { beat: 1, beats: 1.5, db: -5 },
  { beat: 11, beats: 3, db: -4 },
  { beat: 29, beats: 1.5, db: -5 },
  { beat: 40, beats: 1.5, db: -4 },
  { beat: 45, beats: 2, db: -6 },
  { beat: 61, beats: 1.5, db: -4 },
  { beat: 65, beats: 3, db: -5 },
];
