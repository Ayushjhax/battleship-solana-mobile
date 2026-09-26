/**
 * The Port City's composition (src/features/city/cityLayout.ts): every
 * building from the asset pack is placed once, on the map, at its art's own
 * proportions; hit boxes are generous and front-most wins; the framing maths
 * keeps the map covering the window; and the popup crop offsets agree with
 * scripts/city-assets.py, which paints them out of the panel.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BUILDING_ART,
  BUILDINGS,
  BUILDING_BY_ID,
  HARBOUR_RIBBON,
  HIT_BOXES,
  INITIAL_FOCUS,
  MAP,
  POPUP_ART,
  ZOOM,
  coverScale,
  hitTest,
  offsetFor,
  offsetRange,
  zoomAbout,
} from '@/features/city/cityLayout';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(
  readFileSync(`${root}assets/port_city_assets/manifest.json`, 'utf8'),
) as { file: string; width: number; height: number }[];

describe('the buildings', () => {
  it('places each of the 15 supplied buildings exactly once', () => {
    const supplied = manifest
      .filter((m) => m.file.startsWith('buildings/'))
      .map((m) => m.file.replace('buildings/', '').replace('.png', ''))
      .sort();
    expect(supplied).toHaveLength(15);
    expect(BUILDINGS.map((b) => b.id).sort()).toEqual(supplied);
  });

  it('draws every building at its art proportions, from the manifest', () => {
    for (const entry of manifest.filter((m) => m.file.startsWith('buildings/'))) {
      const id = entry.file
        .replace('buildings/', '')
        .replace('.png', '') as keyof typeof BUILDING_ART;
      expect(BUILDING_ART[id]).toEqual({ w: entry.width, h: entry.height });
      const b = BUILDING_BY_ID[id];
      expect(b.box.w / b.box.h).toBeCloseTo(entry.width / entry.height, 6);
      // Never blown up past the art: the map is shown at most ~1 dp per map px.
      expect(b.box.w).toBeLessThanOrEqual(entry.width);
    }
  });

  it('keeps every drawing and label on the map', () => {
    for (const b of BUILDINGS) {
      for (const box of [b.box, b.labelBox].filter((x) => x !== null)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(MAP.w);
        expect(box.y + box.h).toBeLessThanOrEqual(MAP.h);
      }
    }
    expect(HARBOUR_RIBBON.x + HARBOUR_RIBBON.w).toBeLessThanOrEqual(MAP.w);
  });

  it('only the six landmarks with supplied ribbon art carry a label', () => {
    const labelled = BUILDINGS.filter((b) => b.labelBox !== null)
      .map((b) => b.id)
      .sort();
    expect(labelled).toEqual(
      ['admiralty', 'fish_market', 'foundry', 'naval_academy', 'scrapyard', 'shipyard'].sort(),
    );
    for (const id of labelled) {
      expect(manifest.some((m) => m.file === `ui/${id}_label.png`)).toBe(true);
    }
  });

  it('has a name and one short description for every building', () => {
    for (const b of BUILDINGS) {
      expect(b.name.length).toBeGreaterThan(2);
      expect(b.description.length).toBeLessThanOrEqual(56);
      expect(b.description.endsWith('.')).toBe(true);
    }
    expect(BUILDING_BY_ID.admiralty.description).toBe('The heart of your future city.');
    expect(BUILDING_BY_ID.harbour_defence.description).toBe(
      'Prepare your harbour for future raids.',
    );
  });

  it('makes the Admiralty the central landmark', () => {
    const centre = { x: MAP.w / 2, y: MAP.h / 2 };
    const dist = (b: (typeof BUILDINGS)[number]) => Math.hypot(b.x - centre.x, b.y - centre.y);
    const nearest = [...BUILDINGS].sort((a, b) => dist(a) - dist(b))[0]!;
    expect(nearest.id).toBe('admiralty');
    expect(BUILDING_BY_ID.admiralty.w).toBe(Math.max(...BUILDINGS.map((b) => b.w)));
  });

  it('draws in painter order: nearer the viewer is later', () => {
    for (let i = 1; i < BUILDINGS.length; i++) {
      expect(BUILDINGS[i]!.y).toBeGreaterThanOrEqual(BUILDINGS[i - 1]!.y);
    }
  });
});

describe('tapping', () => {
  it('every hit box is at least 150 map px square and covers its ground line', () => {
    for (const b of BUILDINGS) {
      expect(b.hit.w).toBeGreaterThanOrEqual(150);
      expect(b.hit.h).toBeGreaterThanOrEqual(150);
      expect(hitTest(HIT_BOXES, b.x, b.y - 20)).toBe(BUILDINGS.indexOf(b));
    }
  });

  it('finds nothing on open water', () => {
    expect(hitTest(HIT_BOXES, 900, 380)).toBe(-1);
    expect(hitTest(HIT_BOXES, 30, 860)).toBe(-1);
  });

  it('where boxes overlap, the building drawn on top wins', () => {
    const gazette = BUILDING_BY_ID.gazette;
    const admiralty = BUILDING_BY_ID.admiralty;
    const x = Math.max(gazette.hit.x, admiralty.hit.x) + 2;
    const y = Math.max(gazette.hit.y, admiralty.hit.y) + 2;
    expect(hitTest(HIT_BOXES, x, y)).toBe(BUILDINGS.indexOf(admiralty));
  });
});

describe('framing', () => {
  const windows = [
    { w: 873, h: 393 }, // 20:9 phone
    { w: 800, h: 360 }, // the canvas itself
    { w: 1024, h: 768 }, // 4:3 tablet
    { w: 1180, h: 820 },
    { w: 960, h: 390 },
  ];

  it('the minimum zoom always covers the window', () => {
    for (const v of windows) {
      const s = coverScale(v.w, v.h) * ZOOM.min;
      expect(MAP.w * s).toBeGreaterThanOrEqual(v.w - 1e-6);
      expect(MAP.h * s).toBeGreaterThanOrEqual(v.h - 1e-6);
    }
  });

  it('never lets the map edge come inside the window', () => {
    for (const v of windows) {
      for (const zoom of [ZOOM.min, ZOOM.initial, ZOOM.max]) {
        const s = coverScale(v.w, v.h) * zoom;
        for (const focus of [{ x: 0, y: 0 }, { x: MAP.w, y: MAP.h }, INITIAL_FOCUS]) {
          const o = offsetFor(focus, s, v.w, v.h);
          expect(o.x).toBeLessThanOrEqual(0);
          expect(o.y).toBeLessThanOrEqual(0);
          expect(o.x + MAP.w * s).toBeGreaterThanOrEqual(v.w - 1e-6);
          expect(o.y + MAP.h * s).toBeGreaterThanOrEqual(v.h - 1e-6);
        }
      }
    }
  });

  it('opens on the harbour with the main landmarks in view', () => {
    const v = { w: 873, h: 393 };
    const s = coverScale(v.w, v.h) * ZOOM.initial;
    const o = offsetFor(INITIAL_FOCUS, s, v.w, v.h);
    for (const id of ['admiralty', 'fish_market', 'shipyard', 'captains_log'] as const) {
      const b = BUILDING_BY_ID[id];
      const sx = o.x + b.x * s;
      const sy = o.y + (b.y - b.box.h / 2) * s;
      expect(sx).toBeGreaterThan(0);
      expect(sx).toBeLessThan(v.w);
      expect(sy).toBeGreaterThan(0);
      expect(sy).toBeLessThan(v.h);
    }
  });

  it('pinching keeps the point under the fingers still (away from the edges)', () => {
    const v = { w: 873, h: 393 };
    const s0 = coverScale(v.w, v.h) * 1.4;
    const o0 = offsetFor(INITIAL_FOCUS, s0, v.w, v.h);
    const focal = { x: 400, y: 200 };
    const anchor = { x: (focal.x - o0.x) / s0, y: (focal.y - o0.y) / s0 };
    const s1 = s0 * 1.2;
    const o1 = zoomAbout(anchor, focal, s1, v.w, v.h);
    expect(o1.x + anchor.x * s1).toBeCloseTo(focal.x, 6);
    expect(o1.y + anchor.y * s1).toBeCloseTo(focal.y, 6);
  });

  it('offset ranges are never inverted', () => {
    for (const v of windows) {
      const [lo, hi] = offsetRange(v.w, MAP.w, coverScale(v.w, v.h));
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });
});

describe('the Coming Soon popup', () => {
  it('puts the button and countdown back exactly where the asset script painted them out', () => {
    const script = readFileSync(`${root}scripts/city-assets.py`, 'utf8');
    const { button, countdown } = POPUP_ART;
    expect(script).toContain(`BUTTON_AT = (${button.x}, ${button.y})`);
    expect(script).toContain(`COUNTDOWN_AT = (${countdown.x}, ${countdown.y})`);
    const size = (file: string) => manifest.find((m) => m.file === file)!;
    expect(size('ui/coming_soon_popup.png')).toMatchObject({
      width: POPUP_ART.w,
      height: POPUP_ART.h,
    });
    expect(size('popup_parts/return_home_button.png')).toMatchObject({
      width: button.w,
      height: button.h,
    });
    expect(size('popup_parts/countdown_text.png')).toMatchObject({
      width: countdown.w,
      height: countdown.h,
    });
  });
});
