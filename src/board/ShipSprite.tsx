/**
 * Ships and own-board arsenal items at CELL scale, in the fleet's colour art
 * (FLEET_ART — drawn as-is, never tinted, deck paper included, so the graph
 * rules stop at the hull on their own).
 *
 *  ship     the class's art, bow left, rotated 90deg when vertical. It spans
 *           the footprint plus a little (a one-cell boat a little more) and
 *           takes its height from the art, so masts may rise past the cell;
 *           it is lifted so the HULL, not the image box, sits on the cells'
 *           centreline (HULL below, measured from the art's widest rows).
 *  sunk     your own ship: the same art burnt, one red pen stroke through it,
 *           smoke drifting off the deck.
 *  wreck    an enemy ship found sunk: the pencil sketch of the class, struck
 *           through and smoking the same way — the enemy's fleet is never
 *           drawn, only what is left of it.
 *  tint     a flat silhouette of the ship (the drag shadow, the "can't go
 *           there" red).
 *
 * The component is unpositioned (the caller sizes a box with shipSpriteSize
 * or shipRect) so the placement screen can drag it and the board can pin it.
 */
import type { ArsenalItem, Orientation, ShipClass } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { FLEET_ART, FX_ART, type Asset } from '@/ui/assets';
import { color } from '@/ui/tokens';
import { RoughShape, hashString, roughLine } from '@/ui/useRough';
import { SHIP_BLEED } from './art';
import { CELL, cellRect } from './layout';

const LENGTH: Record<ShipClass, number> = {
  battleship: 4,
  cruiser: 3,
  destroyer: 2,
  boat: 1,
};

/**
 * Per class and art: the image's aspect (w / h) and where its hull's
 * centreline sits, as a fraction of the image height — the middle of the
 * rows at least half as wide as the widest (scripts/battle-assets.sh output;
 * re-measure if the art changes).
 */
const HULL: Record<'ship' | 'wreck', Record<ShipClass, { aspect: number; centre: number }>> = {
  ship: {
    battleship: { aspect: 720 / 248, centre: 0.558 },
    cruiser: { aspect: 476 / 173, centre: 0.471 },
    destroyer: { aspect: 341 / 148, centre: 0.51 },
    boat: { aspect: 260 / 107, centre: 0.542 },
  },
  wreck: {
    battleship: { aspect: 520 / 163, centre: 0.607 },
    cruiser: { aspect: 520 / 170, centre: 0.603 },
    destroyer: { aspect: 520 / 184, centre: 0.62 },
    boat: { aspect: 286 / 132, centre: 0.606 },
  },
};

/** How far past its footprint a ship's art runs, end to end. */
function overhang(shipClass: ShipClass): number {
  return shipClass === 'boat' ? 8 : 2;
}

export interface ShipSpriteProps {
  shipClass: ShipClass;
  orientation: Orientation;
  /** Your own sunk ship: burnt, struck through, smoking. */
  sunk?: boolean;
  /** An enemy wreck: the pencil sketch, struck through, smoking. */
  wreck?: boolean;
  /** Draw a flat silhouette in this colour instead of the art. */
  tint?: string;
  opacity?: number;
}

export function shipSpriteSize(shipClass: ShipClass, orientation: Orientation) {
  const long = LENGTH[shipClass] * CELL;
  return orientation === 'h' ? { width: long, height: CELL } : { width: CELL, height: long };
}

/**
 * The art's box in the horizontal long x CELL footprint the ship is authored
 * in: centred along the length, lifted so the hull centreline is the cells'.
 * Rotation is about the footprint's centre, so vertical ships use it as is.
 */
function artBox(shipClass: ShipClass, kind: 'ship' | 'wreck') {
  const long = LENGTH[shipClass] * CELL;
  const { aspect, centre } = HULL[kind][shipClass];
  const w = long + overhang(shipClass);
  const h = w / aspect;
  return { left: (long - w) / 2, top: CELL / 2 - h * centre, width: w, height: h };
}

function shipSource(shipClass: ShipClass, sunk: boolean, wreck: boolean): Asset {
  if (wreck) return FLEET_ART.wrecks[shipClass];
  return sunk ? FLEET_ART.sunk[shipClass] : FLEET_ART.ships[shipClass];
}

export const ShipSprite = memo(function ShipSprite({
  shipClass,
  orientation,
  sunk = false,
  wreck = false,
  tint,
  opacity = 1,
}: ShipSpriteProps) {
  const long = LENGTH[shipClass] * CELL;
  const size = shipSpriteSize(shipClass, orientation);
  const vertical = orientation === 'v';
  const box = artBox(shipClass, wreck ? 'wreck' : 'ship');
  return (
    <View pointerEvents="none" style={[size, { overflow: 'visible', opacity }]}>
      <View
        style={{
          position: 'absolute',
          width: long,
          height: CELL,
          left: vertical ? (CELL - long) / 2 : 0,
          top: vertical ? (long - CELL) / 2 : 0,
          // Always an array: RN's prop diff turns an explicit `undefined` into
          // null and its dev validator then crashes on `.forEach` the moment a
          // ship turns from vertical back to horizontal.
          transform: [{ rotate: vertical ? '90deg' : '0deg' }],
        }}
      >
        <Image
          source={shipSource(shipClass, sunk, wreck)}
          style={[styles.art, box]}
          contentFit="fill"
          tintColor={tint}
          cachePolicy="memory-disk"
        />
        {sunk || wreck ? <Strike shipClass={shipClass} /> : null}
      </View>
      {sunk || wreck ? <Smoke shipClass={shipClass} vertical={vertical} /> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Wreck overlay — a red pen stroke along the hull and smoke off the deck
// ---------------------------------------------------------------------------

const PUFF = 22;

/** One puff rising off the deck and thinning out, over and over. */
function Puff({ x, y, delay }: { x: number; y: number; delay: number }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0.35);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = 0;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [delay, reduceMotion, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.62 * Math.sin(Math.PI * Math.min(1, t.value * 1.05)),
    transform: [{ translateY: -16 * t.value }, { translateX: 5 * t.value }, { scale: 0.55 + 0.6 * t.value }],
  }));
  const h = PUFF / FX_ART.smoke.aspect;
  return (
    <Animated.View style={[styles.puff, { left: x - PUFF / 2, top: y - h * 0.75, height: h }, style]}>
      {/* The strip's second cell: a small, round puff. */}
      <View style={{ width: PUFF, height: h, overflow: 'hidden' }}>
        <Image
          source={FX_ART.smoke.source}
          style={{ position: 'absolute', left: -PUFF, width: PUFF * FX_ART.smoke.frames, height: h }}
          contentFit="fill"
          cachePolicy="memory-disk"
        />
      </View>
    </Animated.View>
  );
}

/** A red pen stroke along the hull; authored horizontally, rotates with the ship. */
function Strike({ shipClass }: { shipClass: ShipClass }) {
  const long = LENGTH[shipClass] * CELL;
  const strike = roughLine(4, CELL * 0.62, long - 4, CELL * 0.4, {
    seed: hashString(`wreck-${shipClass}`),
    stroke: color.inkRed,
    strokeWidth: 1.8,
    roughness: 1.6,
    bowing: 1.4,
  });
  return (
    <Svg width={long} height={CELL} viewBox={`0 0 ${long} ${CELL}`} style={StyleSheet.absoluteFill}>
      <RoughShape paths={strike} opacity={0.85} />
    </Svg>
  );
}

/** Smoke off the deck — outside the rotation, so it always rises. */
function Smoke({ shipClass, vertical }: { shipClass: ShipClass; vertical: boolean }) {
  const len = LENGTH[shipClass];
  const long = len * CELL;
  const seed = hashString(`wreck-${shipClass}`);
  const along = (f: number) => (vertical ? { x: CELL / 2, y: long * f } : { x: long * f, y: CELL / 2 });
  const first = along(len === 1 ? 0.5 : 0.36);
  const second = along(0.7);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Puff x={first.x} y={first.y} delay={(seed % 7) * 180} />
      {len > 2 ? <Puff x={second.x} y={second.y} delay={1300 + (seed % 5) * 120} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ArsenalSprite — AA gun, mine, radar on the own board
// ---------------------------------------------------------------------------

const ITEM_ART: Partial<Record<ArsenalItem['kind'], Asset>> = {
  aaGun: FLEET_ART.aaGun,
  mine: FLEET_ART.mine,
  radar: FLEET_ART.radar,
};

export interface ArsenalSpriteProps {
  item: ArsenalItem;
}

function ArsenalSpriteInner({ item }: ArsenalSpriteProps) {
  if (!item.at) return null;
  const rect = cellRect(item.at);
  const spent = item.destroyed === true || item.used === true;
  const seed = hashString(`arsenal-${item.id}-${item.kind}`);
  const source = ITEM_ART[item.kind] ?? null;
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
        opacity: spent ? 0.5 : 1,
      }}
    >
      {source ? (
        <Image source={source} style={styles.itemArt} contentFit="contain" cachePolicy="memory-disk" />
      ) : null}
      {item.destroyed ? (
        <Svg width={size} height={size} viewBox="0 0 32 32" style={StyleSheet.absoluteFill}>
          <RoughShape paths={roughLine(6, 6, 26, 26, { seed: seed + 30, stroke: color.inkRed, strokeWidth: 2 })} />
          <RoughShape paths={roughLine(26, 6, 6, 26, { seed: seed + 31, stroke: color.inkRed, strokeWidth: 2 })} />
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

const styles = StyleSheet.create({
  art: { position: 'absolute' },
  puff: { position: 'absolute', width: PUFF },
  itemArt: { position: 'absolute', left: 2, top: 2, right: 2, bottom: 2 },
});
