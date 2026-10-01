/**
 * Deck30 — the cast. Who plays which role, how it is cropped, and the mosaic pool.
 *
 * Plain data (no imports) so scripts/deck30/cast.py and scripts/deck30/mosaic.py can read it with
 * `node --experimental-strip-types`. Photo ids are the trailer's (src/trailer45/cast.ts PHOTOS), and every
 * crop is taken from the trailer's graded stills (build/cast/graded/<id>.jpg, `npm run cast`), so the whole
 * campaign shares ONE grade. After editing: `npm run deck30:cast` (refuses a crop that cuts through a face)
 * and check deck30/review/cast_sheet.jpg.
 *
 *   box = [x, y, w, h] in 0..1 of the photo (after EXIF rotation). Strobe boxes are 16:9, facecams square,
 *   the split-screen reaction 8:9 — in PIXELS, so h = w * photoW / photoH * (aspect).
 *
 * Spread rule (brief §4.8): outside the mosaic nobody appears more than twice. Appearances are listed per
 * person below and checked by the cast script.
 */

export type Crop = { readonly id: string; readonly photo: string; readonly box: readonly [number, number, number, number]; readonly people: readonly string[] };

/**
 * "REAL PLAYERS." strobe: six players on the 8ths, alternating with battle hits (timeline STROBE). The three
 * clear faces go under REAL PLAYERS.; the over-the-shoulder players (faces turned to their phones) under
 * REAL BATTLES.
 */
export const STROBE: readonly Crop[] = [
  { id: 'st-hunter', photo: 'hunter', box: [0.0, 0.2, 1.0, 0.329], people: ['hunter'] },
  { id: 'st-sofa', photo: 'sofa', box: [0.11, 0.19, 0.55, 0.2475], people: ['crew', 'captain'] },
  { id: 'st-admiral', photo: 'admiral', box: [0.0, 0.1, 1.0, 0.422], people: ['admiral'] },
  { id: 'st-focus', photo: 'focus', box: [0.4, 0.0, 0.6, 0.506], people: ['focus'] },
  { id: 'st-duo', photo: 'duo', box: [0.5, 0.275, 0.5, 0.4356], people: ['duo'] },
  { id: 'st-topdown', photo: 'topdown', box: [0.0, 0.18, 1.0, 0.45], people: ['topdown'] },
];

/** Square facecams: two react on the drop's hits, one is the rival who locks in at matchmaking. */
export const FACECAMS: readonly Crop[] = [
  { id: 'fc-crew', photo: 'sofa', box: [0.13, 0.17, 0.255, 0.204], people: ['crew'] },
  { id: 'fc-captain', photo: 'sofa', box: [0.36, 0.24, 0.26, 0.208], people: ['captain'] },
  { id: 'fc-rival', photo: 'admiral', box: [0.0, 0.08, 0.56, 0.42], people: ['admiral'] },
];

/** The split screen's reaction (right half, 954 x 1080). */
export const SPLIT: Crop = { id: 'split-hunter', photo: 'hunter', box: [0.0, 0.08, 1.0, 0.6626], people: ['hunter'] };

/**
 * The mosaic: every photo (several face-aware crops each), the one usable live GIF, and real battle frames
 * from the upscaled gameplay plates. `scripts/deck30/mosaic.py` builds the atlases and the 256-tile plan
 * (no tile ever sits next to the same image). GIFs: the trailer's CAST.md excluded three of the four (one
 * possible minor, two off-brand); the remaining one is the Admiral at his desk, subtitle cropped off.
 */
export const MOSAIC_PHOTOS: readonly string[] = ['admiral', 'hands', 'hunter', 'sofa', 'focus', 'duo', 'pair', 'glow', 'topdown', 'overhead', 'desk'];
export const MOSAIC_GIFS: readonly { readonly file: string; readonly crop: readonly [number, number, number, number] }[] = [
  { file: '64cfb630d49870b7182bae6e1afd24b3848566c8 2 (online-video-cutter.com).gif', crop: [70, 10, 170, 170] },
];
/** How many tiles of the 256 play the live GIF (spread out, never neighbours). */
export const MOSAIC_LIVE_TILES = 6;
/** Battle frames: [plate, source second, centre x, centre y, side] in recording px (1280 x 576). Every crop sits
 * below the HUD band (y >= 100: names, points) and away from the result panel's text. */
export const MOSAIC_BATTLE: readonly (readonly [string, number, number, number, number])[] = [
  ['atomic', 1.4, 935, 272, 210], ['atomic', 1.55, 935, 262, 160], ['atomic', 1.72, 930, 250, 200], ['atomic', 1.9, 930, 240, 150],
  ['atomic', 2.2, 930, 260, 220], ['atomic', 2.93, 930, 320, 150], ['atomic', 3.05, 910, 330, 110], ['atomic', 1.02, 930, 300, 300],
  ['atomic', 0.9, 600, 300, 300], ['atomic', 1.1, 250, 300, 260], ['atomic', 1.8, 1180, 330, 200], ['atomic', 1.3, 930, 290, 120],
  ['raid', 3.03, 960, 158, 110], ['raid', 3.07, 965, 150, 90], ['raid', 3.13, 960, 175, 140], ['raid', 2.2, 900, 250, 240],
  ['raid', 1.6, 330, 300, 300], ['raid', 2.6, 1000, 220, 200], ['raid', 3.4, 940, 210, 200], ['raid', 1.9, 650, 300, 260],
  ['defense', 1.15, 330, 400, 140], ['defense', 1.25, 330, 400, 200], ['defense', 1.6, 260, 360, 200], ['defense', 0.6, 380, 380, 220],
  ['defense', 1.8, 900, 300, 300], ['defense', 0.9, 300, 300, 300], ['defense', 1.4, 330, 420, 120], ['defense', 0.4, 500, 380, 220],
  ['victory', 5.6, 150, 160, 220], ['victory', 6.4, 1150, 160, 220],
];
