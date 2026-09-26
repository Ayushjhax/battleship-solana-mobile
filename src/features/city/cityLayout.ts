/**
 * The Port City as data — pure, so the composition can be asserted
 * (tests/city/layout.test.ts) and rendered outside the app
 * (scripts/city-preview.py) instead of eyeballed on a phone.
 *
 * ONE coordinate system: map pixels, the source pixels of
 * assets/city/map.jpg (1774 x 887). The background, every building, every
 * label, the selection marks and every hit box are placed in it, inside one
 * view that a single transform (offset + scale) puts on screen. Nothing on the
 * map is ever positioned in screen units, so nothing can drift while it moves.
 *
 * The map is terrain with empty plots; the buildings are separate cut-outs. The
 * assembled reference image is a concept, not a decomposition, so the plots
 * were chosen for this map: Admiralty on the plaza by the bridge (the centre of
 * the harbour), the Fish Market on the long pier, the Foundry and Scrapyard
 * side by side in the east docks, the Shipyard among the cranes, the
 * Expedition Dock out on the water, the Naval Academy up on the quiet hilltop,
 * the Harbour Defence on the east bluff over the harbour mouth and the
 * Lighthouse on the breakwater's end.
 */

/** The map image, in its own pixels. */
export const MAP = { w: 1774, h: 887 } as const;

/** Zoom is relative to the scale at which the map just covers the window. */
export const ZOOM = { min: 1, max: 2, initial: 1.2 } as const;

/**
 * Where the first frame is centred (map px): the Admiralty, the bridge, both
 * piers and the east docks — low enough that the Fish Market's ribbon clears
 * the hint along the bottom and the hilltop sits above the HUD.
 */
export const INITIAL_FOCUS = { x: 935, y: 492 } as const;

export type BuildingId =
  | 'admiralty'
  | 'fish_market'
  | 'foundry'
  | 'scrapyard'
  | 'naval_academy'
  | 'shipyard'
  | 'expedition_dock'
  | 'lighthouse'
  | 'harbour_defence'
  | 'armory'
  | 'bounty_board'
  | 'fleet_tavern'
  | 'gazette'
  | 'ink_and_pen_shop'
  | 'captains_log';

/** The six landmarks that come with their own ribbon label art. */
export type LabelId =
  'admiralty' | 'fish_market' | 'foundry' | 'scrapyard' | 'naval_academy' | 'shipyard';

/** Pixel sizes from assets/port_city_assets/manifest.json (12 px padding included). */
export const BUILDING_ART: Readonly<Record<BuildingId, { w: number; h: number }>> = {
  admiralty: { w: 317, h: 357 },
  foundry: { w: 322, h: 364 },
  fish_market: { w: 309, h: 303 },
  scrapyard: { w: 336, h: 299 },
  naval_academy: { w: 290, h: 345 },
  armory: { w: 345, h: 292 },
  shipyard: { w: 344, h: 309 },
  bounty_board: { w: 261, h: 306 },
  fleet_tavern: { w: 340, h: 324 },
  gazette: { w: 257, h: 315 },
  expedition_dock: { w: 386, h: 367 },
  lighthouse: { w: 305, h: 373 },
  harbour_defence: { w: 294, h: 354 },
  ink_and_pen_shop: { w: 295, h: 336 },
  captains_log: { w: 304, h: 344 },
};

/** Every label strip is the same ribbon, about 430 x 97. */
export const LABEL_ART = { w: 430, h: 97 } as const;
export const HARBOUR_RIBBON_ART = { w: 600, h: 125 } as const;

interface BuildingSpec {
  readonly id: BuildingId;
  readonly name: string;
  readonly description: string;
  /** Centre of the drawing's base (its ground line), map px. */
  readonly x: number;
  readonly y: number;
  /** Drawn width, map px; the height follows the art's own proportions. */
  readonly w: number;
  /** Supplied ribbon: drawn under the building, centred, this much below `y`. */
  readonly label?: { readonly dy: number; readonly w: number };
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Building extends BuildingSpec {
  /** The drawing's box, map px. */
  readonly box: Box;
  /** What a tap has to land in, map px — the drawing, padded for small ones. */
  readonly hit: Box;
  /** The ribbon's box, map px, if it has one. */
  readonly labelBox: Box | null;
}

/**
 * Painter's order is the list's order: sorted by ground line below, so a
 * building nearer the viewer always overlaps one behind it.
 */
const SPECS: readonly BuildingSpec[] = [
  {
    id: 'admiralty',
    name: 'Admiralty',
    description: 'The heart of your future city.',
    x: 660,
    y: 432,
    w: 236,
    label: { dy: -4, w: 190 },
  },
  {
    id: 'fish_market',
    name: 'Fish Market',
    description: 'A busy waterfront with rewards to collect.',
    x: 868,
    y: 712,
    w: 196,
    label: { dy: 2, w: 200 },
  },
  {
    id: 'foundry',
    name: 'Foundry',
    description: 'Prepare the steel that will shape your harbour.',
    x: 1626,
    y: 486,
    w: 176,
    label: { dy: 0, w: 180 },
  },
  {
    id: 'scrapyard',
    name: 'Scrapyard',
    description: 'Where battle salvage finds a new purpose.',
    x: 1440,
    y: 592,
    w: 190,
    label: { dy: 0, w: 190 },
  },
  {
    id: 'naval_academy',
    name: 'Naval Academy',
    description: 'Discover new tactical options.',
    x: 372,
    y: 192,
    w: 160,
    label: { dy: 2, w: 200 },
  },
  {
    id: 'shipyard',
    name: 'Shipyard',
    description: "Your fleet's home between battles.",
    x: 1366,
    y: 412,
    w: 206,
    label: { dy: 0, w: 190 },
  },
  {
    id: 'expedition_dock',
    name: 'Expedition Dock',
    description: 'Voyages beyond the charted waters set sail here.',
    x: 1170,
    y: 720,
    w: 196,
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    description: 'A guiding light for every ship coming home.',
    x: 1392,
    y: 842,
    w: 132,
  },
  {
    id: 'harbour_defence',
    name: 'Harbour Defence',
    description: 'Prepare your harbour for future raids.',
    x: 1578,
    y: 312,
    w: 156,
  },
  {
    id: 'armory',
    name: 'Armory',
    description: 'Heavy guns and shells for the fleet, kept under lock.',
    x: 1560,
    y: 700,
    w: 196,
  },
  {
    id: 'bounty_board',
    name: 'Bounty Board',
    description: 'New contracts are on the horizon.',
    x: 560,
    y: 584,
    w: 132,
  },
  {
    id: 'fleet_tavern',
    name: 'Fleet Tavern',
    description: 'Where captains trade stories between battles.',
    x: 300,
    y: 600,
    w: 184,
  },
  {
    id: 'gazette',
    name: 'Gazette',
    description: 'News from every sea, printed fresh each tide.',
    x: 520,
    y: 238,
    w: 134,
  },
  {
    id: 'ink_and_pen_shop',
    name: 'Ink and Pen Shop',
    description: 'Every great captain signs in ink.',
    x: 232,
    y: 358,
    w: 158,
  },
  {
    id: 'captains_log',
    name: "Captain's Log",
    description: 'A record of every battle you have fought.',
    x: 1136,
    y: 424,
    w: 158,
  },
];

/** Hit boxes are at least this big (map px) — about 70 dp at the opening zoom. */
const MIN_HIT = 150;
/**
 * The top of a drawing is mostly air round a flag, a spire or smoke, often in
 * front of the building behind it; the tap box keeps the lower part.
 */
const HIT_BODY = 0.85;

function build(spec: BuildingSpec): Building {
  const art = BUILDING_ART[spec.id];
  const h = (spec.w * art.h) / art.w;
  const box: Box = { x: spec.x - spec.w / 2, y: spec.y - h, w: spec.w, h };
  // The art's 12 px padding is air. The tap box is the drawing's body, standing
  // on its ground line, grown to MIN_HIT for the small ones.
  const pad = (12 * spec.w) / art.w;
  const hw = Math.max(MIN_HIT, spec.w - pad * 2);
  const hh = Math.max(MIN_HIT, (h - pad * 2) * HIT_BODY);
  const hit: Box = { x: spec.x - hw / 2, y: spec.y - pad - hh, w: hw, h: hh };
  const labelBox: Box | null = spec.label
    ? {
        x: spec.x - spec.label.w / 2,
        y: spec.y + spec.label.dy - (spec.label.w * LABEL_ART.h) / LABEL_ART.w,
        w: spec.label.w,
        h: (spec.label.w * LABEL_ART.h) / LABEL_ART.w,
      }
    : null;
  return { ...spec, box, hit, labelBox };
}

export const BUILDINGS: readonly Building[] = SPECS.map(build).sort((a, b) => a.y - b.y);

export const BUILDING_BY_ID: Readonly<Record<BuildingId, Building>> = Object.fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
) as Record<BuildingId, Building>;

/** "Your Harbour", written on the open channel under the bridge. */
export const HARBOUR_RIBBON: Box = { x: 826, y: 330, w: 200, h: (200 * 125) / 600 };

/**
 * Hit boxes flattened for the UI thread: [x, y, w, h] per building, in
 * painter's order. A tap is tested front to back (last first), so where two
 * boxes overlap, the building drawn on top wins.
 */
export const HIT_BOXES: readonly number[] = BUILDINGS.flatMap((b) => [
  b.hit.x,
  b.hit.y,
  b.hit.w,
  b.hit.h,
]);

/** Index into BUILDINGS of the building under a map point, or -1. */
export function hitTest(boxes: readonly number[], mx: number, my: number): number {
  'worklet';
  for (let i = boxes.length / 4 - 1; i >= 0; i--) {
    const x = boxes[i * 4]!;
    const y = boxes[i * 4 + 1]!;
    const w = boxes[i * 4 + 2]!;
    const h = boxes[i * 4 + 3]!;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return i;
  }
  return -1;
}

// ---- framing: map px -> window dp ----------------------------------------
//
// On screen a map point p sits at  offset + p * scale,  scale = cover * zoom.
// The offset is clamped so the map's edge never comes inside the window.

/** The scale (dp per map px) at which the map just covers a window. */
export function coverScale(viewW: number, viewH: number): number {
  'worklet';
  return Math.max(viewW / MAP.w, viewH / MAP.h);
}

export function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/** The allowed offset range along one axis at a given scale. */
export function offsetRange(view: number, mapSize: number, scale: number): [number, number] {
  'worklet';
  return [Math.min(0, view - mapSize * scale), 0];
}

/** The offset that puts map point `focus` at the window centre, clamped. */
export function offsetFor(
  focus: { x: number; y: number },
  scale: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  'worklet';
  const [minX, maxX] = offsetRange(viewW, MAP.w, scale);
  const [minY, maxY] = offsetRange(viewH, MAP.h, scale);
  return {
    x: clamp(viewW / 2 - focus.x * scale, minX, maxX),
    y: clamp(viewH / 2 - focus.y * scale, minY, maxY),
  };
}

/**
 * Pinch maths: keep the map point that was under the fingers at the start
 * (`anchor`, in map px) under the fingers now (`focal`, dp) at the new scale.
 */
export function zoomAbout(
  anchor: { x: number; y: number },
  focal: { x: number; y: number },
  scale: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  'worklet';
  const [minX, maxX] = offsetRange(viewW, MAP.w, scale);
  const [minY, maxY] = offsetRange(viewH, MAP.h, scale);
  return {
    x: clamp(focal.x - anchor.x * scale, minX, maxX),
    y: clamp(focal.y - anchor.y * scale, minY, maxY),
  };
}

// ---- the Coming Soon popup: ui/coming_soon_popup.png, 802 x 825 ----------

/**
 * scripts/city-assets.py paints the baked button and sample countdown out of
 * the panel; the screen puts the real button back at `button` and the live
 * countdown on the line at `countdown` (image px, the crops' own boxes).
 */
export const POPUP_ART = {
  w: 802,
  h: 825,
  button: { x: 97, y: 644, w: 599, h: 146 },
  countdown: { x: 277, y: 754, w: 225, h: 47 },
} as const;
