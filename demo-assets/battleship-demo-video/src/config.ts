/**
 * Everything editable about the edit lives here: asset paths, source trims,
 * camera framing, captions, timings and the sound sequence.
 *
 * Units
 *   frame        timeline frame at 60 fps (0–899)
 *   seconds      source time in the original recording (proxies keep the
 *                original timestamps, see scripts/prepare-media.mjs)
 *   x / y        gameplay: pixels of the 1280 × 576 recording
 *                port:     pixels of the 1774 × 887 Port City map (the game's
 *                          own coordinate system, src/features/city/cityLayout.ts)
 */

export const VIDEO = { width: 3840, height: 2160, fps: 60, durationInFrames: 900 } as const;

/** Essential text and branding stay at least this far from every edge. */
export const SAFE = 160;

/** The game's own palette (src/ui/tokens.ts in the game repo). */
export const COLOR = {
  paper: '#FDFAF3', // cityColor.paper
  sheet: '#FBFCFE', // color.paper
  ink: '#3E2FB8', // color.ink — primary ballpoint violet
  cityInk: '#0B0491', // cityColor.ink — Port City lettering
  red: '#C7261C', // color.inkRed — X marks, "Arsenal", danger
  gridMinor: '#CFE9F6',
  gridMajor: '#A6D8EE',
  /** The stage: the game's ink at its deepest, so the paper-white game reads as lit. */
  stageTop: '#0E1060',
  stageBottom: '#05062C',
} as const;

export const FONT_FAMILY = 'Bitter'; // the game's one display family (700 display, 600 labels)

/** Supplied files, copied into public/ by scripts/prepare-media.mjs. */
export const ASSETS = {
  logo: 'brand/logo.png', // 1200 × 1200
  badge: 'brand/solana-badge.png', // 696 × 273, official — shown unaltered
  website: 'brand/website.txt', // read at render time; never retyped
} as const;

// ---------------------------------------------------------------------------
// Gameplay recordings
// ---------------------------------------------------------------------------

export const SOURCE = { w: 1280, h: 576 } as const;

export const CLIPS = {
  arsenal: {
    src: 'footage/arsenal-attack.3x.mp4', // 3× Lanczos proxy of ../arsenal-attack.mp4
    original: 'footage/source/arsenal-attack.mp4',
    /** Source frame 0 (0.0–0.1 s): the armed Atomic Bomb and its target. */
    frame0: 'footage/arsenal-attack.frame0.3x.png',
    proxyScale: 3,
    duration: 3.334,
  },
  defense: {
    src: 'footage/defense.3x.mp4', // ../defense.mp4
    original: 'footage/source/defense.mp4',
    proxyScale: 3,
    duration: 2.734,
  },
  base: {
    src: 'footage/base-attack.3x.mp4', // ../base-attack.mp4
    original: 'footage/source/base-attack.mp4',
    proxyScale: 3,
    duration: 6.567,
  },
} as const;

export type ClipId = keyof typeof CLIPS;

/** The window the gameplay plays in (same 20:9 shape as the recordings). */
export const WINDOW = { x: 176, y: 178, w: 3488, h: 1570, radius: 34 } as const;

export interface Shot {
  id: string;
  clip: ClipId;
  /** First timeline frame and length. */
  from: number;
  durationInFrames: number;
  /** Source time (s) shown on the shot's first frame. */
  sourceStart: number;
  /** Source seconds per timeline second. */
  rate: number;
  /** Hold a still of the source frame for the whole shot (a deliberate freeze). */
  holdStill?: string;
  /** Which camera track frames this shot. */
  camera: CameraTrackId;
  /** Fade this shot out over its last N frames (it sits above the next shot). */
  fadeOutFrames?: number;
}

export const SHOTS: Shot[] = [
  // SCENE 1 — the Atomic Bomb is armed and aimed only on the recording's first
  // frame (0.0–0.1 s), so that frame is held for 0.4 s while the camera pushes
  // in, then the strike plays: bomber (0.23 s), white flash (1.00 s), mushroom
  // cloud (1.2 s), hit marks in the 3×3 zone (2.8–3.0 s).
  { id: 'attack-armed', clip: 'arsenal', from: 0, durationInFrames: 24, sourceStart: 0, rate: 1, holdStill: 'footage/arsenal-attack.frame0.3x.png', camera: 'battle' },
  { id: 'attack-strike', clip: 'arsenal', from: 24, durationInFrames: 162, sourceStart: 0.2, rate: 1.1, camera: 'battle', fadeOutFrames: 6 },

  // SCENE 2 — enemy bomber over the player's board (0.4 s), AA gun fires
  // (≈0.71 s), plane downed, "Shot down!" stamp (1.50–2.67 s). Slightly slowed
  // so the whole defence fits its three seconds and reads clearly.
  { id: 'defense', clip: 'defense', from: 180, durationInFrames: 180, sourceStart: 0, rate: 0.91, camera: 'battle' },

  // SCENE 4 — bomber released (1.63 s), crosses row A, bomb falls, first hit
  // (2.833 s), ship sunk (≈3.0 s), game over (3.533 s). Idle smoke trimmed;
  // the game's own cut to Victory (first frame 4.933 s) and the coin count
  // (2,150 → 2,199 by 6.37 s) until the window leaves for the end card.
  { id: 'raid-strike', clip: 'base', from: 510, durationInFrames: 170, sourceStart: 1.4, rate: 1, camera: 'raid' },
  { id: 'raid-victory', clip: 'base', from: 680, durationInFrames: 76, sourceStart: 4.95, rate: 1, camera: 'victory' },
];

// ---------------------------------------------------------------------------
// Camera. Keyframes are joined by a monotone cubic, so motion never stops at a
// key unless two keys hold the same value. zoom 1 = the full recording fills
// the window; x / y = the recording pixel held at the window's centre.
// ---------------------------------------------------------------------------

export interface CameraKey {
  frame: number;
  zoom: number;
  x: number;
  y: number;
}

export interface Punch {
  frame: number;
  /** Extra zoom at the hit, e.g. 0.03 = +3 %. */
  amount: number;
  /** Frames for the punch to settle. */
  settle: number;
}

export const CAMERA = {
  // Scenes 1 and 2 share one track: both recordings use the same screen
  // layout, so the move from the enemy board (attack) to the player's own
  // board (defence) is one continuous pan across the cut.
  battle: {
    keys: [
      { frame: 0, zoom: 1.0, x: 640, y: 288 }, // the whole game screen
      { frame: 24, zoom: 1.17, x: 590, y: 330 }, // Attack panel + red 3×3 target
      { frame: 52, zoom: 1.3, x: 780, y: 318 }, // follow the bomber right
      { frame: 72, zoom: 1.42, x: 905, y: 315 }, // on the flash
      { frame: 150, zoom: 1.47, x: 918, y: 322 }, // mushroom cloud → hit marks
      { frame: 170, zoom: 1.47, x: 905, y: 330 },
      { frame: 200, zoom: 1.47, x: 440, y: 372 }, // pan to the player's board
      { frame: 278, zoom: 1.56, x: 402, y: 386 }, // "Shot down!"
      { frame: 359, zoom: 1.6, x: 396, y: 388 },
    ],
    punches: [{ frame: 68, amount: 0.03, settle: 14 }],
  },
  raid: {
    keys: [
      { frame: 510, zoom: 1.0, x: 640, y: 288 }, // Bomber armed, "release to fire"
      { frame: 545, zoom: 1.18, x: 690, y: 280 },
      { frame: 586, zoom: 1.46, x: 930, y: 214 }, // row A of the enemy board
      { frame: 604, zoom: 1.64, x: 962, y: 196 }, // the decisive hit
      { frame: 636, zoom: 1.66, x: 960, y: 200 },
      { frame: 679, zoom: 1.4, x: 915, y: 302 }, // game over: the board at rest, header clear
    ],
    punches: [{ frame: 596, amount: 0.04, settle: 18 }],
  },
  victory: {
    keys: [
      { frame: 680, zoom: 1.02, x: 640, y: 288 },
      { frame: 756, zoom: 1.09, x: 640, y: 266 }, // towards the coin count
    ],
    punches: [],
  },
} satisfies Record<string, { keys: CameraKey[]; punches: Punch[] }>;

export type CameraTrackId = keyof typeof CAMERA;

/**
 * A hand-drawn highlight in the game's red ink, placed in recording pixels.
 * Only in scene 1, while the armed state is on screen.
 */
export const HIGHLIGHTS = [
  // the armed "Atomic Bomb" button in the Attack panel
  { id: 'atomic-button', x: 137, y: 369, w: 128, h: 72, radius: 16, draw: [3, 15], fadeOut: [19, 25] },
  // the red 3×3 target the game draws on the enemy board
  { id: 'atomic-target', x: 928, y: 307, w: 150, h: 150, radius: 18, draw: [9, 21], fadeOut: [19, 25] },
] as const;

// ---------------------------------------------------------------------------
// Port City — rebuilt from the game's own layout (cityLayout.ts): the empty-plot
// map plus the fifteen building cut-outs on their plots. Map px throughout.
// ---------------------------------------------------------------------------

export const PORT = {
  map: { src: 'port/map@2x.png', w: 1774, h: 887 },
  /** Centre of the building's ground line and its drawn width (map px). */
  buildings: [
    { id: 'admiralty', x: 660, y: 432, w: 236, art: [317, 357], label: { dy: -4, w: 190 } },
    { id: 'fish_market', x: 868, y: 712, w: 196, art: [309, 303], label: { dy: 2, w: 200 } },
    { id: 'foundry', x: 1626, y: 486, w: 176, art: [322, 364], label: { dy: 0, w: 180 } },
    { id: 'scrapyard', x: 1440, y: 592, w: 190, art: [336, 299], label: { dy: 0, w: 190 } },
    { id: 'naval_academy', x: 372, y: 192, w: 160, art: [290, 345], label: { dy: 2, w: 200 } },
    { id: 'shipyard', x: 1366, y: 412, w: 206, art: [344, 309], label: { dy: 0, w: 190 } },
    { id: 'expedition_dock', x: 1170, y: 720, w: 196, art: [386, 367] },
    { id: 'lighthouse', x: 1392, y: 842, w: 132, art: [305, 373] },
    { id: 'harbour_defence', x: 1578, y: 312, w: 156, art: [294, 354] },
    { id: 'armory', x: 1560, y: 700, w: 196, art: [345, 292] },
    { id: 'bounty_board', x: 560, y: 584, w: 132, art: [261, 306] },
    { id: 'fleet_tavern', x: 300, y: 600, w: 184, art: [340, 324] },
    { id: 'gazette', x: 520, y: 238, w: 134, art: [257, 315] },
    { id: 'ink_and_pen_shop', x: 232, y: 358, w: 158, art: [295, 336] },
    { id: 'captains_log', x: 1136, y: 424, w: 158, art: [304, 344] },
  ],
  labelArt: [430, 97],
  /** "Your Harbour", on the open channel under the bridge. */
  harbourRibbon: { src: 'port/ui/your_harbour_ribbon@2x.png', x: 826, y: 330, w: 200, art: [600, 125] },
  camera: {
    keys: [
      { frame: 340, zoom: 1.48, x: 935, y: 470 }, // close on the Admiralty and the harbour
      { frame: 400, zoom: 1.2, x: 915, y: 458 },
      { frame: 455, zoom: 1.07, x: 895, y: 448 },
      { frame: 516, zoom: 1.0, x: 887, y: 443 }, // the whole harbour
    ],
  },
  /**
   * Height parallax: buildings stand up off the map, so during the pull-back
   * they shrink slightly faster than the ground they stand on. Each scales
   * about its own ground line, so it never leaves its plot, and lands on the
   * game's exact layout at zoom 1.
   */
  heightParallax: 0.14,
  timing: {
    /** Dip through the game's paper: defence → paper (first pair), paper → port. */
    dip: [340, 347, 358],
    expand: [350, 400], // window opens to full frame
    ribbonIn: [384, 398],
    labelsIn: 400, // first landmark label
    labelStagger: 6,
    contract: [490, 509], // back into the window, then a clean cut to scene 4
    end: 510,
  },
  /** Order the landmark labels appear in (nearest the harbour first). */
  labelOrder: ['admiralty', 'shipyard', 'fish_market', 'scrapyard', 'foundry', 'naval_academy'],
} as const;

// ---------------------------------------------------------------------------
// Captions — one line each, same place every scene, never over the action.
// ---------------------------------------------------------------------------

export const CAPTION = {
  x: WINDOW.x,
  /** Lower third: bottom edge exactly SAFE px above the frame's bottom. */
  y: VIDEO.height - SAFE - 188,
  fontSize: 132,
  disc: 188,
  gap: 52,
  /** Frames either side of a scene boundary for the swap. */
  outFrames: 7,
  inFrames: 14,
  exit: [734, 748], // before the end card
} as const;

export const CAPTIONS = [
  { from: 0, to: 179, text: 'Choose your attack.', icon: 'fleet/icon-atomic-bomber.png', iconW: 138 },
  { from: 180, to: 359, text: 'Build your defense.', icon: 'fleet/icon-aa-gun.png', iconW: 118 },
  { from: 360, to: 509, text: 'Your home port.', icon: 'port/ui/location_flag@2x.png', iconW: 104 },
  { from: 510, to: 779, text: 'Take the fight to them.', icon: 'fleet/icon-bomber.png', iconW: 118 },
] as const;

// ---------------------------------------------------------------------------
// End card — fully settled by frame 779, held untouched to 899.
// ---------------------------------------------------------------------------

export const END_CARD = {
  from: 780,
  headline: 'Live on Solana dApp Store + Web',
  webLabel: 'Play on web',
  windowOut: [733, 752],
  enter: {
    logo: [749, 771],
    headline: [753, 773],
    badge: [757, 776],
    web: [760, 779],
  },
  logoSize: 1120,
  badgeScale: 1.6, // 696 × 273 → 1114 × 437, proportions untouched
} as const;

// ---------------------------------------------------------------------------
// Sound — the game's own effects (assets/audio in the game repo), placed on
// the frames where the game itself plays them (src/fx/battleEffects.ts).
// `at` is the frame the file starts. Volumes stay <= 1.
// ---------------------------------------------------------------------------

export const MUSIC = {
  src: 'audio/music/music_battle.mp3',
  volume: 0.95,
  fadeIn: [0, 8],
  fadeOut: [826, 896],
} as const;

export const SFX = [
  // selection: the click lands (+0.14 s into the file) as the highlight draws
  { id: 'select', src: 'audio/sfx/ui_tap.mp3', at: 0, volume: 0.6 },
  // Atomic Bomb: the bomb's whistle from release, the nuke on the white flash
  { id: 'atomic-drop', src: 'audio/sfx/bomb_drop.mp3', at: 22, volume: 0.3 },
  { id: 'atomic-flash', src: 'audio/sfx/nuke.mp3', at: 68, volume: 0.5 },
  // defence: AIRCRAFT_DOWNED plays planeDown 0.79 s before the stamp
  { id: 'aa-gun', src: 'audio/sfx/plane_down+8db.wav', at: 226, volume: 0.95 },
  // into the port: the ballpoint, subtly
  { id: 'port', src: 'audio/sfx/pen_scratch_long.mp3', at: 341, volume: 0.65 },
  // the raid: whistle into the hit, then the sinking on the decisive impact
  { id: 'raid-drop', src: 'audio/sfx/bomb_drop.mp3', at: 549, volume: 0.28 },
  { id: 'raid-hit', src: 'audio/sfx/explosion+12db.wav', at: 596, volume: 0.9 },
  { id: 'raid-sink', src: 'audio/sfx/ship_sink.mp3', at: 597, volume: 0.8 },
  // GAME_OVER (turn triangle clears at 3.533 s), then the result screen's coins
  { id: 'victory', src: 'audio/sfx/victory.mp3', at: 638, volume: 0.5 },
  { id: 'coins', src: 'audio/sfx/coin_flow.mp3', at: 719, volume: 0.45 },
  // the end card lands
  { id: 'end-card', src: 'audio/sfx/rank_up.mp3', at: 757, volume: 0.34 },
] as const;
