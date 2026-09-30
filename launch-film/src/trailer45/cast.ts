/**
 * Trailer45 — the cast. Which photo plays which role, and how it is cropped.
 *
 * This file is plain data (no imports) so `scripts/cast.py` can read it with
 * `node --experimental-strip-types`. After editing it run `npm run cast`, which
 * crops, grades and writes everything under public/cast/.
 *
 * Coordinates are normalised to the source image AFTER EXIF rotation:
 *   box  = [x, y, w, h] in 0..1 of the source width / height.
 *   focus = [x, y] in 0..1 — the point `object-position` keeps in frame
 *           (put it on the face) when a tile is cropped to a new aspect.
 * GIF crops are in the GIF's native pixels.
 *
 * Source folder: ../demo-assets/users (read only, never modified).
 * Faces were located with YuNet (scripts/detect_faces.py → build/cast/faces.json);
 * `npm run cast` refuses any crop that cuts through a detected face box.
 */

export type Photo = {
  readonly id: string;
  readonly file: string;
  /** focus point for tiles (usually the face) */
  readonly focus: readonly [number, number];
  /** 'night' photos keep their darkness when exposure is evened out */
  readonly mood?: 'night';
};

export const PHOTOS: readonly Photo[] = [
  { id: 'admiral', file: 'IMG_0056.HEIC', focus: [0.2, 0.33] },
  { id: 'hands', file: 'DSC02686.jpg', focus: [0.6, 0.5] },
  { id: 'hunter', file: 'View recent photos.png', focus: [0.43, 0.36], mood: 'night' },
  { id: 'sofa', file: 'fxn 2026-09-23 1753407071EF832BCA.JPG', focus: [0.38, 0.3] },
  { id: 'focus', file: 'DSC00193.jpg', focus: [0.55, 0.45] },
  { id: 'duo', file: 'DSC02671.jpg', focus: [0.55, 0.45] },
  { id: 'pair', file: 'HTE6dy9bkAIeyVl.jpeg', focus: [0.6, 0.45] },
  { id: 'glow', file: 'IMG_0825.jpg', focus: [0.5, 0.45], mood: 'night' },
  { id: 'topdown', file: 'fxn 2026-09-26 200056522D97253BF5.JPG', focus: [0.5, 0.4] },
  { id: 'overhead', file: 'fxn 2026-09-26 2001073D0C3B0DC2D8.JPG', focus: [0.55, 0.35] },
  { id: 'desk', file: 'IMG_0826.jpg', focus: [0.45, 0.45] },
];

/** The four character cards in the hook: one person each, no repeats. */
export type Hero = { readonly role: string; readonly photo: string; readonly box: readonly [number, number, number, number] };

export const HEROES: readonly Hero[] = [
  // label text lives in copy.ts (CAST_LABELS), in this order
  { role: 'admiral', photo: 'admiral', box: [0.0, 0.14, 1.0, 0.422] },
  { role: 'tactician', photo: 'hands', box: [0.13, 0.13, 0.8, 0.697] },
  { role: 'hunter', photo: 'hunter', box: [0.0, 0.19, 1.0, 0.329] },
  { role: 'captain', photo: 'sofa', box: [0.017, 0.14, 0.727, 0.327] },
];

/** Square facecams for the battle. Photos use `box`; GIFs use `gifCrop` (native px). */
export type Facecam = {
  readonly id: string;
  readonly photo?: string;
  readonly box?: readonly [number, number, number, number];
  readonly gif?: string;
  readonly gifCrop?: readonly [number, number, number, number];
};

export const FACECAMS: readonly Facecam[] = [
  // the rival who "locks in" at matchmaking
  { id: 'fc-rival', photo: 'admiral', box: [0.0, 0.12, 0.5, 0.375] },
  // battle reactions
  { id: 'fc-crew', photo: 'sofa', box: [0.13, 0.17, 0.255, 0.204] },
  { id: 'fc-hunter', photo: 'hunter', box: [0.137, 0.187, 0.592, 0.346] },
  { id: 'fc-captain', photo: 'sofa', box: [0.36, 0.24, 0.26, 0.208] },
];

/** The victory bento grid, in reading order around the Victory screen. */
export const CELEBRATION: readonly string[] = ['sofa', 'duo', 'hands', 'glow', 'pair', 'topdown', 'focus', 'overhead'];

/** Everyone usable goes into the swarm (plus the live GIF and in-game art). */
export const SWARM_PHOTOS: readonly string[] = PHOTOS.map((p) => p.id);
export const SWARM_GIFS: readonly string[] = ['64cfb630d49870b7182bae6e1afd24b3848566c8 2 (online-video-cutter.com).gif'];
