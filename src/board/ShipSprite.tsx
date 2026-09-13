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
 * The component is unpositioned (the caller sizes a box with shipSpriteSize
 * or shipRect) so the placement screen can drag it and the board can pin it.
 * Arsenal items (AA gun, mine, radar) come from assets/images/arsenal/, with
 * drawn glyphs as the same kind of fallback.
 */
import type { ArsenalItem, Orientation, ShipClass } from '@engine/types';
import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg from 'react-native-svg';

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
}

export function shipSpriteSize(shipClass: ShipClass, orientation: Orientation) {
  const long = LENGTH[shipClass] * CELL;
  return orientation === 'h' ? { width: long, height: CELL } : { width: CELL, height: long };
}

export const ShipSprite = memo(function ShipSprite({
  shipClass,
  orientation,
  stroke: strokeProp = color.ink,
  opacity: opacityProp = 1,
  sunk = false,
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
        <View style={[StyleSheet.absoluteFill, { opacity }]}>
          <View
            style={{
              width: long,
              height: CELL,
              left: orientation === 'v' ? (CELL - long) / 2 : 0,
              top: orientation === 'v' ? (long - CELL) / 2 : 0,
              transform: orientation === 'v' ? [{ rotate: '90deg' }] : undefined,
            }}
          >
            <AssetSlot
              source={source}
              w={long + SHIP_BLEED * 2}
              h={CELL + SHIP_BLEED * 2}
              label={shipClass}
              tintColor={stroke}
              style={{ position: 'absolute', left: -SHIP_BLEED, top: -SHIP_BLEED }}
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
        transform: vertical ? [{ rotate: '90deg' }] : undefined,
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
