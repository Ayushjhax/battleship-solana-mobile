/**
 * v2 — "The board becomes a world". Everything editable about the v2 edit.
 *
 * Units as in ../config.ts: timeline frames at 60 fps; source seconds in the
 * original recordings; recording pixels (1280 × 576) for gameplay; Port City
 * map pixels (1774 × 887) for the harbour.
 *
 * Camera zoom 1 = the recording covers the frame (full bleed, 3.75× source).
 */

export { VIDEO, SAFE, COLOR, FONT_FAMILY, ASSETS, SOURCE, CLIPS, PORT, END_CARD } from '../config';

// ---------------------------------------------------------------------------
// Shots — real footage only. Each shot plays its recording on a camera track.
// ---------------------------------------------------------------------------

export type TrackId = 'battle' | 'raid' | 'victory';

export interface ShotV2 {
  id: string;
  clip: 'arsenal' | 'defense' | 'base';
  from: number;
  durationInFrames: number;
  sourceStart: number;
  rate: number;
  holdStill?: string;
  track: TrackId;
  /** Fade out over the last N frames (it sits above the next shot). */
  fadeOutFrames?: number;
}

export const SHOTS_V2: ShotV2[] = [
  // SCENE 1 — the armed Atomic Bomb and its target exist only on the first
  // frame of the recording; it is held for 0.4 s while the camera settles
  // from a close, slightly angled view to a clear front-facing one.
  { id: 'armed', clip: 'arsenal', from: 0, durationInFrames: 24, sourceStart: 0, rate: 1, holdStill: 'footage/arsenal-attack.frame0.3x.png', track: 'battle' },
  // release → bomber → flash (1.00 s) → mushroom cloud → hit marks (2.8 s)
  { id: 'strike', clip: 'arsenal', from: 24, durationInFrames: 162, sourceStart: 0.2, rate: 1.15, track: 'battle', fadeOutFrames: 6 },
  // SCENE 2 — enemy bomber, AA gun fires (0.71 s), downed, "Shot down!"
  // (1.50 s). Slowed to 0.86× so it also covers the lighthouse approach.
  { id: 'defense', clip: 'defense', from: 180, durationInFrames: 190, sourceStart: 0, rate: 0.86, track: 'battle' },
  // SCENE 4 — revealed behind the ship from 1.20 s: Bomber armed, released
  // (1.63 s), bomb on row A, first hit (2.833 s → frame 596), ship sunk,
  // game over (3.533 s → frame 638).
  { id: 'raid', clip: 'base', from: 498, durationInFrames: 170, sourceStart: 1.2, rate: 1, track: 'raid' },
  // the game's own result screen, settled: Victory, coins 2,150 → 2,200
  { id: 'victory', clip: 'base', from: 668, durationInFrames: 88, sourceStart: 5.08, rate: 1, track: 'victory' }, // ends 6.547 s, inside the 6.567 s clip
];

// ---------------------------------------------------------------------------
// Camera tracks. rx / ry: a restrained perspective angle in degrees.
// ---------------------------------------------------------------------------

export interface KeyV2 {
  frame: number;
  zoom: number;
  x: number;
  y: number;
  rx?: number;
  ry?: number;
}

export const TRACKS: Record<TrackId, { keys: KeyV2[]; punches: { frame: number; amount: number; settle: number }[] }> = {
  battle: {
    keys: [
      { frame: 0, zoom: 1.8, x: 220, y: 372, rx: 5, ry: -7 }, // close on the armed Atomic Bomb
      { frame: 10, zoom: 1.5, x: 300, y: 358, rx: 2.2, ry: -3 },
      { frame: 24, zoom: 1.08, x: 560, y: 320, rx: 0, ry: 0 }, // Attack panel + red 3×3 target
      { frame: 30, zoom: 1.08, x: 572, y: 320 },
      { frame: 54, zoom: 1.22, x: 770, y: 318 }, // follow the bomber
      { frame: 68, zoom: 1.4, x: 905, y: 315 }, // the flash
      { frame: 150, zoom: 1.46, x: 916, y: 322 }, // mushroom cloud → hit marks
      { frame: 170, zoom: 1.46, x: 905, y: 330, ry: 0 },
      { frame: 184, zoom: 1.48, x: 640, y: 372, ry: -3.5 }, // swing to the player's own board
      { frame: 200, zoom: 1.52, x: 430, y: 392, ry: 0 },
      { frame: 229, zoom: 1.58, x: 400, y: 405 }, // the AA gun fires
      { frame: 283, zoom: 1.64, x: 380, y: 400 }, // "Shot down!"
      { frame: 300, zoom: 1.64, x: 384, y: 398 }, // hold
      { frame: 324, zoom: 1.42, x: 760, y: 336 }, // pull out across the board…
      { frame: 342, zoom: 1.28, x: 1064, y: 298 }, // …and settle on its lighthouse
      { frame: 348, zoom: 1.25, x: 1080, y: 296 },
    ],
    punches: [{ frame: 66, amount: 0.03, settle: 14 }],
  },
  raid: {
    keys: [
      { frame: 498, zoom: 1.0, x: 600, y: 288 }, // Bomber armed, "release to fire"
      { frame: 526, zoom: 1.0, x: 620, y: 288 },
      { frame: 554, zoom: 1.2, x: 740, y: 252 }, // the bomber heads out along row A
      { frame: 586, zoom: 1.46, x: 930, y: 214 },
      { frame: 604, zoom: 1.64, x: 962, y: 196 }, // the decisive hit
      { frame: 638, zoom: 1.66, x: 960, y: 200 }, // hold: the ship goes down, game over
      { frame: 667, zoom: 1.5, x: 940, y: 250 },
    ],
    punches: [{ frame: 596, amount: 0.045, settle: 18 }],
  },
  victory: {
    keys: [
      { frame: 668, zoom: 1.0, x: 640, y: 288 },
      { frame: 756, zoom: 1.035, x: 640, y: 276 },
    ],
    punches: [],
  },
};

/** The battle track stops clamping to the recording here, so it can pass the board's edge. */
export const UNCLAMP = [312, 334] as const;

/** Directional motion blur from camera speed (screen px / frame). */
export const MOTION_BLUR = { threshold: 34, gain: 0.12, max: 10 } as const;

// ---------------------------------------------------------------------------
// Ink emphasis — the game's red ink, in recording pixels.
// ---------------------------------------------------------------------------

export const INK_MARKS = [
  { id: 'atomic-button', x: 137, y: 369, w: 128, h: 72, radius: 16, draw: [2, 10], fadeOut: [22, 28] },
  { id: 'atomic-target', x: 928, y: 307, w: 150, h: 150, radius: 18, draw: [13, 21], fadeOut: [24, 30] },
  { id: 'aa-gun', x: 313, y: 440, w: 70, h: 62, radius: 14, draw: [227, 236], fadeOut: [252, 264] },
] as const;

// ---------------------------------------------------------------------------
// Signature transition: the board's lighthouse becomes the harbour's.
// ---------------------------------------------------------------------------

export const LIGHTHOUSE = {
  /** On the battle screen (recording px): tower centre and finial→base height. */
  game: { x: 1234, y: 379, h: 122 },
  /** In lighthouse.png (art px, 305 × 373): the same points. */
  art: { x: 132, y: 126.5, h: 227, w: 305 },
  /** The frame the two are aligned; the harbour camera takes over after it. */
  match: 348,
  /** Ink bloom from the lighthouse: radius (screen px) over frames. */
  bloom: { frames: [343, 352, 370], radius: [0, 430, 3900] },
  /** Where the lighthouse sits on screen at the match (drives the battle key at 348). */
  screen: { x: 2640, y: 1470 },
} as const;

// ---------------------------------------------------------------------------
// Port City v2 — the pull-back from the lighthouse over the whole harbour.
// ---------------------------------------------------------------------------

export const PORT_V2 = {
  /** Keys after the match. The key at the match frame is solved from the lighthouse. */
  keys: [
    { frame: 380, zoom: 1.62, x: 1150, y: 600 },
    { frame: 420, zoom: 1.22, x: 990, y: 500 },
    { frame: 468, zoom: 1.04, x: 912, y: 452 },
    { frame: 500, zoom: 1.0, x: 900, y: 443 },
    { frame: 526, zoom: 1.0, x: 968, y: 443 }, // drift towards the harbour mouth, with the ship
  ],
  /** Depth-weighted height parallax: nearer buildings (larger y) rise more. */
  parallax: { base: 0.08, depth: 0.12 },
  /** Behind the map's bottom edge, the sea continues in this tone. */
  seaTone: '#C6C8EC',
  timing: { ribbonIn: [384, 398], labelsIn: 394, labelStagger: 6 },
  /** The sailboat at the Expedition Dock, cut from its sprite (art px of expedition_dock.png). */
  boat: {
    polygon: [
      [258, 6], [270, 6], [316, 18], [314, 42], [292, 42], [377, 194], [374, 208], [346, 232], [336, 252],
      [300, 258], [265, 252], [265, 222], [240, 222], [240, 246], [218, 244], [188, 238], [174, 222],
      [176, 204], [200, 196], [170, 172], [198, 118], [214, 50], [236, 52],
    ] as [number, number][],
    pivot: [262, 246] as [number, number],
    rock: 1.1, // degrees
    bob: 1.6, // art px
    period: 150, // frames
  },
  /** Sun glints on open water (map px), each twinkling on its own phase. */
  glints: [
    [905, 300], [960, 360], [1000, 470], [930, 520], [1040, 560], [1180, 860], [1260, 800], [1080, 800],
    [120, 835], [260, 870], [700, 850], [840, 70], [1000, 40], [1500, 40], [1680, 160],
  ] as [number, number][],
  /** Two gulls (the battle screen's own) gliding over the harbour mouth. */
  gulls: [
    { x: 930, y: 104, w: 30, drift: 34, phase: 0 },
    { x: 1010, y: 76, w: 24, drift: 26, phase: 0.4 },
  ],
} as const;

// ---------------------------------------------------------------------------
// Harbour → battle: the fleet battleship crosses the camera; the battle is
// revealed in its wake.
// ---------------------------------------------------------------------------

export const SHIP_WIPE = {
  src: 'fleet/ship-battleship@2x.png', // 1440 × 496
  frames: [494, 526],
  /** Ship centre x (screen px) at the start and end, and its height on screen. */
  fromX: -1250,
  toX: 5150,
  y: 1210,
  width: 2280,
  blur: 3,
} as const;

// ---------------------------------------------------------------------------
// Victory: the real banner lifts off the result screen as the screen
// settles into a card on the stage.
// ---------------------------------------------------------------------------

export const VICTORY = {
  banner: 'game/victory-banner.png', // 900 × 293 — the game's own art
  /** Where the banner art sits on the recording (recording px): x, y, w, h. */
  onScreen: { x: 510.6, y: -0.6, w: 305.1, h: 99.3 },
  card: { x: 320, y: 610, w: 3200, h: 1440, radius: 36 },
  settle: [670, 702], // full frame → card
  lift: [686, 710], // banner grows off the screen
  liftScale: 1.85,
  liftRise: 64,
  exit: [736, 756], // card and banner leave for the end card
} as const;

// ---------------------------------------------------------------------------
// Captions — an ink plate, bottom left, revealed by a mask.
// ---------------------------------------------------------------------------

export const CAPTIONS_V2 = [
  { text: 'Choose your attack.', icon: 'fleet/icon-atomic-bomber.png', iconW: 118, inAt: 18, outAt: 170 },
  { text: 'Build your defense.', icon: 'fleet/icon-aa-gun.png', iconW: 100, inAt: 192, outAt: 320 },
  { text: 'Your home port.', icon: 'port/ui/location_flag@2x.png', iconW: 86, inAt: 364, outAt: 490 },
  { text: 'Take the fight to them.', icon: 'fleet/icon-bomber.png', iconW: 100, inAt: 528, outAt: 660 },
] as const;

export const CAPTION_V2 = { x: 176, bottom: 160, height: 196, fontSize: 116, disc: 150, inFrames: 12, outFrames: 8 } as const;

// ---------------------------------------------------------------------------
// Sound — the game's own effects on the events they belong to.
// ---------------------------------------------------------------------------

export const MUSIC_V2 = { src: 'audio/music/music_battle.mp3', volume: 0.95, fadeIn: [0, 8], fadeOut: [826, 896] } as const;

export const SFX_V2 = [
  { id: 'select', src: 'audio/sfx/ui_tap.mp3', at: 0, volume: 0.6 }, // click lands as the ring draws
  { id: 'select-ink', src: 'audio/sfx/pen_scratch_short.mp3', at: 2, volume: 0.5 },
  { id: 'atomic-drop', src: 'audio/sfx/bomb_drop.mp3', at: 22, volume: 0.3 },
  { id: 'atomic-flash', src: 'audio/sfx/nuke.mp3', at: 66, volume: 0.5 },
  { id: 'aa-gun', src: 'audio/sfx/plane_down+8db.wav', at: 229, volume: 0.95 },
  { id: 'ink-bloom', src: 'audio/sfx/pen_scratch_long.mp3', at: 340, volume: 0.7 },
  { id: 'ship-wake', src: 'audio/sfx/splash+14db.wav', at: 500, volume: 0.6 },
  { id: 'raid-drop', src: 'audio/sfx/bomb_drop.mp3', at: 549, volume: 0.28 },
  { id: 'raid-hit', src: 'audio/sfx/explosion+12db.wav', at: 596, volume: 0.9 },
  { id: 'raid-sink', src: 'audio/sfx/ship_sink.mp3', at: 597, volume: 0.8 },
  { id: 'victory', src: 'audio/sfx/victory.mp3', at: 638, volume: 0.5 },
  { id: 'coins', src: 'audio/sfx/coin_flow.mp3', at: 701, volume: 0.45 },
  { id: 'end-card', src: 'audio/sfx/rank_up.mp3', at: 757, volume: 0.34 },
] as const;
