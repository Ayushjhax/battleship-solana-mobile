/**
 * Ships and own-board arsenal items at CELL scale.
 *
 *  'sprite'  the PNG from assets/ink/ships/ (all four face left), rotated
 *            90deg when vertical, tinted with the stroke colour and bled
 *            SHIP_BLEED past the cells like the arsenal items. Until the art
 *            lands a hull is drawn in code — never a dashed placeholder on
 *            the board.
 *  'wreck'   `sunk`: the sprite at 55% opacity in inkFaint with three rough
 *            scribbles struck through it and a smoke puff.
 *
 * Under the drawing sits a paper-coloured hull (<ShipBacking>): the ink art is
 * an alpha mask, so without it the graph rules run straight through the deck
 * and the hull reads as a stack of squares. The backing is a lens fitted to
 * the image's contain box, inset so it never pokes past the drawn outline.
 * `backing={false}` skips it — the placement drag layers draw their own so
 * the conflict tint can show through a lifted ship.
 *
 * The component is unpositioned (the caller sizes a box with shipSpriteSize
 * or shipRect) so the placement screen can drag it and the board can pin it.
 * Arsenal items (AA gun, mine, radar) come from assets/images/arsenal/, with
 * drawn glyphs as the same kind of fallback.
 */
import type { ArsenalItem, Orientation, ShipClass } from '@engine/types';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Image as RNImage, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { AssetSlot } from '@/ui/AssetSlot';
import { ARSENAL, FX, SHIPS, type Asset } from '@/ui/assets';
import { color } from '@/ui/tokens';
import { RoughShape, hashString, roughLine, useRough, type Point } from '@/ui/useRough';
import { SHIP_BLEED, arsenalGlyphPaths, scribblePaths, smokePaths } from './art';
import { CELL, cellRect } from './layout';

const LENGTH: Record<ShipClass, number> = {
  battleship: 4,
  cruiser: 3,
  destroyer: 2,
  boat: 1,
};

export interface ShipSpriteProps {
  shipClass: ShipClass;
  orientation: Orientation;
  stroke?: string;
  opacity?: number;
  /** Draw as a wreck: faint, scribbled through, smoking. */
  sunk?: boolean;
  /** The paper hull under the drawing. Default on; off for drag overlays. */
  backing?: boolean;
}

export function shipSpriteSize(shipClass: ShipClass, orientation: Orientation) {
  const long = LENGTH[shipClass] * CELL;
  return orientation === 'h' ? { width: long, height: CELL } : { width: CELL, height: long };
}

// ---------------------------------------------------------------------------
// ShipBacking — the paper hull under the ink
// ---------------------------------------------------------------------------

/** How far inside the drawn outline the paper lens stays. */
const BACKING_INSET = 1.5;

/**
 * Where the hull's centreline sits in the art, as a fraction of the image
 * height, and the hull's half-height on the same scale. Measured from the
 * opaque rows of assets/ink/ships/*.png (the top third is mast and
 * superstructure): battleship .64, cruiser .63, destroyer .65, boat .63.
 * Re-measure if the art changes. The image is lifted by this much so the
 * hull, not the image box, is what sits centred in the cells.
 */
const HULL_CENTRE = 0.64;
const HULL_HALF = 0.29;

const artSizeCache = new Map<ShipClass, { w: number; h: number } | null>();

/** Pixel size of the ship art, so the lens can follow its contain-fit box. */
function shipArtSize(shipClass: ShipClass): { w: number; h: number } | null {
  const cached = artSizeCache.get(shipClass);
  if (cached !== undefined) return cached;
  const source = SHIPS[shipClass];
  let size: { w: number; h: number } | null = null;
  if (typeof source === 'number') {
    const resolved = RNImage.resolveAssetSource(source);
    if (resolved?.width && resolved?.height) size = { w: resolved.width, h: resolved.height };
  } else if (source && typeof source === 'object' && !Array.isArray(source)) {
    if (source.width && source.height) size = { w: source.width, h: source.height };
  }
  artSizeCache.set(shipClass, size);
  return size;
}

/**
 * Where the art lands in the horizontal long x CELL space it is authored
 * in: the contain-fit box the sprite draws (bled SHIP_BLEED past the cells),
 * and `lift`, how far the image is raised so the hull centreline sits on the
 * cell centreline. Rotation happens around the footprint centre, so the same
 * numbers hold for vertical ships.
 */
function artFit(shipClass: ShipClass) {
  const long = LENGTH[shipClass] * CELL;
  const boxW = long + SHIP_BLEED * 2;
  const boxH = CELL + SHIP_BLEED * 2;
  const art = shipArtSize(shipClass);
  const fit = art ? Math.min(boxW / art.w, boxH / art.h) : 1;
  const iw = art ? art.w * fit : boxW;
  const ih = art ? art.h * fit : boxH;
  const ix = -SHIP_BLEED + (boxW - iw) / 2;
  const iy = -SHIP_BLEED + (boxH - ih) / 2;
  const lift = art ? iy + ih * HULL_CENTRE - CELL / 2 : 0;
  return { ix, iy: iy - lift, iw, ih, lift };
}

/** The image's vertical offset within its bleed box; see artFit. */
export function shipArtLift(shipClass: ShipClass): number {
  return artFit(shipClass).lift;
}

/**
 * The lens, in the same space: bow point on the left, squarer stern on the
 * right, centred on the hull (which artFit has put on the cell centreline).
 */
function hullLensPoints(shipClass: ShipClass): string {
  const { ix: x0, iy, iw, ih } = artFit(shipClass);
  const ix = x0 + BACKING_INSET;
  const w = iw - BACKING_INSET * 2;
  const cy = iy + ih * HULL_CENTRE;
  const hh = Math.max(0, ih * HULL_HALF - BACKING_INSET);
  const pts: Point[] = [
    [ix, cy],
    [ix + w * 0.1, cy - hh * 0.75],
    [ix + w * 0.26, cy - hh],
    [ix + w * 0.74, cy - hh],
    [ix + w * 0.93, cy - hh * 0.72],
    [ix + w, cy - hh * 0.28],
    [ix + w, cy + hh * 0.28],
    [ix + w * 0.93, cy + hh * 0.72],
    [ix + w * 0.74, cy + hh],
    [ix + w * 0.26, cy + hh],
    [ix + w * 0.1, cy + hh * 0.75],
  ];
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

/** Paper under the hull, sized like the sprite. Unpositioned, like ShipSprite. */
export const ShipBacking = memo(function ShipBacking({
  shipClass,
  orientation,
}: Pick<ShipSpriteProps, 'shipClass' | 'orientation'>) {
  const long = LENGTH[shipClass] * CELL;
  const size = shipSpriteSize(shipClass, orientation);
  const vertical = orientation === 'v';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, size]}>
      <View
        style={{
          width: long,
          height: CELL,
          left: vertical ? (CELL - long) / 2 : 0,
          top: vertical ? (long - CELL) / 2 : 0,
          transform: [{ rotate: vertical ? '90deg' : '0deg' }],
        }}
      >
        <Svg
          width={long + SHIP_BLEED * 2}
          height={CELL + SHIP_BLEED * 2}
          viewBox={`${-SHIP_BLEED} ${-SHIP_BLEED} ${long + SHIP_BLEED * 2} ${CELL + SHIP_BLEED * 2}`}
          style={{ position: 'absolute', left: -SHIP_BLEED, top: -SHIP_BLEED }}
        >
          <Polygon points={hullLensPoints(shipClass)} fill={color.paper} />
        </Svg>
      </View>
    </View>
  );
});

export const ShipSprite = memo(function ShipSprite({
  shipClass,
  orientation,
  stroke: strokeProp = color.ink,
  opacity: opacityProp = 1,
  sunk = false,
  backing = true,
}: ShipSpriteProps) {
  const source = SHIPS[shipClass];
  const len = LENGTH[shipClass];
  const long = len * CELL;
  const size = shipSpriteSize(shipClass, orientation);
  const { roughCircle, roughPolygon } = useRough();
  const stroke = sunk ? color.inkFaint : strokeProp;
  const opacity = sunk ? opacityProp * 0.55 : opacityProp;

  if (source) {
    return (
      <View style={[size, { overflow: 'visible' }]}>
        {backing ? <ShipBacking shipClass={shipClass} orientation={orientation} /> : null}
        <View style={[StyleSheet.absoluteFill, { opacity }]}>
          <View
            style={{
              width: long,
              height: CELL,
              left: orientation === 'v' ? (CELL - long) / 2 : 0,
              top: orientation === 'v' ? (long - CELL) / 2 : 0,
              // Always an array: RN's prop diff turns an explicit `undefined`
              // into null and its dev validator then crashes on `.forEach`
              // the moment a ship turns from vertical back to horizontal.
              transform: [{ rotate: orientation === 'v' ? '90deg' : '0deg' }],
            }}
          >
            <AssetSlot
              source={source}
              w={long + SHIP_BLEED * 2}
              h={CELL + SHIP_BLEED * 2}
              label={shipClass}
              tintColor={stroke}
              style={{
                position: 'absolute',
                left: -SHIP_BLEED,
                top: -SHIP_BLEED - shipArtLift(shipClass),
              }}
            />
          </View>
        </View>
        {sunk ? <Wreck shipClass={shipClass} orientation={orientation} /> : null}
      </View>
    );
  }

  const map = ([u, v]: Point): Point => (orientation === 'h' ? [u, v] : [v, u]);
  const seed = hashString(`generated-ship-${shipClass}-${orientation}-${stroke}`);
  const pen = { stroke, strokeWidth: 1.45, roughness: 1.05, bowing: 0.65 } as const;
  const hullPoints: Point[] = [
    [2, CELL / 2],
    [Math.min(11, long * 0.34), 4],
    [long - 5, 5],
    [long - 1.5, CELL / 2],
    [long - 5, CELL - 5],
    [Math.min(11, long * 0.34), CELL - 4],
  ];
  // Paper under the hatching, for the same reason the art gets ShipBacking.
  const hullPaper = roughPolygon(hullPoints.map(map), {
    seed,
    stroke: 'none',
    fill: color.paper,
    fillStyle: 'solid',
    roughness: 0.6,
  });
  const hull = roughPolygon(hullPoints.map(map), {
    seed,
    ...pen,
    fill: stroke,
    fillStyle: 'hachure',
    hachureAngle: orientation === 'h' ? -42 : 42,
    hachureGap: 3,
    fillWeight: 0.85,
  });

  const cabinStart = Math.max(8, long * (shipClass === 'battleship' ? 0.43 : 0.35));
  const cabinEnd = Math.min(long - 7, cabinStart + Math.max(9, long * 0.24));
  const cabinPoints: Point[] = [
    [cabinStart, 8],
    [cabinEnd, 8],
    [cabinEnd + 3, CELL - 8],
    [cabinStart - 2, CELL - 8],
  ];
  const cabin = roughPolygon(cabinPoints.map(map), { seed: seed + 1, ...pen, strokeWidth: 1.15 });
  const centreA = map([7, CELL / 2]);
  const centreB = map([long - 6, CELL / 2]);
  const deckLine = roughLine(centreA[0], centreA[1], centreB[0], centreB[1], {
    seed: seed + 2,
    ...pen,
    strokeWidth: 0.9,
  });

  const portholes = len === 1 ? [long * 0.5] : [long * 0.3, long * 0.68];
  const circles = portholes.map((u, index) => {
    const p = map([u, CELL / 2]);
    return roughCircle(p[0], p[1], shipClass === 'boat' ? 5.5 : 4.2, {
      seed: seed + 3 + index,
      ...pen,
      strokeWidth: 1,
    });
  });

  return (
    <View style={size}>
      {backing ? (
        <Svg
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          style={StyleSheet.absoluteFill}
        >
          <RoughShape paths={hullPaper} />
        </Svg>
      ) : null}
      <View style={{ opacity }}>
        <Svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
          <RoughShape paths={hull} />
          <RoughShape paths={cabin} />
          <RoughShape paths={deckLine} />
          {circles.map((paths, index) => (
            <RoughShape key={index} paths={paths} />
          ))}
        </Svg>
      </View>
      {sunk ? <Wreck shipClass={shipClass} orientation={orientation} /> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Wreck overlay — scribbles along the hull and a smoke puff
// ---------------------------------------------------------------------------

/** Authored horizontally in a long x CELL box, rotated for vertical ships. */
function Wreck({ shipClass, orientation }: { shipClass: ShipClass; orientation: Orientation }) {
  const long = LENGTH[shipClass] * CELL;
  const seed = hashString(`wreck-${shipClass}`);
  const vertical = orientation === 'v';
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: vertical ? (CELL - long) / 2 : 0,
        top: vertical ? (long - CELL) / 2 : 0,
        width: long,
        height: CELL,
        transform: [{ rotate: vertical ? '90deg' : '0deg' }],
      }}
    >
      <Svg
        width={long}
        height={CELL}
        viewBox={`0 0 ${long} ${CELL}`}
        style={StyleSheet.absoluteFill}
      >
        {scribblePaths(long, CELL, seed).map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
      <View style={{ position: 'absolute', left: long * 0.45, top: -14, width: 28, height: 24 }}>
        {FX.smokePuff ? (
          <Image
            source={FX.smokePuff}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            tintColor={color.inkFaint}
          />
        ) : (
          <Svg width={28} height={24} viewBox="0 0 28 24">
            {smokePaths(seed + 20).map((paths, i) => (
              <RoughShape key={i} paths={paths} />
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ArsenalSprite — AA gun, mine, radar on the own board
// ---------------------------------------------------------------------------

const ARSENAL_ART: Partial<Record<ArsenalItem['kind'], Asset>> = {
  aaGun: ARSENAL.aaGun,
  mine: ARSENAL.mine,
  radar: ARSENAL.radar,
};

export interface ArsenalSpriteProps {
  item: ArsenalItem;
}

function ArsenalSpriteInner({ item }: ArsenalSpriteProps) {
  if (!item.at) return null;
  const rect = cellRect(item.at);
  const spent = item.destroyed === true || item.used === true;
  const tint = spent ? color.inkFaint : color.ink;
  const seed = hashString(`arsenal-${item.id}-${item.kind}`);
  const source = ARSENAL_ART[item.kind] ?? null;
  const size = CELL + SHIP_BLEED * 2;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: rect.x - SHIP_BLEED,
        top: rect.y - SHIP_BLEED,
        width: size,
        height: size,
        opacity: spent ? 0.55 : 1,
      }}
    >
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          tintColor={tint}
          cachePolicy="memory-disk"
        />
      ) : (
        <Svg width={size} height={size} viewBox="0 0 32 32">
          {arsenalGlyphPaths(item.kind, seed, tint).map((paths, i) => (
            <RoughShape key={i} paths={paths} />
          ))}
        </Svg>
      )}
      {item.destroyed ? (
        <Svg width={size} height={size} viewBox="0 0 32 32" style={StyleSheet.absoluteFill}>
          <RoughShape
            paths={roughLine(6, 6, 26, 26, {
              seed: seed + 30,
              stroke: color.inkRed,
              strokeWidth: 2,
            })}
          />
          <RoughShape
            paths={roughLine(26, 6, 6, 26, {
              seed: seed + 31,
              stroke: color.inkRed,
              strokeWidth: 2,
            })}
          />
        </Svg>
      ) : null}
    </View>
  );
}

export const ArsenalSprite = memo(
  ArsenalSpriteInner,
  (a, b) =>
    a.item.id === b.item.id &&
    a.item.kind === b.item.kind &&
    a.item.at?.r === b.item.at?.r &&
    a.item.at?.c === b.item.at?.c &&
    a.item.used === b.item.used &&
    a.item.destroyed === b.item.destroyed,
);
