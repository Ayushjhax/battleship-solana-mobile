import { ARSENAL_SPEC, isOwnBoardKind, specFor } from '@engine/arsenal';
import { emptyBoard } from '@engine/board';
import type { Difficulty } from '@engine/ai';
import { makeFleet } from '@engine/fleet';
import { validateSubmission } from '@engine/match';
import { validateArsenalPlacement } from '@engine/placement';
import type { ArsenalItem, ArsenalKind, Orientation, ShipClass } from '@engine/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';

import { CAPTAINS, captainFuel } from '@engine/captains';
import { terrainForSea, seaSpec, unlockedSeasFor, isSeaId, type SeaId } from '@engine/terrain';
import type { CaptainId } from '@engine/types';
import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { loadFlags, seasonSea } from '@/city/features';
import { useCity } from '@/city/store';
import { GridBoard, LABEL_MARGIN } from '@/board/GridBoard';
import { BOARD_SIZE, CELL } from '@/board/layout';
import { ShipBacking, ShipSprite, shipSpriteSize } from '@/board/ShipSprite';
import { ARSENAL_NAMES, ArsenalInkSprite, ShopPanel } from '@/features/arsenal/ShopPanel';
import { useHarbourEditor } from '@/raid/ui/useHarbourEditor';
import { UNDER_ATTACK_LINE } from '@/raid/ui/captainCopy';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import {
  buildPlacementPreview,
  usePlacement,
  type PlacementMode,
  type PlacementPreviewCell,
} from '@/state/placement';
import { stakeOfflineWager } from '@/net/offlineWager';
import { usePoints } from '@/state/points';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale, useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

/**
 * Layout, left to right on the 800-unit canvas: the dock (unplaced ships,
 * drawn at half size in their own frame so they never read as placed), the
 * row letters, the 280 board, then the shop. Classic mode has no shop and
 * centres the board; the dock keeps its place to the left of the letters.
 */
const BOARD_Y = 68;
const TRAY_W = 62;
const TRAY_H = BOARD_SIZE;
const TRAY_Y = BOARD_Y;
const TRAY_X = 6;
/** Room between the dock and the row letters. */
const TRAY_GAP = 4;
const ADVANCED_BOARD_X = TRAY_X + TRAY_W + TRAY_GAP + LABEL_MARGIN; // 96
const CLASSIC_BOARD_X = (CANVAS_W - BOARD_SIZE) / 2;
const CLASSIC_TRAY_X = CLASSIC_BOARD_X - LABEL_MARGIN - TRAY_GAP - TRAY_W;
const SHOP_X = 388;
const SHOP_Y = 62;
const SHOP_W = 400;
// Part 5: 270, not 226 — the shop now holds 11 kinds in a 3 x 4 grid
// without scrolling. See src/features/arsenal/shopGrid.ts.
const SHOP_H = 270;
/** Ships in the dock are drawn at this scale and grow to 1 as they are picked up. */
const TRAY_SCALE = 0.5;
const TRAY_HEADER = 20;
const TRAY_PITCH = 24;
/** What the dock knows about a drag: nothing, a ship in the hand, that ship over it. */
const DOCK_IDLE = 0;
const DOCK_LIVE = 1;
const DOCK_HOVER = 2;
const SPRING = { damping: 18, stiffness: 230, mass: 0.7 } as const;
const SHIP_PLACE_SOURCE = 'shipPlace' as const;

/** The fleet table from the engine — the same list autoPlaceFleet fills. */
const FLEET = makeFleet();

function parseMode(value: string | string[] | undefined): PlacementMode {
  const mode = Array.isArray(value) ? value[0] : value;
  // 'harbour' is Part 7's defence editor: the same screen with a different
  // budget, a filtered shop and a Save button.
  return mode === 'online' || mode === 'hotseat' || mode === 'harbour' ? mode : 'ai';
}

function parseRuleset(value: string | string[] | undefined): 'classic' | 'advanced' {
  const ruleset = Array.isArray(value) ? value[0] : value;
  return ruleset === 'classic' ? 'classic' : 'advanced';
}

function lightHaptic() {
  haptic('buttonPress');
}

function mediumHaptic() {
  haptic('shipPlaced');
}

function warningHaptic() {
  haptic('invalidAction');
}

interface PreviewHandle {
  show: (preview: PlacementPreviewCell | null) => void;
}

const PreviewHud = forwardRef<PreviewHandle, { boardX: number }>(function PreviewHud(
  { boardX },
  ref,
) {
  const [preview, setPreview] = useState<PlacementPreviewCell | null>(null);
  const storedReason = usePlacement((state) => state.validationReason);
  const { roughRect } = useRough();

  useImperativeHandle(ref, () => ({ show: setPreview }), []);
  const reason = preview?.reason ?? storedReason;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {preview?.conflictCells.map((index) => {
        const r = Math.floor(index / 10);
        const c = index % 10;
        const paths = roughRect(2, 2, CELL - 4, CELL - 4, {
          seed: hashString(`placement-conflict-${index}`),
          stroke: color.inkRed,
          strokeWidth: 1.25,
          fill: color.inkRed,
          fillStyle: 'hachure',
          hachureGap: 2.2,
          fillWeight: 1.15,
        });
        return (
          <Svg
            key={index}
            width={CELL}
            height={CELL}
            viewBox={`0 0 ${CELL} ${CELL}`}
            style={{ position: 'absolute', left: boardX + c * CELL, top: BOARD_Y + r * CELL }}
          >
            <RoughShape paths={paths} opacity={0.48} />
          </Svg>
        );
      })}
      {reason ? (
        <View style={[styles.reasonPill, { left: boardX + 8 }]}>
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ) : null}
    </View>
  );
});

function AlignmentBands({
  active,
  hoverRow,
  hoverCol,
  boardX,
}: {
  active: SharedValue<number>;
  hoverRow: SharedValue<number>;
  hoverCol: SharedValue<number>;
  boardX: number;
}) {
  const { roughRect } = useRough();
  const rowPaths = roughRect(1, 2, BOARD_SIZE - 2, CELL - 4, {
    seed: hashString('placement-row-band'),
    stroke: color.inkSoft,
    strokeWidth: 0.8,
    fill: color.inkSoft,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 0.85,
  });
  const colPaths = roughRect(2, 1, CELL - 4, BOARD_SIZE - 2, {
    seed: hashString('placement-col-band'),
    stroke: color.inkSoft,
    strokeWidth: 0.8,
    fill: color.inkSoft,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 0.85,
  });
  const rowStyle = useAnimatedStyle(() => ({
    opacity: active.value && hoverRow.value >= 0 ? 0.28 : 0,
    transform: [{ translateY: hoverRow.value * CELL }],
  }));
  const colStyle = useAnimatedStyle(() => ({
    opacity: active.value && hoverCol.value >= 0 ? 0.2 : 0,
    transform: [{ translateX: hoverCol.value * CELL }],
  }));

  return (
    <View pointerEvents="none" style={[styles.bandLayer, { left: boardX }]}>
      <Animated.View style={[styles.rowBand, rowStyle]}>
        <Svg width={BOARD_SIZE} height={CELL} viewBox={`0 0 ${BOARD_SIZE} ${CELL}`}>
          <RoughShape paths={rowPaths} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.colBand, colStyle]}>
        <Svg width={CELL} height={BOARD_SIZE} viewBox={`0 0 ${CELL} ${BOARD_SIZE}`}>
          <RoughShape paths={colPaths} />
        </Svg>
      </Animated.View>
    </View>
  );
}

function FuelGauge({
  spent,
  budget,
  shakeNonce,
  /** Part 7 §2.1 — "Harbour fuel 74 / 90" in the defence editor. */
  caption = 'Fuel',
}: {
  spent: number;
  budget: number;
  shakeNonce: number;
  caption?: string;
}) {
  const remaining = Math.max(0, budget - spent);
  const reduceMotion = useReducedMotion();
  const shake = useSharedValue(0);
  const roll = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    roll.value = -6;
    roll.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [reduceMotion, remaining, roll]);

  useEffect(() => {
    if (shakeNonce === 0 || reduceMotion) return;
    shake.value = withSequence(
      withTiming(-3, { duration: 36 }),
      withTiming(3, { duration: 36 }),
      withTiming(-3, { duration: 36 }),
      withTiming(3, { duration: 36 }),
      withTiming(0, { duration: 36 }),
    );
  }, [reduceMotion, shake, shakeNonce]);

  const gaugeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const numberStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.35, Math.abs(roll.value) / 20),
    transform: [{ translateY: roll.value }],
  }));

  // Was an ink barrel beside a filling bar. The barrel read as a mailbox and
  // the bar read as a health meter, so the number people actually needed —
  // fuel left to spend — was the least legible thing on the strip. It is a
  // plain readout now; the shake on an unaffordable buy is kept.
  return (
    <Animated.View
      style={[styles.fuelGauge, gaugeStyle]}
      accessibilityLabel={`${remaining} of ${budget} ${caption.toLowerCase()} remaining`}
    >
      <Text style={styles.fuelCaption}>{caption}</Text>
      <Animated.View style={numberStyle}>
        <Text style={styles.fuelReadout}>
          <Text style={remaining === 0 ? styles.fuelReadoutEmpty : undefined}>{remaining}</Text>
          <Text style={styles.fuelReadoutBudget}>{` / ${budget}`}</Text>
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

function ArsenalFrame({ onUnaffordable }: { onUnaffordable: () => void }) {
  return (
    <InkPanel w={SHOP_W} h={SHOP_H} seedKey="placement-arsenal" padding={0}>
      <ShopPanel onUnaffordable={onUnaffordable} />
    </InkPanel>
  );
}

interface DraggableShipProps {
  fleetIndex: number;
  shipId: string;
  shipClass: ShipClass;
  ships: ReturnType<typeof usePlacement.getState>['ships'];
  arsenal: ReturnType<typeof usePlacement.getState>['arsenal'];
  boardX: number;
  trayX: number;
  activeBand: SharedValue<number>;
  hoverRow: SharedValue<number>;
  hoverCol: SharedValue<number>;
  /** DOCK_IDLE / DOCK_LIVE / DOCK_HOVER — what the dock shows during the drag. */
  dockDrag: SharedValue<number>;
  previewRef: React.RefObject<PreviewHandle | null>;
}

const DraggableShip = memo(function DraggableShip({
  fleetIndex,
  shipId,
  shipClass,
  ships,
  arsenal,
  boardX,
  trayX,
  activeBand,
  hoverRow,
  hoverCol,
  dockDrag,
  previewRef,
}: DraggableShipProps) {
  const { scale, ox, oy } = useScale();
  const reduceMotion = useReducedMotion();
  // Tutorial: lets the overlay spotlight and point at this ship (`ship-<id>`).
  const tutorialTarget = useTutorialTarget(`ship-${shipId}`);
  const placed = ships.find((ship) => ship.id === shipId);
  const orientation: Orientation = placed?.orientation ?? 'h';
  const size = shipSpriteSize(shipClass, orientation);
  // In the dock the sprite is drawn at TRAY_SCALE about its own centre, so the
  // box is offset to put the SCALED ship's bow at the dock's left margin.
  const dockLeft = trayX + 5;
  const dockTop = TRAY_Y + TRAY_HEADER + 6 + fleetIndex * TRAY_PITCH;
  const baseX = placed
    ? boardX + placed.origin.c * CELL
    : dockLeft - (size.width * (1 - TRAY_SCALE)) / 2;
  const baseY = placed
    ? BOARD_Y + placed.origin.r * CELL
    : dockTop - (size.height * (1 - TRAY_SCALE)) / 2;
  const hitW = Math.max(size.width, 44 / scale);
  const hitH = Math.max(size.height, 44 / scale);
  const padX = (hitW - size.width) / 2;
  const padY = (hitH - size.height) / 2;
  const seaId = usePlacement((state) => state.seaId);
  const previews = useMemo(
    () => buildPlacementPreview(ships, arsenal, shipId, orientation, terrainForSea(seaId)),
    [arsenal, orientation, shipId, seaId, ships],
  );
  // The worklets read the store's truth through shared values and refs, never
  // through their render closure: a ship that moved a moment ago must be gone
  // from every other ship's lookup by the time the next drag starts.
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const validMap = useSharedValue<readonly number[]>(previews.map((p) => (p.ok ? 1 : 0)));
  const placedIndex = placed ? placed.origin.r * 10 + placed.origin.c : -1;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  /** 1 while a gesture owns the ship — the drag's real lifecycle. */
  const held = useSharedValue(0);
  /** The visual lift only (scale, shadow); springs back after a drop. */
  const lifted = useSharedValue(0);
  /** TRAY_SCALE in the dock, 1 on the board and in the hand. */
  const shipScale = useSharedValue(placed ? 1 : TRAY_SCALE);
  const valid = useSharedValue(1);
  const hoverIndex = useSharedValue(-1);
  const lastNotifiedIndex = useSharedValue(-2);
  const overTray = useSharedValue(placed ? 0 : 1);
  const shake = useSharedValue(0);

  useEffect(() => {
    validMap.value = previews.map((preview) => (preview.ok ? 1 : 0));
  }, [previews, validMap]);

  // The store moved this ship (drop, rotate, shuffle, reset): its box is now
  // at the new cell, so the drag offset that carried it there goes back to 0.
  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [baseX, baseY, orientation, translateX, translateY]);

  // Dock ships are small; a ship put back in the dock shrinks again.
  useEffect(() => {
    if (held.value) return;
    shipScale.value = withTiming(placed ? 1 : TRAY_SCALE, { duration: 160 });
  }, [held, placed, shipScale]);

  const showPreview = useCallback(
    (index: number) =>
      previewRef.current?.show(index >= 0 ? (previewsRef.current[index] ?? null) : null),
    [previewRef],
  );

  const springHome = useCallback(() => {
    translateX.value = reduceMotion ? 0 : withSpring(0, SPRING);
    translateY.value = reduceMotion ? 0 : withSpring(0, SPRING);
    previewRef.current?.show(null);
  }, [previewRef, reduceMotion, translateX, translateY]);

  const commitDrop = useCallback(
    (r: number, c: number) => {
      const result = usePlacement.getState().placeAt(shipId, { r, c }, orientation);
      previewRef.current?.show(null);
      if (result.ok) {
        mediumHaptic();
        playSfx(SHIP_PLACE_SOURCE);
        // The box moves to the new cell on the re-render this triggers, and
        // the effect above clears the offset in the same pass — no snap back.
        return;
      }
      warningHaptic();
      playSfx('shipInvalid');
      if (!placed) shipScale.value = withSpring(TRAY_SCALE, SPRING);
      springHome();
    },
    [orientation, placed, previewRef, shipId, shipScale, springHome],
  );

  const unplace = useCallback(() => {
    if (placed && usePlacement.getState().remove(shipId).ok) {
      // Back in the tray: the box moves there and the effect clears the offset.
      previewRef.current?.show(null);
      return;
    }
    springHome();
  }, [placed, previewRef, shipId, springHome]);

  const rejectDrop = useCallback(
    (index: number) => {
      const reason =
        previewsRef.current[index]?.reason ?? 'drop the ship on an open part of the board';
      usePlacement.getState().setValidationReason(reason);
      warningHaptic();
      playSfx('shipInvalid');
      springHome();
    },
    [springHome],
  );

  const tapToRotate = useCallback(() => {
    if (!placed) return;
    const result = usePlacement.getState().rotate(shipId);
    if (result.ok) {
      playSfx(SHIP_PLACE_SOURCE);
      previewRef.current?.show(null);
      return;
    }
    warningHaptic();
    playSfx('shipInvalid');
    if (!reduceMotion) {
      shake.value = withSequence(
        withTiming(-3, { duration: 36 }),
        withTiming(3, { duration: 36 }),
        withTiming(-3, { duration: 36 }),
        withTiming(3, { duration: 36 }),
        withTiming(0, { duration: 36 }),
      );
    }
  }, [placed, previewRef, reduceMotion, shake, shipId]);

  const beginPickup = (absoluteX: number, absoluteY: number) => {
    'worklet';
    if (held.value) return;
    held.value = 1;
    lifted.value = 1;
    // The finger is on the sprite as drawn — in the dock, at TRAY_SCALE about
    // the box centre. Map it to the full-size sprite the drag works in, so the
    // ship stays under the finger as it grows to 1.
    const s = shipScale.value;
    const boxX = baseX + translateX.value;
    const boxY = baseY + translateY.value;
    const cx = boxX + size.width / 2;
    const cy = boxY + size.height / 2;
    const px = (absoluteX - ox) / scale;
    const py = (absoluteY - oy) / scale;
    grabX.value = cx + (px - cx) / s - boxX;
    grabY.value = cy + (py - cy) / s - boxY;
    shipScale.value = withTiming(1, { duration: 140 });
    overTray.value = placed ? 0 : 1;
    dockDrag.value = placed ? DOCK_LIVE : DOCK_HOVER;
    activeBand.value = 1;
    if (placed) {
      hoverRow.value = placed.origin.r;
      hoverCol.value = placed.origin.c;
      hoverIndex.value = placedIndex;
      valid.value = validMap.value[placedIndex] ?? 1;
      lastNotifiedIndex.value = placedIndex;
      runOnJS(showPreview)(placedIndex);
    } else {
      hoverRow.value = -1;
      hoverCol.value = -1;
      hoverIndex.value = -1;
      valid.value = 0;
      lastNotifiedIndex.value = -1;
    }
    runOnJS(lightHaptic)();
  };

  /**
   * Ends the drag. Runs once per pickup (`held` is the guard) and ONLY from
   * the pan's finalize — see the wiring below. A ship dropped where it was
   * picked up simply settles: no store write, no sound.
   */
  const finishDrag = () => {
    'worklet';
    if (!held.value) return;
    held.value = 0;
    const index = hoverIndex.value;
    const shouldUnplace = overTray.value === 1;
    lifted.value = withSpring(0, SPRING);
    activeBand.value = 0;
    dockDrag.value = DOCK_IDLE;
    hoverRow.value = -1;
    hoverCol.value = -1;
    hoverIndex.value = -1;
    lastNotifiedIndex.value = -2;

    if (shouldUnplace) {
      // A dock ship let go over the dock shrinks back where it was; a placed
      // one leaves the store and the effect above shrinks it in its new spot.
      if (placedIndex < 0) shipScale.value = withSpring(TRAY_SCALE, SPRING);
      runOnJS(unplace)();
      return;
    }
    if (index >= 0 && index === placedIndex) {
      runOnJS(springHome)();
      return;
    }
    if (index >= 0 && valid.value === 1) {
      runOnJS(commitDrop)(Math.floor(index / 10), index % 10);
      return;
    }
    if (placedIndex < 0) shipScale.value = withSpring(TRAY_SCALE, SPRING);
    runOnJS(rejectDrop)(index);
  };

  // Pan and long-press run together so either can pick the ship up, but only
  // the pan ends a drag. The long-press FAILS — and still finalizes — the
  // moment the finger passes its maxDistance, even after it has activated,
  // and on the very move that activates the pan it can finalize FIRST: had
  // it ended the drag there, the pan would re-grab a ship already springing
  // home and drop it a cell off. The pan's finalize fires at touch-up whether
  // or not the pan ever activated, so a pure long-press release ends there too.
  const pan = Gesture.Pan()
    .minDistance(3)
    .shouldCancelWhenOutside(false)
    .onStart((event) => beginPickup(event.absoluteX, event.absoluteY))
    .onUpdate((event) => {
      if (!held.value) return;
      const canvasX = (event.absoluteX - ox) / scale;
      const canvasY = (event.absoluteY - oy) / scale;
      const desiredX = canvasX - grabX.value;
      const desiredY = canvasY - grabY.value;
      const candidateC = Math.round((desiredX - boardX) / CELL);
      const candidateR = Math.round((desiredY - BOARD_Y) / CELL);
      const nearBoard = candidateC >= 0 && candidateC < 10 && candidateR >= 0 && candidateR < 10;

      // Over the dock = the ship's own centre carried left of the row letters.
      // Judged from the ship, not the raw finger, so it holds on devices whose
      // window coordinates carry an inset offset.
      const shipCentreX = desiredX + size.width / 2;
      overTray.value =
        shipCentreX < boardX - LABEL_MARGIN &&
        desiredY + size.height / 2 >= TRAY_Y - 20 &&
        desiredY + size.height / 2 <= TRAY_Y + TRAY_H + 20
          ? 1
          : 0;
      // Written on the crossing only: the dock's frames animate off this value.
      const dock = overTray.value ? DOCK_HOVER : DOCK_LIVE;
      if (dockDrag.value !== dock) dockDrag.value = dock;

      if (nearBoard) {
        const index = candidateR * 10 + candidateC;
        translateX.value = boardX + candidateC * CELL - baseX;
        translateY.value = BOARD_Y + candidateR * CELL - baseY;
        hoverRow.value = candidateR;
        hoverCol.value = candidateC;
        hoverIndex.value = index;
        valid.value = validMap.value[index] ?? 0;
        if (lastNotifiedIndex.value !== index) {
          lastNotifiedIndex.value = index;
          runOnJS(showPreview)(index);
        }
      } else {
        translateX.value = desiredX - baseX;
        translateY.value = desiredY - baseY;
        hoverRow.value = -1;
        hoverCol.value = -1;
        hoverIndex.value = -1;
        valid.value = 0;
        if (lastNotifiedIndex.value !== -1) {
          lastNotifiedIndex.value = -1;
          runOnJS(showPreview)(-1);
        }
      }
    })
    .onFinalize(finishDrag);

  const longPress = Gesture.LongPress()
    .minDuration(120)
    .maxDistance(10)
    .shouldCancelWhenOutside(false)
    .onStart((event) => beginPickup(event.absoluteX, event.absoluteY));

  const tap = Gesture.Tap()
    .maxDistance(5)
    .onEnd((_event, success) => {
      if (success) runOnJS(tapToRotate)();
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pan, longPress), tap);
  const wrapperStyle = useAnimatedStyle(() => ({
    zIndex: lifted.value ? 30 : 3,
    transform: [
      { translateX: translateX.value + shake.value },
      { translateY: translateY.value },
      { scale: 1 + lifted.value * 0.06 },
    ],
  }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: lifted.value * 0.38 }));
  const groupStyle = useAnimatedStyle(() => ({ transform: [{ scale: shipScale.value }] }));
  // The paper hull lifts away with the ship so the grid and any conflict tint
  // show through a hovering ghost, and settles back under it on the drop.
  // Tray ships get none: they sit over the row letters, which must stay legible.
  const backingStyle = useAnimatedStyle(() => ({
    opacity: placed ? Math.max(0, 1 - lifted.value) : 0,
  }));
  const inkStyle = useAnimatedStyle(() => ({
    opacity: held.value && hoverIndex.value >= 0 && valid.value === 0 ? 0.2 : 1,
  }));
  const redStyle = useAnimatedStyle(() => ({
    opacity: held.value && hoverIndex.value >= 0 && valid.value === 0 ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        ref={tutorialTarget.ref}
        onLayout={tutorialTarget.onLayout}
        accessibilityRole="button"
        accessibilityLabel={`${shipClass} ${placed ? 'placed' : 'in tray'}. Tap to rotate or drag to move.`}
        style={[
          styles.draggable,
          { left: baseX - padX, top: baseY - padY, width: hitW, height: hitH },
          wrapperStyle,
        ]}
      >
        {/* The hit box is padded out to 44 px; the group is absolute, so it is
            placed at the pad explicitly — Yoga puts absolute children at the
            padding edge, not inside it. The group carries the dock scale. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shipGroup,
            { left: padX, top: padY, width: size.width, height: size.height },
            groupStyle,
          ]}
        >
          <Animated.View style={[styles.shipLayer, styles.shipShadow, shadowStyle]}>
            <ShipSprite
              shipClass={shipClass}
              orientation={orientation}
              stroke={color.inkSoft}
              backing={false}
            />
          </Animated.View>
          <Animated.View style={[styles.shipLayer, backingStyle]}>
            <ShipBacking shipClass={shipClass} orientation={orientation} />
          </Animated.View>
          <Animated.View style={[styles.shipLayer, inkStyle]}>
            <ShipSprite shipClass={shipClass} orientation={orientation} backing={false} />
          </Animated.View>
          <Animated.View style={[styles.shipLayer, redStyle]}>
            <ShipSprite
              shipClass={shipClass}
              orientation={orientation}
              stroke={color.inkRed}
              backing={false}
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

function LegalCellHighlights({ boardX, cells }: { boardX: number; cells: readonly number[] }) {
  const { roughRect } = useRough();
  const hatch = roughRect(2, 2, CELL - 4, CELL - 4, {
    seed: hashString('legal-arsenal-cell'),
    stroke: color.inkGreen,
    strokeWidth: 0.65,
    fill: color.inkGreen,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 0.75,
  });
  return (
    <Svg
      pointerEvents="none"
      width={BOARD_SIZE}
      height={BOARD_SIZE}
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      style={{ position: 'absolute', left: boardX, top: BOARD_Y }}
    >
      {cells.map((index) => (
        <G
          key={index}
          transform={`translate(${(index % 10) * CELL} ${Math.floor(index / 10) * CELL})`}
        >
          <RoughShape paths={hatch} opacity={0.38} />
        </G>
      ))}
    </Svg>
  );
}

const DraggableArsenal = memo(function DraggableArsenal({
  item,
  boardX,
  ships,
  arsenal,
  activeBand,
  hoverRow,
  hoverCol,
}: {
  item: ArsenalItem & { at: NonNullable<ArsenalItem['at']> };
  boardX: number;
  ships: ReturnType<typeof usePlacement.getState>['ships'];
  arsenal: ReturnType<typeof usePlacement.getState>['arsenal'];
  activeBand: SharedValue<number>;
  hoverRow: SharedValue<number>;
  hoverCol: SharedValue<number>;
}) {
  const { scale, ox, oy } = useScale();
  const reduceMotion = useReducedMotion();
  const baseX = boardX + item.at.c * CELL;
  const baseY = BOARD_Y + item.at.r * CELL;
  const hit = Math.max(CELL, 44 / scale);
  const pad = (hit - CELL) / 2;
  const validity = useMemo(
    () =>
      Array.from({ length: 100 }, (_, index) =>
        validateArsenalPlacement(
          { ...emptyBoard(), ships, arsenal },
          { ...item, at: { r: Math.floor(index / 10), c: index % 10 } },
        ).ok
          ? 1
          : 0,
      ),
    [arsenal, item, ships],
  );
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const hoverIndex = useSharedValue(item.at.r * 10 + item.at.c);
  const valid = useSharedValue(1);

  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
  }, [baseX, baseY, tx, ty]);

  const move = useCallback(
    (index: number) => {
      const result = usePlacement
        .getState()
        .moveArsenal(item.id, { r: Math.floor(index / 10), c: index % 10 });
      if (result.ok) {
        mediumHaptic();
        playSfx(SHIP_PLACE_SOURCE);
      }
      tx.value = 0;
      ty.value = 0;
    },
    [item.id, tx, ty],
  );

  const reject = useCallback(() => {
    usePlacement.getState().setValidationReason('cell is occupied');
    warningHaptic();
    playSfx('shipInvalid');
  }, []);

  const sell = useCallback(() => {
    usePlacement.getState().sellArsenal(item.id);
  }, [item.id]);

  const pan = Gesture.Pan()
    .minDistance(2)
    .shouldCancelWhenOutside(false)
    .onStart((event) => {
      lifted.value = 1;
      grabX.value = (event.absoluteX - ox) / scale - (baseX + tx.value);
      grabY.value = (event.absoluteY - oy) / scale - (baseY + ty.value);
      activeBand.value = 1;
      hoverRow.value = item.at.r;
      hoverCol.value = item.at.c;
      runOnJS(lightHaptic)();
    })
    .onUpdate((event) => {
      const desiredX = (event.absoluteX - ox) / scale - grabX.value;
      const desiredY = (event.absoluteY - oy) / scale - grabY.value;
      const c = Math.round((desiredX - boardX) / CELL);
      const r = Math.round((desiredY - BOARD_Y) / CELL);
      if (r >= 0 && r < 10 && c >= 0 && c < 10) {
        const index = r * 10 + c;
        tx.value = boardX + c * CELL - baseX;
        ty.value = BOARD_Y + r * CELL - baseY;
        hoverIndex.value = index;
        hoverRow.value = r;
        hoverCol.value = c;
        valid.value = validity[index] ?? 0;
      } else {
        tx.value = desiredX - baseX;
        ty.value = desiredY - baseY;
        hoverIndex.value = -1;
        hoverRow.value = -1;
        hoverCol.value = -1;
        valid.value = 0;
      }
    })
    .onFinalize(() => {
      lifted.value = withSpring(0, SPRING);
      activeBand.value = 0;
      hoverRow.value = -1;
      hoverCol.value = -1;
      if (hoverIndex.value >= 0 && valid.value === 1) {
        runOnJS(move)(hoverIndex.value);
      } else {
        tx.value = reduceMotion ? 0 : withSpring(0, SPRING);
        ty.value = reduceMotion ? 0 : withSpring(0, SPRING);
        runOnJS(reject)();
      }
    });
  const longPress = Gesture.LongPress()
    .minDuration(480)
    .maxDistance(8)
    .onStart(() => runOnJS(sell)());
  const gesture = Gesture.Race(pan, longPress);
  const animated = useAnimatedStyle(() => ({
    zIndex: lifted.value ? 35 : 5,
    opacity: valid.value || !lifted.value ? 1 : 0.55,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + lifted.value * 0.06 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`${item.kind}. Drag to move or hold to sell.`}
        style={[
          styles.arsenalDrag,
          { left: baseX - pad, top: baseY - pad, width: hit, height: hit },
          animated,
        ]}
      >
        {/* Absolute child: placed at the pad by hand, as in DraggableShip. */}
        <View style={[styles.arsenalSpriteOnBoard, { left: pad - 7, top: pad - 7 }]}>
          <ArsenalInkSprite kind={item.kind} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

function PulsingBattleButton({
  enabled,
  label = 'Battle!',
  onPress,
}: {
  enabled: boolean;
  label?: string;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = 1;
    if (!enabled || reduceMotion) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.035, { duration: 150, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 250, easing: Easing.inOut(Easing.cubic) }),
        withDelay(2600, withTiming(1, { duration: 0 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [enabled, pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[styles.battleButton, style]}>
      <InkButton
        label={label}
        tone="confirm"
        size="xl"
        w={148}
        h={60}
        disabled={!enabled}
        onPress={onPress}
      />
    </Animated.View>
  );
}

const DIFFICULTIES: readonly { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

function DifficultyPicker({ value }: { value: Difficulty }) {
  return (
    <View style={styles.difficultyPicker} accessibilityRole="radiogroup">
      <Text style={styles.difficultyLabel}>AI:</Text>
      {DIFFICULTIES.map((option) => (
        <InkButton
          key={option.value}
          label={option.label}
          tone={value === option.value ? 'confirm' : 'ink'}
          size="sm"
          w={74}
          h={40}
          seedKey={`difficulty-${option.value}`}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option.value }}
          onPress={() => usePlacement.getState().setDifficulty(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * Part 10A — one captain, priced in fuel out of the same 260. The full
 * Officers' Club roster screen is not built; this is the placement-flow picker:
 * tap to cycle through none and the six captains, and the store refuses one
 * that does not fit the budget (or Classic).
 */
const CAPTAIN_CYCLE: readonly (CaptainId | null)[] = [
  null,
  'berhan',
  'mara',
  'ivo',
  'tomas',
  'rosa',
  'oldCaptain',
];

function CaptainPicker() {
  const captainId = usePlacement((state) => state.captainId);
  const spec = captainId ? CAPTAINS.find((captain) => captain.id === captainId) : null;
  const short = spec ? spec.name.split(',')[0]!.replace('The ', '').slice(0, 8) : null;
  const label = short ? `⚓ ${short} ${spec?.fuel}` : '⚓ none';
  return (
    <View style={styles.captainPicker}>
      <InkButton
        label={label}
        tone={captainId ? 'confirm' : 'ink'}
        size="sm"
        w={76}
        h={42}
        seedKey="placement-captain"
        accessibilityLabel={`Captain: ${spec?.name ?? 'none'}. Tap to change.`}
        onPress={() => {
          const index = CAPTAIN_CYCLE.indexOf(captainId);
          const next = CAPTAIN_CYCLE[(index + 1) % CAPTAIN_CYCLE.length] ?? null;
          usePlacement.getState().setCaptain(next);
        }}
      />
    </View>
  );
}

/**
 * Part 10B — the sea picker. Only shown when the Lighthouse has unlocked more
 * than Open Sea (ranked shows just the season sea, so the control collapses to
 * a label there). Everything that follows — placement legality, the board art
 * and the AI — comes from the store's sea.
 */
function SeaPicker() {
  const seaId = usePlacement((state) => state.seaId);
  const unlockedSeas = usePlacement((state) => state.unlockedSeas);
  const name = seaSpec(seaId).name;
  if (unlockedSeas.length <= 1) {
    return (
      <View style={styles.seaPicker}>
        <InkButton
          label={name.slice(0, 11)}
          size="sm"
          w={84}
          h={42}
          seedKey="placement-sea"
          accessibilityLabel={`Sea: ${name}.`}
          onPress={() => {}}
        />
      </View>
    );
  }
  return (
    <View style={styles.seaPicker}>
      <InkButton
        label={name.slice(0, 11)}
        tone={seaId === 'open' ? 'ink' : 'confirm'}
        size="sm"
        w={84}
        h={42}
        seedKey="placement-sea"
        accessibilityLabel={`Sea: ${name}. Tap to change.`}
        onPress={() => {
          const index = unlockedSeas.indexOf(seaId);
          const next = unlockedSeas[(index + 1) % unlockedSeas.length] ?? 'open';
          usePlacement.getState().setSea(next);
        }}
      />
    </View>
  );
}

/**
 * The dock: a dashed rough frame left of the row letters holding the ships
 * still to be placed (drawn at half size by DraggableShip), with a running
 * count so a missed ship is never mistaken for a placed one.
 *
 * It is also where a placed ship goes back to, so it answers the drag. The
 * frame used to fade to inkFaint as soon as the fleet was complete — which
 * is exactly the state while a ship is being carried back, so the one place
 * that would take it looked disabled until the drop had landed. The faint
 * frame is now for an idle, complete dock only: a ship in the hand keeps it
 * in ink, and a ship over it turns it green with "Drop here".
 */
function TrayDock({
  x,
  remaining,
  drag,
}: {
  x: number;
  remaining: number;
  drag: SharedValue<number>;
}) {
  const { roughRect } = useRough();
  const reduceMotion = useReducedMotion();
  const seed = hashString('placement-dock');
  // One opaque paper fill under three stroke-only frames that cross-fade, so
  // the sheet's grid never shows through mid-fade.
  const sheet = roughRect(1.5, 1.5, TRAY_W - 3, TRAY_H - 3, {
    seed,
    stroke: 'none',
    roughness: 1.2,
    fill: color.paper,
    fillStyle: 'solid',
  });
  const faintFrame = roughRect(1.5, 1.5, TRAY_W - 3, TRAY_H - 3, {
    seed,
    stroke: color.inkFaint,
    strokeWidth: 1.3,
    roughness: 1.2,
  });
  const inkFrame = roughRect(1.5, 1.5, TRAY_W - 3, TRAY_H - 3, {
    seed,
    stroke: color.ink,
    strokeWidth: 1.3,
    roughness: 1.2,
  });
  const hoverFrame = roughRect(1.5, 1.5, TRAY_W - 3, TRAY_H - 3, {
    seed,
    stroke: color.inkGreen,
    strokeWidth: 2,
    roughness: 1.2,
    fill: color.inkGreen,
    fillStyle: 'hachure',
    hachureGap: 4.5,
    fillWeight: 0.7,
  });
  const fade = { duration: reduceMotion ? 0 : 120 };
  const faintStyle = useAnimatedStyle(() => ({
    opacity: withTiming(remaining === 0 && drag.value === DOCK_IDLE ? 1 : 0, fade),
  }));
  const inkStyle = useAnimatedStyle(() => ({
    opacity: withTiming(
      drag.value === DOCK_HOVER ? 0 : remaining > 0 || drag.value === DOCK_LIVE ? 1 : 0,
      fade,
    ),
  }));
  const hoverStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 1 : 0, fade),
  }));
  const countStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 0 : 1, fade),
  }));
  const dropStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 1 : 0, fade),
  }));

  return (
    <View pointerEvents="none" style={[styles.dock, { left: x }]}>
      <Svg width={TRAY_W} height={TRAY_H} viewBox={`0 0 ${TRAY_W} ${TRAY_H}`}>
        <RoughShape paths={sheet} opacity={0.9} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, faintStyle]}>
        <Svg width={TRAY_W} height={TRAY_H} viewBox={`0 0 ${TRAY_W} ${TRAY_H}`}>
          <RoughShape paths={faintFrame} dash={[5, 4]} opacity={0.9} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, inkStyle]}>
        <Svg width={TRAY_W} height={TRAY_H} viewBox={`0 0 ${TRAY_W} ${TRAY_H}`}>
          <RoughShape paths={inkFrame} dash={[5, 4]} opacity={0.9} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, hoverStyle]}>
        <Svg width={TRAY_W} height={TRAY_H} viewBox={`0 0 ${TRAY_W} ${TRAY_H}`}>
          <RoughShape paths={hoverFrame} dash={[5, 4]} opacity={0.9} />
        </Svg>
      </Animated.View>
      <Text style={styles.dockTitle}>Dock</Text>
      <Animated.Text
        style={[styles.dockCount, remaining === 0 && styles.dockCountDone, countStyle]}
      >
        {remaining === 0 ? 'All placed' : `${remaining} to place`}
      </Animated.Text>
      <Animated.Text style={[styles.dockCount, styles.dockCountDone, dropStyle]}>
        Drop here
      </Animated.Text>
    </View>
  );
}

/**
 * Shuffle and Reset with defences on the board: the new layout cannot keep
 * them, so they are sold back first — say so, name the refund, and let the
 * player back out. Bought bombers, torpedoes and the submarine are untouched.
 */
function ConfirmClearDialog({
  action,
  placed,
  refund,
  onCancel,
  onConfirm,
}: {
  action: 'shuffle' | 'reset';
  placed: readonly ArsenalItem[];
  refund: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  const counts = new Map<ArsenalKind, number>();
  for (const item of placed) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const names = ARSENAL_SPEC.filter((spec) => counts.has(spec.kind)).map((spec) => {
    const n = counts.get(spec.kind) ?? 0;
    const name = ARSENAL_NAMES[spec.kind];
    return n === 1 ? `the ${name}` : `${n} ${name}s`;
  });
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = action === 'shuffle' ? 'Shuffling' : 'Clearing the board';
  const their = placed.length === 1 ? 'Its' : 'Their';

  return (
    <View style={styles.dialogRoot} accessibilityViewIsModal>
      <Pressable style={styles.dialogDim} onPress={onCancel} accessibilityLabel="Cancel" />
      <View style={styles.dialogPanel}>
        <InkPanel w={400} h={172} seedKey="placement-clear" padding={space.sm}>
          <Text style={styles.dialogTitle}>
            {action === 'shuffle' ? 'Shuffle the fleet?' : 'Clear the board?'}
          </Text>
          <Text style={styles.dialogBody}>
            {verb} takes {list} off the board too. {their} {refund} fuel goes back to your gauge;
            the bombers and torpedoes you bought stay yours.
          </Text>
          <View style={styles.dialogButtons}>
            <InkButton label="Keep them" size="sm" w={120} h={40} onPress={onCancel} />
            <InkButton
              label={action === 'shuffle' ? 'Shuffle anyway' : 'Clear anyway'}
              tone="confirm"
              size="sm"
              w={150}
              h={40}
              onPress={onConfirm}
            />
          </View>
        </InkPanel>
      </View>
    </View>
  );
}

function HandoffCurtain({ name, onReady }: { name: string; onReady: () => void }) {
  return (
    <View style={styles.handoff} accessibilityViewIsModal>
      <Paper variant="full" />
      <View style={styles.handoffCopy}>
        <Text style={styles.handoffEyebrow}>Pass the device</Text>
        <Text style={styles.handoffTitle}>{name}&apos;s turn</Text>
        <Text style={styles.handoffBody}>Tap Ready when only {name} can see the screen.</Text>
        <InkButton label="Ready" tone="confirm" size="lg" w={150} onPress={onReady} />
      </View>
    </View>
  );
}

/**
 * `tutorial` hides every control that would end or derail the lesson. The
 * overlay cannot do it: a drag step has to leave the whole screen tappable
 * (`inputRect` returns 'all'), so its tap-guards are down exactly when the
 * dock, the board and all of this chrome are live at once. Without this a
 * player could tap Battle! mid-lesson and land in a real AI match, or take
 * the back arrow and leave the tutorial unfinished — `markTutorialComplete`
 * never runs, so it would greet them again on the next launch.
 * The shop stays: the lesson's `place-item` beats need it.
 */
function PlacementCanvas({ tutorial = false }: { tutorial?: boolean }) {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string | string[];
    ruleset?: string | string[];
    wager?: string | string[];
  }>();
  const mode = parseMode(params.mode);
  const requestedRuleset = parseRuleset(params.ruleset);
  const requestedWager = (Array.isArray(params.wager) ? params.wager[0] : params.wager) === '1';
  const sessionSeed = useRef((Date.now() ^ 0x5ea71e) >>> 0);
  const shuffleSeed = useRef(sessionSeed.current + 1);
  const previewRef = useRef<PreviewHandle>(null);
  const [fuelShakeNonce, setFuelShakeNonce] = useState(0);
  const [wagered, setWagered] = useState(requestedWager);
  /** The offline stake is in flight — Battle! stays down until it lands. */
  const [staking, setStaking] = useState(false);
  const activeBand = useSharedValue(0);
  const hoverRow = useSharedValue(-1);
  const hoverCol = useSharedValue(-1);
  const dockDrag = useSharedValue(DOCK_IDLE);

  const ships = usePlacement((state) => state.ships);
  const arsenal = usePlacement((state) => state.arsenal);
  const fuelSpent = usePlacement((state) => state.fuelSpent);
  const fuelBudget = usePlacement((state) => state.fuelBudget);
  const fuelLabel = usePlacement((state) => state.fuelLabel);
  const captainId = usePlacement((state) => state.captainId);
  const seaId = usePlacement((state) => state.seaId);
  const ruleset = usePlacement((state) => state.ruleset);
  const difficulty = usePlacement((state) => state.difficulty);
  const pendingArsenalId = usePlacement((state) => state.pendingArsenalId);
  const hotseatPlayer = usePlacement((state) => state.hotseatPlayer);
  const handoffVisible = usePlacement((state) => state.handoffVisible);
  const playerTwoName = usePlacement((state) => state.playerTwoName);
  const pointBalance = usePoints((state) => state.balance);
  const pointsReady = usePoints((state) => state.ready);

  const harbour = mode === 'harbour';
  const { readOnly, saving, saveError, saveHarbourLayout, dismissSaveError } = useHarbourEditor(
    harbour,
    sessionSeed.current,
  );

  useEffect(() => {
    // The harbour editor sets itself up in useHarbourEditor, which needs the
    // server's levels before it knows the budget. Everything else initialises
    // straight away, exactly as it did.
    if (harbour) return;
    let cancelled = false;
    const start = async () => {
      // Part 10B — non-ranked play is gated by the Lighthouse; ranked plays
      // the season sea from /config and ignores the Lighthouse entirely
      // (the integrity rule). The sea has to be known before the first autoplace,
      // or the layout can be illegal where the match will actually be played.
      let unlockedSeas: readonly SeaId[] = ['open'];
      let seaId: SeaId = 'open';
      if (mode === 'online') {
        await loadFlags();
        const season = seasonSea();
        if (season && isSeaId(season.id)) {
          seaId = season.id;
          unlockedSeas = [season.id];
        }
      } else {
        const lighthouse =
          (useCity.getState().snapshot?.city?.buildings as Record<string, { level?: number }> | undefined)
            ?.lighthouse?.level ?? 0;
        unlockedSeas = unlockedSeasFor(lighthouse);
      }
      if (cancelled) return;
      usePlacement
        .getState()
        .initialize(mode, sessionSeed.current, requestedRuleset, { unlockedSeas, seaId });
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [harbour, mode, requestedRuleset]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (usePlacement.getState().pendingArsenalId) usePlacement.getState().cancelPendingArsenal();
      // In the tutorial the only way out is the overlay's Skip, which ends the
      // lesson properly. Swallow the press rather than dropping out half-taught.
      else if (!tutorial) router.back();
      return true;
    });
    return () => subscription.remove();
  }, [router]);

  const boardX = ruleset === 'classic' ? CLASSIC_BOARD_X : ADVANCED_BOARD_X;
  const trayX = ruleset === 'classic' ? CLASSIC_TRAY_X : TRAY_X;
  const pendingItem = arsenal.find((item) => item.id === pendingArsenalId);
  // Defences on the board (or one being placed) that Shuffle / Reset would sell back.
  const placedArsenal = useMemo(
    () =>
      arsenal.filter(
        (item) => isOwnBoardKind(item.kind) && (item.at !== undefined || item.id === pendingArsenalId),
      ),
    [arsenal, pendingArsenalId],
  );
  const placedRefund = placedArsenal.reduce((sum, item) => sum + specFor(item.kind).cost, 0);
  const [confirmClear, setConfirmClear] = useState<'shuffle' | 'reset' | null>(null);
  const legalArsenalCells = useMemo(() => {
    if (!pendingItem) return [];
    const board = { ...emptyBoard(), ships, arsenal };
    return Array.from({ length: 100 }, (_, index) => index).filter(
      (index) =>
        validateArsenalPlacement(board, {
          ...pendingItem,
          at: { r: Math.floor(index / 10), c: index % 10 },
        }).ok,
    );
  }, [arsenal, pendingItem, ships]);

  // Both first sell back whatever defences are on the board — a fresh layout
  // cannot respect their cells — so with any placed they ask first.
  const performClear = useCallback((action: 'shuffle' | 'reset') => {
    const store = usePlacement.getState();
    store.sellPlacedArsenal();
    if (action === 'shuffle') store.autoPlace(shuffleSeed.current++);
    else store.clearFleet();
    previewRef.current?.show(null);
    setConfirmClear(null);
  }, []);

  const shuffle = useCallback(() => {
    if (usePlacement.getState().arsenal.some((item) => item.at !== undefined)) {
      setConfirmClear('shuffle');
      return;
    }
    performClear('shuffle');
  }, [performClear]);

  const reset = useCallback(() => {
    if (usePlacement.getState().arsenal.some((item) => item.at !== undefined)) {
      setConfirmClear('reset');
      return;
    }
    performClear('reset');
  }, [performClear]);

  const back = useCallback(() => {
    if (usePlacement.getState().pendingArsenalId) {
      usePlacement.getState().cancelPendingArsenal();
      return;
    }
    if (tutorial) return;
    router.back();
  }, [router, tutorial]);

  const placePendingArsenal = useCallback((r: number, c: number) => {
    const result = usePlacement.getState().placePendingArsenal({ r, c });
    if (result.ok) {
      mediumHaptic();
      playSfx(SHIP_PLACE_SOURCE);
    } else {
      warningHaptic();
      playSfx('shipInvalid');
    }
  }, []);

  const toggleWager = useCallback(() => {
    if (wagered) {
      setWagered(false);
      return;
    }
    if (!pointsReady || pointBalance < 50) {
      Alert.alert(
        pointsReady ? 'Not enough points' : 'Points unavailable',
        pointsReady
          ? `A wager needs 50 points. Your balance is ${pointBalance}.`
          : 'Your point balance has not loaded yet. Check the server connection or open the Points exchange.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open exchange', onPress: () => router.push('/points') },
        ],
      );
      return;
    }
    setWagered(true);
  }, [pointBalance, pointsReady, router, wagered]);

  const beginBattle = useCallback(() => {
    if (staking) return;
    const state = usePlacement.getState();
    if (state.ships.length !== FLEET.length) return;
    if (wagered && (!pointsReady || pointBalance < 50)) {
      Alert.alert(
        'Wager unavailable',
        pointsReady
          ? `A new wager needs 50 points. Your balance is ${pointBalance}.`
          : 'Your point balance is unavailable. Reconnect to the game server before entering a wager.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open exchange', onPress: () => router.push('/points') },
        ],
      );
      return;
    }
    const submission = validateSubmission(state.ruleset, state.ships, state.arsenal);
    if (!submission.ok) {
      state.setValidationReason(submission.reason);
      warningHaptic();
      return;
    }
    if (state.mode === 'hotseat' && state.hotseatPlayer === 1) {
      state.beginSecondPlayer(shuffleSeed.current++);
      return;
    }
    if (state.mode === 'hotseat') state.finishSecondPlayer();
    if (state.mode === 'online') {
      // P13 owns the live socket; the placement store remains the payload source.
      router.push({
        pathname: '/searching',
        params: { wager: wagered ? '1' : '0', opponent: 'player' },
      });
      return;
    }
    if (state.mode === 'ai' && wagered) {
      // Offline stays offline: the opponent is this device's AI, so there is
      // nobody to find. Only the stake goes to the server, before the first
      // shot — the result screen settles it once the match is decided.
      setStaking(true);
      void stakeOfflineWager().then((result) => {
        setStaking(false);
        if (result.ok) {
          router.push('/battle');
          return;
        }
        Alert.alert(
          result.reason === 'insufficient_points' ? 'Not enough points' : 'Wager unavailable',
          result.message,
          result.reason === 'insufficient_points'
            ? [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open exchange', onPress: () => router.push('/points') },
              ]
            : [{ text: 'OK' }],
        );
      });
      return;
    }
    router.push('/battle');
  }, [pointBalance, pointsReady, router, staking, wagered]);

  return (
    <Scale>
      <Paper variant="full" />

      {tutorial ? null : (
        <View style={styles.backButton}>
          <InkButton label="↩" size="lg" w={54} h={48} seedKey="placement-back" onPress={back} />
        </View>
      )}
      {ruleset === 'advanced' ? (
        <FuelGauge
          spent={fuelSpent + captainFuel(captainId)}
          budget={fuelBudget}
          shakeNonce={fuelShakeNonce}
          caption={fuelLabel}
        />
      ) : null}
      {mode === 'ai' && !tutorial ? <DifficultyPicker value={difficulty} /> : null}
      {ruleset === 'advanced' && mode !== 'harbour' && !tutorial ? <CaptainPicker /> : null}
      {ruleset === 'advanced' && mode !== 'harbour' && !tutorial ? <SeaPicker /> : null}
      {mode !== 'hotseat' && !tutorial ? (
        <View style={styles.wagerButton}>
          <InkButton
            label={wagered ? 'Wager ON · 50 P' : 'Wager OFF'}
            tone={wagered ? 'confirm' : 'ink'}
            size="sm"
            w={150}
            h={42}
            seedKey="placement-wager"
            onPress={toggleWager}
          />
        </View>
      ) : null}

      <TrayDock x={trayX} remaining={FLEET.length - ships.length} drag={dockDrag} />
      <GridBoard
        x={boardX}
        y={BOARD_Y}
        revealShips
        hideShips
        seedKey="placement"
        terrain={terrainForSea(seaId)}
        onPressCell={pendingArsenalId ? placePendingArsenal : undefined}
      />
      <AlignmentBands active={activeBand} hoverRow={hoverRow} hoverCol={hoverCol} boardX={boardX} />
      {pendingItem ? <LegalCellHighlights boardX={boardX} cells={legalArsenalCells} /> : null}

      {ruleset === 'advanced' ? (
        <View style={styles.shopFrame}>
          <ArsenalFrame onUnaffordable={() => setFuelShakeNonce((value) => value + 1)} />
        </View>
      ) : null}

      <PreviewHud ref={previewRef} boardX={boardX} />

      {FLEET.map((ship, index) => (
        <DraggableShip
          key={ship.id}
          fleetIndex={index}
          shipId={ship.id}
          shipClass={ship.class}
          ships={ships}
          arsenal={arsenal}
          boardX={boardX}
          trayX={trayX}
          activeBand={activeBand}
          hoverRow={hoverRow}
          hoverCol={hoverCol}
          dockDrag={dockDrag}
          previewRef={previewRef}
        />
      ))}

      {arsenal.map((item) =>
        item.at ? (
          <DraggableArsenal
            key={item.id}
            item={item as ArsenalItem & { at: NonNullable<ArsenalItem['at']> }}
            boardX={boardX}
            ships={ships}
            arsenal={arsenal}
            activeBand={activeBand}
            hoverRow={hoverRow}
            hoverCol={hoverCol}
          />
        ) : null,
      )}

      {/* Shuffle and Reset would wipe the board the lesson is building; Battle!
          would leave it for a real match. The tutorial drives its own steps. */}
      {tutorial ? null : (
        <>
          <View style={[styles.resetButton, ruleset === 'classic' && styles.resetButtonClassic]}>
            <InkButton
              label="↻"
              size="lg"
              w={50}
              h={52}
              seedKey="placement-reset"
              onPress={reset}
            />
          </View>
          <View
            style={[styles.shuffleButton, ruleset === 'classic' && styles.shuffleButtonClassic]}
          >
            <InkButton label="Shuffle" size="sm" w={116} h={48} onPress={shuffle} />
          </View>
          <PulsingBattleButton
            enabled={
              ships.length === FLEET.length &&
              pendingArsenalId === null &&
              !staking &&
              !saving &&
              !readOnly
            }
            label={
              harbour
                ? saving
                  ? 'Filing…'
                  : 'Save harbour'
                : staking
                  ? 'Staking…'
                  : 'Battle!'
            }
            onPress={harbour ? saveHarbourLayout : beginBattle}
          />
        </>
      )}

      {/* Part 7 §2 — "While a raid on you is running, the editor is read-only
          with an ink banner". The banner is drawn over everything and the
          gestures are already disabled by the button's `enabled`. */}
      {readOnly ? (
        <View style={styles.harbourBanner} pointerEvents="none">
          <Text style={styles.harbourBannerText}>{UNDER_ATTACK_LINE}</Text>
        </View>
      ) : null}
      {saveError ? (
        <Pressable style={styles.harbourError} onPress={dismissSaveError}>
          <Text style={styles.harbourErrorText}>{saveError}</Text>
        </Pressable>
      ) : null}

      {confirmClear ? (
        <ConfirmClearDialog
          action={confirmClear}
          placed={placedArsenal}
          refund={placedRefund}
          onCancel={() => setConfirmClear(null)}
          onConfirm={() => performClear(confirmClear)}
        />
      ) : null}

      {handoffVisible ? (
        <HandoffCurtain
          name={hotseatPlayer === 2 ? playerTwoName : 'Player 1'}
          onReady={() => usePlacement.getState().dismissHandoff()}
        />
      ) : null}
    </Scale>
  );
}

export default function PlacementScreen({ tutorial = false }: { tutorial?: boolean } = {}) {
  return <PlacementCanvas tutorial={tutorial} />;
}

const styles = StyleSheet.create({
  harbourBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 30,
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.inkRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  harbourBannerText: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  harbourError: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 8,
    width: 400,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  harbourErrorText: {
    color: color.inkRed,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    textAlign: 'center',
  },
  backButton: { position: 'absolute', left: 8, top: 0 },
  difficultyPicker: {
    position: 'absolute',
    left: 84,
    top: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  wagerButton: { position: 'absolute', left: 350, top: 3, zIndex: 50 },
  captainPicker: { position: 'absolute', left: 502, top: 3, zIndex: 50 },
  seaPicker: { position: 'absolute', left: 584, top: 3, zIndex: 50 },
  difficultyLabel: {
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  fuelGauge: {
    position: 'absolute',
    right: 12,
    top: 3,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    zIndex: 50,
  },
  fuelCaption: {
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  fuelReadout: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.lg,
  },
  fuelReadoutEmpty: { color: color.inkRed },
  fuelReadoutBudget: {
    color: color.inkFaint,
    fontFamily: font.label,
    fontSize: typeScale.sm,
  },
  dock: { position: 'absolute', top: TRAY_Y, width: TRAY_W, height: TRAY_H },
  dockTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    textAlign: 'center',
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  dockCount: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    textAlign: 'center',
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
  dockCountDone: { color: color.inkGreen },
  dialogRoot: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, zIndex: 90 },
  // Runs past the canvas so the paper beside it dims as well.
  dialogDim: {
    position: 'absolute',
    left: -200,
    top: -200,
    right: -200,
    bottom: -200,
    backgroundColor: 'rgba(62, 47, 184, 0.28)',
  },
  dialogPanel: { position: 'absolute', left: (CANVAS_W - 400) / 2, top: 94 },
  dialogTitle: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
  },
  dialogBody: {
    marginTop: 6,
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  dialogButtons: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
  },
  bandLayer: {
    position: 'absolute',
    top: BOARD_Y,
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    overflow: 'hidden',
  },
  rowBand: { position: 'absolute', left: 0, top: 0, width: BOARD_SIZE, height: CELL },
  colBand: { position: 'absolute', left: 0, top: 0, width: CELL, height: BOARD_SIZE },
  shopFrame: { position: 'absolute', left: SHOP_X, top: SHOP_Y, zIndex: 40 },
  arsenalTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 7,
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
  },
  reasonPill: {
    position: 'absolute',
    top: BOARD_Y + BOARD_SIZE - 24,
    minWidth: 190,
    maxWidth: BOARD_SIZE - 16,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    backgroundColor: color.paper,
    alignItems: 'center',
  },
  reasonText: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
  draggable: { position: 'absolute', overflow: 'visible' },
  shipGroup: { position: 'absolute', overflow: 'visible' },
  shipLayer: { position: 'absolute', left: 0, top: 0 },
  shipShadow: { left: 3, top: 3 },
  arsenalDrag: { position: 'absolute', overflow: 'visible' },
  arsenalSpriteOnBoard: {
    position: 'absolute',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 0.67 }],
  },
  resetButton: { position: 'absolute', left: SHOP_X + 6, top: 299 },
  resetButtonClassic: { left: 570, top: 82 },
  shuffleButton: { position: 'absolute', left: SHOP_X + 64, top: 301 },
  shuffleButtonClassic: { left: 630, top: 84 },
  battleButton: { position: 'absolute', right: 12, bottom: 2 },
  handoff: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handoffCopy: {
    position: 'absolute',
    left: 220,
    top: 72,
    width: 360,
    alignItems: 'center',
    gap: space.sm,
  },
  handoffEyebrow: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.sm,
  },
  handoffTitle: { color: color.ink, fontFamily: font.display, fontSize: typeScale.xxl },
  handoffBody: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs },
});
