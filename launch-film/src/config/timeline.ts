/**
 * THE TIMELINE. Every cut, word and cue in the film is placed in musical beats.
 * Frames are derived from BPM + BEAT_OFFSET, so a new song means changing only
 * those two numbers (and `MUSIC_FILE`), then `npm run audio` and a re-render.
 *
 * Beat 0 is the first frame of the film. 120 BPM at 30 fps = 15 frames a beat,
 * 60 frames a bar. Scene starts are absolute beats; everything inside a scene
 * is in beats relative to that scene's start.
 *
 * Clip in/out points are in SOURCE seconds (the original recordings in
 * demo-assets/). `CLIPS[..].fileOffset` maps them to the prepared files in
 * public/media/, which may start later than the source.
 *
 * Plain erasable TypeScript only (no enums): tools/export-timeline.mjs imports this
 * file with Node's --experimental-strip-types to hand cue times to the audio build.
 */

export const FPS = 30;
export const WIDTH = 3840;
export const HEIGHT = 2160;

/** Detected with librosa on the rendered score by tools/beats.py → build/beats.json:
 *  120.00 BPM, first beat at −0.007 s (under one frame → 0). The game's battle theme is itself
 *  119.99 BPM; the menu theme (106.61 BPM) is time-stretched onto the grid. */
export const BPM = 120;
/** Seconds into the music file where beat 0 falls. */
export const BEAT_OFFSET = 0;
/** The game's own music, arranged to this grid by audio/score_game.py (audio/score.py is the synth alternative). */
export const MUSIC_FILE = 'audio/score_game.wav';

export const FRAMES_PER_BEAT = (FPS * 60) / BPM;
/** Absolute (or relative) beats → frames. Rounds to the nearest frame. */
export const f = (beats: number): number => Math.round(beats * FRAMES_PER_BEAT);
/** Seconds of source footage → frames. */
export const sec = (s: number): number => Math.round(s * FPS);
/** Where a beat sits in the music file (seconds). */
export const beatToMusicSec = (beats: number): number => BEAT_OFFSET + (beats * 60) / BPM;

// ─── Scenes ──────────────────────────────────────────────────────────────────
// start = absolute beat, beats = length. 228 beats = 114 s = 1:54.
export const SCENES = {
  coldOpen: {start: 0, beats: 16}, //   0:00  the bit
  title: {start: 16, beats: 12}, //     0:08  first hit, title
  wallet: {start: 28, beats: 8}, //     0:14  connect
  build: {start: 36, beats: 24}, //     0:18  build your base
  fleet: {start: 60, beats: 12}, //     0:30  meet the fleet
  arsenal: {start: 72, beats: 12}, //   0:36  arsenal carousel
  match: {start: 84, beats: 8}, //      0:42  find your rival
  battle: {start: 92, beats: 56}, //    0:46  THE DROP
  victory: {start: 148, beats: 12}, //  1:14  victory
  economy: {start: 160, beats: 24}, //  1:20  rhythm run
  bento: {start: 184, beats: 12}, //    1:32  recap grid
  supercut: {start: 196, beats: 12}, // 1:38  one-beat cuts
  finale: {start: 208, beats: 20}, //   1:44  one more thing
} as const;

export type SceneName = keyof typeof SCENES;
export const TOTAL_BEATS = SCENES.finale.start + SCENES.finale.beats;
export const DURATION_IN_FRAMES = f(TOTAL_BEATS);
export const sceneFrom = (s: SceneName) => f(SCENES[s].start);
export const sceneFrames = (s: SceneName) => f(SCENES[s].beats);

// ─── Source clips ────────────────────────────────────────────────────────────
// file: prepared in public/media by tools/prep-media.sh (CFR 30, H.264, 1 s GOP).
// fileOffset: source second at which the prepared file starts.
export const CLIPS = {
  arsenal: {file: 'media/arsenal_x4.mp4', fileOffset: 0, w: 5120, h: 2304, dur: 3.33},
  defense: {file: 'media/defense_x4.mp4', fileOffset: 0, w: 5120, h: 2304, dur: 2.73},
  base: {file: 'media/base_x4.mp4', fileOffset: 1.5, w: 5120, h: 2304, dur: 6.57},
  build: {file: 'media/buildyourbase.mp4', fileOffset: 0, w: 2670, h: 1200, dur: 8.39},
  wallet: {file: 'media/wallet.mp4', fileOffset: 0.5, w: 2670, h: 1200, dur: 3.97},
  match: {file: 'media/matchmaking.mp4', fileOffset: 0, w: 2670, h: 1200, dur: 4.01},
  buy: {file: 'media/buy_points.mp4', fileOffset: 0, w: 2670, h: 1200, dur: 5.03},
  sell: {file: 'media/sell_points.mp4', fileOffset: 0, w: 2670, h: 1200, dur: 3.04},
  store: {file: 'media/store.mp4', fileOffset: 0, w: 2670, h: 1200, dur: 3.04},
} as const;
export type ClipName = keyof typeof CLIPS;

/** Stills pulled from the recordings (held frames). */
export const STILLS = {
  arsenalStart: 'media/stills/arsenal_000.jpg', // both boards, target square lit
  leaderboard: 'media/stills/leaderboard.jpg', // #1 Ayush · 34 · 1175
  baseAim: 'media/stills/base_aim.jpg', // "Bomber — release to fire"
  victoryEnd: 'media/stills/victory_end.jpg', // Points gained +24
} as const;

/** Moments inside the recordings, in SOURCE seconds (FOOTAGE_LOG.md). */
export const EVENTS = {
  // measured frame-accurately in the prepared 30 fps files (tools/measure_events.py)
  arsenal: {planeLaunch: 0.1, flash: 1.033, fireball: 1.2, mushroom: 1.6, smoke: 2.2, fireMarks: 2.87},
  defense: {planeIn: 0.2, planeHit: 1.1, shotDown: 1.5},
  base: {planeIn: 1.8, lastHit: 2.967, victoryCut: 4.967, pointsCount: 5.6},
  build: {placement: 1.233, aaTap: 4.1, aaPlaced: 5.1, mineTap: 6.37, minePlaced: 7.5},
  wallet: {activityTab: 1.8}, // prepared-file frame 39 (measured), source 0.5 + 1.3
  match: {finding: 0.77, vs: 3.0, arena: 3.6},
  buy: {counter: 4.267},
  sell: {counter: 1.9},
  store: {emerald: 1.57, purple: 2.33},
} as const;

/**
 * A footage shot: `at` (beats, scene-relative) plays `clip` from source second `from`
 * at `rate`. `anchor` pins a source event to a beat instead: the shot's `from` is
 * then derived so that the event lands exactly on `anchorBeat`.
 */
export type Shot = {
  clip: ClipName;
  at: number;
  beats: number;
  from: number;
  rate?: number;
};

/** Build a shot whose source event `event` lands on scene beat `onBeat`. */
export const anchored = (
  clip: ClipName,
  event: number,
  onBeat: number,
  at: number,
  beats: number,
  rate = 1,
): Shot => ({clip, at, beats, rate, from: event - ((onBeat - at) * 60 * rate) / BPM});

// ─── Shots and beats per scene (scene-relative beats) ────────────────────────

export const COLD_OPEN = {
  pixelIn: 2, // the bit fades up
  ping1: 4, // first sonar ping, the grid draws in
  line1In: 5, // "Every empire"
  line1Out: 9,
  /** 3-frame flashes of battle between the words (the last two tease the hit) */
  flashes: [9.5, 14.5, 15],
  line2In: 10, // "starts with a single bit."
  pixelToPeriod: 11.5, // the pixel settles as the period
  ping2: 13, // it pings from the period
  cut: 16,
  flashFrames: 3,
} as const;

export const TITLE = {
  // Hard cut on the hit: the atomic strike, full-bleed.
  hit: anchored('arsenal', EVENTS.arsenal.flash, 0, 0, 12),
  dim: 2.75, // plate dims and blurs
  titleIn: 3.25, // "Empire of Bits" mask reveal
  sweep: 5.25, // light sweep across the title
  subIn: 4.75, // "Ocean Warfare"
  taglineIn: 7.75, // "Command the sea."
  out: 11.4,
} as const;

export const WALLET = {
  screen: anchored('wallet', EVENTS.wallet.activityTab, 1, 0, 8),
  word1: 1, // "Connect."
  word2: 3, // "You're in."
  callout: 3.5,
} as const;

export const BUILD = {
  // the recording's own cut from the menu to placement lands on beat 1
  screen: anchored('build', EVENTS.build.placement, 1, 0, 16),
  headline: 1.5, // "Build your base."
  headlineOut: 6.5,
  macroIn: 7, // punch into the arsenal panel / board
  aaCallout: 0, // derived below: when the AA gun lands
  cards: 16, // defence cards fly in
  line2: 17, // "Position is everything."
} as const;

export const FLEET = {
  headline: 0.25, // "Meet the fleet."
  ships: [0.25, 1, 2, 3], // one hull per beat (the first lands with the cut)
  stat: 8, // "8 ships." (the rest of the fleet joins)
} as const;

export const ARSENAL = {
  steps: [0, 1, 2, 3, 4, 5], // the carousel steps one weapon per beat
  settle: 6, // atomic bomber centred, glow
  line: 5, // "An arsenal for every strategy."
} as const;

export const MATCH = {
  screen: anchored('match', EVENTS.match.vs, 5, 0, 8),
  line: 0.5, // "Find your rival."
  lockOn: 5, // punch into VS
} as const;

export const BATTLE = {
  // a) establishing: held first frame, callouts on both boards
  establish: {at: 0, beats: 8},
  calloutsAt: [1, 2, 3],
  // b) Aim. Fire. Hit.: the atomic strike in real time
  aim: 8, // held frame, macro on the target square
  strike: anchored('arsenal', EVENTS.arsenal.flash, 12, 10, 6),
  fire: 10,
  hit: 12, // == flash frame
  wordsOut: 15.5,
  // c) montage
  montage: [
    anchored('arsenal', EVENTS.arsenal.fireMarks, 17, 16, 3), // fire marks bloom
    anchored('defense', EVENTS.defense.shotDown, 21, 19, 5), //   AA gun: "Shot down!"
  ],
  // the game's own FX strips on graph paper, whip-panned (weapons with no footage)
  inserts: [
    {at: 24, beats: 4, fx: 'radar', label: 'Radar'},
    {at: 28, beats: 4, fx: 'submarine', label: 'Submarine'},
    {at: 32, beats: 4, fx: 'mine', label: 'Mine'},
  ],
  build: {at: 36, beats: 4}, // quick 1-beat hits into the break
  // d) the last ship: heartbeat, then the bomber
  tension: {at: 40, beats: 8},
  line: 41, // "Every move matters."
  lineOut: 47,
  lastRun: anchored('base', EVENTS.base.lastHit, 52, 49, 6.5, 1), // from = 1.5, the file's first frame
  lastHit: 52,
  silence: 55.5, // half a beat of silence before victory
} as const;

export const VICTORY = {
  word: 0, // "Victory." slams on the downbeat
  sweep: 1,
  wordOut: 4,
  // the result screen plays from just after the recording's cut to it; the count starts ~1.2 beats in
  screen: {clip: 'base', at: 4, beats: 8, from: 5.0} as Shot,
} as const;

export const ECONOMY = {
  blocks: [
    {at: 0, beats: 6, clip: 'buy', event: EVENTS.buy.counter, onBeat: 2, side: 'right'},
    {at: 6, beats: 6, clip: 'sell', event: EVENTS.sell.counter, onBeat: 2, side: 'left'},
    {at: 12, beats: 6, clip: 'store', event: EVENTS.store.emerald, onBeat: 2, side: 'right'},
    {at: 18, beats: 6, clip: 'leaderboard', event: 0, onBeat: 0, side: 'left'},
  ],
  punch: 21, // punch into the #1 row
} as const;

export const BENTO = {
  tiles: [-0.4, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], // staggered in, half a beat apart (the hero tile is already arriving on the cut)
  flyIn: 8, // camera flies into the battle tile
} as const;

export const SUPERCUT = {
  cuts: 12, // one beat each; the last two beats are the biggest explosion
} as const;

export const FINALE = {
  oneMore: 1.75, // "One more thing." (after ~0.9 s of black and silence)
  oneMoreOut: 5.5,
  badge: 6, // the dApp Store badge + line
  sweep: 7.5,
  badgeOut: 12,
  lockup: 12.5, // title + "Your move."
  period: 13.5, // the pixel lands as the period
  ping: 17.75, // it pings once (the lockup has held clean for > 2 s)
  black: 19.25, // fade to black by here
} as const;

// ─── Sound design cues ───────────────────────────────────────────────────────
// Absolute beats. Gameplay cues are derived from the footage events above, so they stay
// frame-accurate when a shot moves. `sfx` keys are the BANK in audio/mix.py, where each sound
// has a designed default level; `gain` is a relative trim in dB (0 = default).

/** Absolute beat at which a source event plays inside a shot of a scene. */
export const eventBeat = (scene: SceneName, shot: Shot, eventSec: number): number =>
  SCENES[scene].start + shot.at + ((eventSec - shot.from) * BPM) / 60 / (shot.rate ?? 1);

export type Cue = {beat: number; sfx: string; gain?: number};

const S = SCENES;
const at = (scene: SceneName, rel: number) => S[scene].start + rel;

export const SFX_CUES: Cue[] = [
  // cold open: the bit
  {beat: at('coldOpen', COLD_OPEN.pixelIn), sfx: 'shimmer', gain: -5},
  {beat: at('coldOpen', COLD_OPEN.ping1), sfx: 'sonar', gain: -1},
  {beat: at('coldOpen', COLD_OPEN.line1In), sfx: 'tick', gain: -4},
  ...COLD_OPEN.flashes.map((b, i) => ({beat: at('coldOpen', b), sfx: 'thud', gain: -4 + i})),
  {beat: at('coldOpen', COLD_OPEN.line2In), sfx: 'tick', gain: -4},
  {beat: at('coldOpen', COLD_OPEN.pixelToPeriod), sfx: 'tick', gain: -3},
  {beat: at('coldOpen', COLD_OPEN.ping2), sfx: 'sonar', gain: 0},
  // title: the first hit
  {beat: eventBeat('title', TITLE.hit, EVENTS.arsenal.flash), sfx: 'nuke', gain: 0},
  {beat: at('title', TITLE.titleIn), sfx: 'reveal', gain: -2},
  {beat: at('title', TITLE.sweep), sfx: 'sweep', gain: -4},
  {beat: at('title', TITLE.taglineIn), sfx: 'tick', gain: -4},
  // wallet
  {beat: at('wallet', 0), sfx: 'whoosh', gain: -4},
  {beat: at('wallet', WALLET.word1), sfx: 'tick', gain: -3},
  {beat: eventBeat('wallet', WALLET.screen, EVENTS.wallet.activityTab), sfx: 'tap', gain: -1},
  {beat: at('wallet', WALLET.word2), sfx: 'tick', gain: -3},
  // build
  {beat: at('build', 0), sfx: 'whoosh', gain: -4},
  {beat: eventBeat('build', BUILD.screen, EVENTS.build.placement), sfx: 'tap', gain: -2},
  {beat: at('build', BUILD.headline), sfx: 'tick', gain: -4},
  {beat: eventBeat('build', BUILD.screen, EVENTS.build.aaTap), sfx: 'tap', gain: -1},
  {beat: eventBeat('build', BUILD.screen, EVENTS.build.aaPlaced), sfx: 'place', gain: -1},
  {beat: eventBeat('build', BUILD.screen, EVENTS.build.mineTap), sfx: 'tap', gain: -1},
  {beat: eventBeat('build', BUILD.screen, EVENTS.build.minePlaced), sfx: 'place', gain: -1},
  {beat: at('build', BUILD.cards), sfx: 'whoosh', gain: -3},
  {beat: at('build', BUILD.cards + 0.5), sfx: 'whoosh', gain: -4},
  {beat: at('build', BUILD.line2), sfx: 'tick', gain: -4},
  // fleet: a whoosh per ship, then the stat
  {beat: at('fleet', FLEET.headline), sfx: 'tick', gain: -4},
  ...FLEET.ships.map((b, i) => ({beat: at('fleet', b), sfx: 'whoosh', gain: -3 - i})),
  {beat: at('fleet', FLEET.stat), sfx: 'slam', gain: -1},
  // arsenal: metallic ticks per step
  ...ARSENAL.steps.map((b) => ({beat: at('arsenal', b), sfx: 'metal', gain: -3})),
  {beat: at('arsenal', ARSENAL.line), sfx: 'tick', gain: -4},
  {beat: at('arsenal', ARSENAL.settle), sfx: 'shimmer', gain: -2},
  // match: sonar, then lock-on
  {beat: at('match', 0.5), sfx: 'sonar', gain: -2},
  {beat: at('match', 2.5), sfx: 'sonar', gain: -3},
  {beat: at('match', MATCH.lockOn), sfx: 'lock', gain: -1},
  // battle
  {beat: at('battle', 0), sfx: 'whoosh', gain: -2},
  ...BATTLE.calloutsAt.map((b) => ({beat: at('battle', b), sfx: 'tick', gain: -4})),
  {beat: at('battle', BATTLE.aim), sfx: 'lock', gain: -2},
  {beat: eventBeat('battle', BATTLE.strike, EVENTS.arsenal.planeLaunch), sfx: 'fire', gain: -1},
  {beat: eventBeat('battle', BATTLE.strike, EVENTS.arsenal.flash), sfx: 'nuke', gain: 0},
  {beat: eventBeat('battle', BATTLE.montage[0], EVENTS.arsenal.fireMarks), sfx: 'explosion', gain: -1},
  {beat: eventBeat('battle', BATTLE.montage[1], EVENTS.defense.planeHit), sfx: 'explosion', gain: -1},
  {beat: eventBeat('battle', BATTLE.montage[1], EVENTS.defense.shotDown), sfx: 'planeDown', gain: -1},
  ...BATTLE.inserts.map((ins) => ({beat: at('battle', ins.at) - 0.25, sfx: 'whoosh', gain: -2})),
  {beat: at('battle', BATTLE.inserts[0].at + 0.25), sfx: 'radar', gain: -1},
  {beat: at('battle', BATTLE.inserts[1].at + 0.25), sfx: 'sub', gain: -1},
  {beat: at('battle', BATTLE.inserts[2].at + 1), sfx: 'mine', gain: -1},
  ...[0, 1, 2, 3].map((i) => ({beat: at('battle', BATTLE.build.at + i), sfx: 'explosion', gain: -3 + i * 2})),
  {beat: at('battle', BATTLE.line), sfx: 'tick', gain: -4},
  {beat: at('battle', BATTLE.tension.at + 2), sfx: 'sonar', gain: -3},
  {beat: at('battle', BATTLE.tension.at + 6), sfx: 'sonar', gain: -3},
  {beat: eventBeat('battle', BATTLE.lastRun, EVENTS.base.lastHit), sfx: 'bombDrop', gain: -1},
  {beat: eventBeat('battle', BATTLE.lastRun, EVENTS.base.lastHit), sfx: 'sink', gain: 0},
  // victory
  {beat: at('victory', VICTORY.word), sfx: 'victory', gain: -1},
  {beat: at('victory', VICTORY.word), sfx: 'nuke', gain: -2},
  {beat: at('victory', VICTORY.sweep), sfx: 'sweep', gain: -4},
  {beat: eventBeat('victory', VICTORY.screen, EVENTS.base.pointsCount), sfx: 'coin', gain: -3},
  // economy
  ...ECONOMY.blocks.map((b) => ({beat: at('economy', b.at), sfx: 'whoosh', gain: -4})),
  ...ECONOMY.blocks.map((b) => ({beat: at('economy', b.at + 0.5), sfx: 'tick', gain: -4})),
  {beat: at('economy', ECONOMY.blocks[0].at + ECONOMY.blocks[0].onBeat), sfx: 'coin', gain: -1},
  {beat: at('economy', ECONOMY.blocks[1].at + ECONOMY.blocks[1].onBeat), sfx: 'coin', gain: -1},
  {beat: at('economy', ECONOMY.blocks[2].at + ECONOMY.blocks[2].onBeat), sfx: 'tap', gain: -1},
  {beat: at('economy', ECONOMY.punch), sfx: 'rankUp', gain: -1},
  // bento
  ...BENTO.tiles.map((b) => ({beat: at('bento', b), sfx: 'tick', gain: -5})),
  {beat: at('bento', BENTO.flyIn), sfx: 'whoosh', gain: -1},
  // supercut: one hit per cut, the biggest last
  ...Array.from({length: SUPERCUT.cuts - 2}, (_, i) => ({
    beat: at('supercut', i),
    sfx: i % 2 === 0 ? 'explosion' : 'fire',
    gain: -3,
  })),
  {beat: at('supercut', SUPERCUT.cuts - 2), sfx: 'nuke', gain: 0},
  // finale
  {beat: at('finale', FINALE.badge), sfx: 'reveal', gain: -4},
  {beat: at('finale', FINALE.sweep), sfx: 'sweep', gain: -4},
  {beat: at('finale', FINALE.period), sfx: 'tick', gain: -4},
  {beat: at('finale', FINALE.ping), sfx: 'sonar', gain: 0},
];
