/**
 * Where every building sits on the harbour drawing — part-02 §2.
 *
 * Positions are NORMALISED scene coordinates (0..1 of the image), anchored
 * BOTTOM-CENTRE, so a plot scales with the pinch and never needs its own
 * transform: it is a child of the same Animated.View that carries the map's
 * translate/scale, positioned in map units.
 *
 * THREE OF part-02 §2's SUGGESTED COORDINATES WERE WRONG against the art, and
 * are corrected here (see docs/port-city/progress/part-02-report.md §1):
 *
 *   Admiralty   doc 0.25/0.72 -> 0.22/0.55  (0.72 lands in the park)
 *   Shipyard    doc 0.82/0.68 -> 0.83/0.54  (0.68 lands in open water)
 *   Lighthouse  doc 0.95/0.42 -> 0.59/0.79  (0.95/0.42 is open sea; the drawn
 *                                            lighthouse is on the bottom-centre
 *                                            headland)
 *
 * The first two are pinned to the dashed slots that already shipped in
 * app/city.tsx, which were placed against the art and are therefore the better
 * source than the doc's table.
 *
 * __tests__/plots.test.ts enforces: every coordinate inside 0..1, one plot per
 * catalogue building, no two tap boxes overlapping at 1x, and nothing
 * overlapping the player's own harbour.
 */
import { BUILDING_IDS, type BuildingId } from '@engine/city';
import { CANVAS_W } from '@/ui/tokens';

/** city-port.png is 768 x 1024, drawn at 800 wide. */
export const MAP_W = CANVAS_W;
export const MAP_H = Math.round((CANVAS_W * 1024) / 768); // 1067

/** A plot's box, in map units at 1x. */
export const PLOT_W = 120;
export const PLOT_H = 80;

/** The same box in normalised units, which is what the overlap test works in. */
export const PLOT_NW = PLOT_W / MAP_W; // 0.15
export const PLOT_NH = PLOT_H / MAP_H; // ~0.075

export interface Plot {
  readonly id: BuildingId;
  /** 0..1 across the image. */
  readonly x: number;
  /** 0..1 down the image; the plot's BASE sits here. */
  readonly y: number;
  /** What the art actually shows here — why this spot and not another. */
  readonly sitsOn: string;
}

export const PLOTS: readonly Plot[] = [
  { id: 'naval_academy', x: 0.09, y: 0.32, sitsOn: 'the hill and high-rise block, upper left' },
  { id: 'officers_club', x: 0.085, y: 0.46, sitsOn: 'the terrace beside the cathedral spire' },
  { id: 'admiralty', x: 0.22, y: 0.55, sitsOn: 'the civic block below the cathedral' },
  { id: 'stationery', x: 0.16, y: 0.64, sitsOn: 'the old town street' },
  { id: 'newsstand', x: 0.32, y: 0.64, sitsOn: 'the corner of the same street' },
  { id: 'fleet_hall', x: 0.24, y: 0.73, sitsOn: 'the waterfront square by the park' },
  { id: 'harbour_office', x: 0.25, y: 0.35, sitsOn: 'the pier head north-west of your marina' },
  { id: 'fish_market', x: 0.44, y: 0.545, sitsOn: 'the quay just south of your marina' },
  { id: 'coastal_command', x: 0.6, y: 0.36, sitsOn: "the right bank under the bridge's span" },
  { id: 'scrapyard', x: 0.63, y: 0.59, sitsOn: 'the yard at the near end of the bridge' },
  { id: 'trade_docks', x: 0.75, y: 0.44, sitsOn: 'the cargo cranes and warehouses' },
  { id: 'shipyard', x: 0.83, y: 0.54, sitsOn: 'the dry dock and gantry cranes' },
  { id: 'armory', x: 0.72, y: 0.19, sitsOn: 'the rail yard and airfield behind the docks' },
  { id: 'foundry', x: 0.91, y: 0.3, sitsOn: 'the plant with the cooling towers and tanks' },
  { id: 'lighthouse', x: 0.59, y: 0.79, sitsOn: 'the lighthouse on the rocky headland' },
];

/**
 * The player's own harbour, already drawn by app/city.tsx's HomeHarbour. It is
 * not a plot, but no plot may sit on top of it.
 */
export const HARBOUR_BOX = { x: 236, y: 392, w: 168, h: 96 } as const;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A plot's normalised box, bottom-anchored. */
export function normalisedBox(plot: Pick<Plot, 'x' | 'y'>): Box {
  return {
    left: plot.x - PLOT_NW / 2,
    right: plot.x + PLOT_NW / 2,
    top: plot.y - PLOT_NH,
    bottom: plot.y,
  };
}

export const HARBOUR_NORMALISED: Box = {
  left: HARBOUR_BOX.x / MAP_W,
  right: (HARBOUR_BOX.x + HARBOUR_BOX.w) / MAP_W,
  top: HARBOUR_BOX.y / MAP_H,
  bottom: (HARBOUR_BOX.y + HARBOUR_BOX.h) / MAP_H,
};

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Top-left of a plot in MAP units, which is what the overlay renders with. */
export function plotOrigin(plot: Pick<Plot, 'x' | 'y'>): { left: number; top: number } {
  return {
    left: plot.x * MAP_W - PLOT_W / 2,
    top: plot.y * MAP_H - PLOT_H,
  };
}

const BY_ID = new Map<BuildingId, Plot>(PLOTS.map((p) => [p.id, p]));

export function plotFor(id: BuildingId): Plot | undefined {
  return BY_ID.get(id);
}

/** Every catalogue building, so a missing plot is a test failure not a blank. */
export const PLOTTED_IDS: readonly BuildingId[] = BUILDING_IDS;
