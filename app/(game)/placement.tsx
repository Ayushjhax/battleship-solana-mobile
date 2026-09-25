import { ARSENAL_SPEC, isOwnBoardKind, specFor } from '@engine/arsenal';
import { emptyBoard } from '@engine/board';
import type { Difficulty } from '@engine/ai';
import { makeFleet } from '@engine/fleet';
import { validateSubmission } from '@engine/match';
import { validateArsenalPlacement } from '@engine/placement';
import type { ArsenalItem, ArsenalKind, Orientation, ShipClass } from '@engine/types';
import { Image } from 'expo-image';
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
import Svg, { G, Line } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { GridBoard, LABEL_MARGIN } from '@/board/GridBoard';
import { BOARD_SIZE, CELL } from '@/board/layout';
import { ShipSprite, shipSpriteSize } from '@/board/ShipSprite';
import { ArsenalInfoModal, INFO_W } from '@/features/arsenal/ArsenalInfoModal';
import { prefetchBattleArt } from '@/fx/prefetch';
import { ARSENAL_NAMES, SHOP_H, SHOP_W, ShopPanel } from '@/features/arsenal/ShopPanel';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import {
  buildPlacementPreview,
  usePlacement,
  type PlacementMode,
  type PlacementPreviewCell,
} from '@/state/placement';
import { stakeOfflineWager } from '@/net/offlineWager';
import { usePoints } from '@/state/points';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtPlate } from '@/ui/ArtPlate';
import { BACKGROUNDS, BATTLE_ART, FLEET_ART } from '@/ui/assets';
import { Scale, useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

/**
 * Fleet placement, drawn to its mockup over BACKGROUNDS.settings. Left to
 * right on the 800-unit canvas: the dock (unplaced ships, drawn at half size
 * in their own dashed frame so they never read as placed), the row letters,
 * the 280 board in its hand-drawn frame, then the Arsenal. Across the top:
 * back, the AI level, the wager and the fuel gauge; under the Arsenal:
 * reset, shuffle and Battle!. Classic mode has no Arsenal and centres the
 * board; the dock keeps its place to the left of the letters.
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
const SHOP_Y = 58;
/** Ships in the dock are drawn at this scale and grow to 1 as they are picked up. */
const TRAY_SCALE = 0.46;
/** "Dock" and its anchor sit above the ships. */
const TRAY_HEADER = 48;
const TRAY_PITCH = 24;
/** What the dock knows about a drag: nothing, a ship in the hand, that ship over it. */
const DOCK_IDLE = 0;
const DOCK_LIVE = 1;
const DOCK_HOVER = 2;
const SPRING = { damping: 18, stiffness: 230, mass: 0.7 } as const;
const SHIP_PLACE_SOURCE = 'shipPlace' as const;
/** The top bar's buttons. */
const BAR_Y = 6;
const BAR_H = 32;

/** The fleet table from the engine — the same list autoPlaceFleet fills. */
const FLEET = makeFleet();

/** The own-board pieces a player drags: the same art the battle board draws. */
const ITEM_ART: Partial<Record<ArsenalKind, (typeof FLEET_ART)['aaGun']>> = {
  aaGun: FLEET_ART.aaGun,
  mine: FLEET_ART.mine,
  radar: FLEET_ART.radar,
};

function parseMode(value: string | string[] | undefined): PlacementMode {
  const mode = Array.isArray(value) ? value[0] : value;
  return mode === 'online' || mode === 'hotseat' ? mode : 'ai';
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
        <View style={[styles.reasonPill, { left: boardX + 14 }]}>
          <Image source={BATTLE_ART.weaponRow} style={StyleSheet.absoluteFill} contentFit="fill" />
          <Text style={styles.reasonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {reason}
          </Text>
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

/**
 * The fuel left to spend, beside the barrel and the compass of the mockup.
 * The number rolls in when it changes and the gauge shakes on a buy it
 * cannot cover.
 */
function FuelGauge({
  spent,
  budget,
  shakeNonce,
}: {
  spent: number;
  budget: number;
  shakeNonce: number;
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

  return (
    <Animated.View
      style={[styles.fuelGauge, gaugeStyle]}
      accessibilityLabel={`${remaining} of ${budget} fuel remaining`}
    >
      <Image source={BATTLE_ART.fuel} style={styles.fuelIcon} contentFit="contain" />
      <Text style={styles.fuelCaption}>Fuel</Text>
      <Animated.View style={numberStyle}>
        <Text style={styles.fuelReadout}>
          <Text style={remaining === 0 ? styles.fuelReadoutEmpty : undefined}>{remaining}</Text>
          <Text style={styles.fuelReadoutBudget}>{` / ${budget}`}</Text>
        </Text>
      </Animated.View>
    </Animated.View>
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
  const dockTop = TRAY_Y + TRAY_HEADER + 4 + fleetIndex * TRAY_PITCH;
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
  const previews = useMemo(
    () => buildPlacementPreview(ships, arsenal, shipId, orientation),
    [arsenal, orientation, shipId, ships],
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
  // Lifted, the ship casts a navy shadow onto the paper below it.
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: lifted.value * 0.28,
    transform: [{ translateX: 2 + lifted.value * 3 }, { translateY: 3 + lifted.value * 4 }],
  }));
  const groupStyle = useAnimatedStyle(() => ({ transform: [{ scale: shipScale.value }] }));
  const artStyle = useAnimatedStyle(() => ({
    opacity: held.value && hoverIndex.value >= 0 && valid.value === 0 ? 0.35 : 1,
  }));
  const redStyle = useAnimatedStyle(() => ({
    opacity: held.value && hoverIndex.value >= 0 && valid.value === 0 ? 0.72 : 0,
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
          <Animated.View style={[styles.shipLayer, shadowStyle]}>
            <ShipSprite shipClass={shipClass} orientation={orientation} tint={artColor.ink} />
          </Animated.View>
          <Animated.View style={[styles.shipLayer, artStyle]}>
            <ShipSprite shipClass={shipClass} orientation={orientation} />
          </Animated.View>
          <Animated.View style={[styles.shipLayer, redStyle]}>
            <ShipSprite shipClass={shipClass} orientation={orientation} tint={color.inkRed} />
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
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + lifted.value * 0.12 },
    ],
  }));
  // An invalid cell under a carried item shows it faded; the gesture view
  // itself never animates opacity, only the art inside it.
  const artStyle = useAnimatedStyle(() => ({ opacity: valid.value || !lifted.value ? 1 : 0.45 }));
  const source = ITEM_ART[item.kind] ?? null;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`${ARSENAL_NAMES[item.kind]}. Drag to move or hold to sell.`}
        style={[
          styles.arsenalDrag,
          { left: baseX - pad, top: baseY - pad, width: hit, height: hit },
          animated,
        ]}
      >
        {/* Absolute child: placed at the pad by hand, as in DraggableShip. */}
        <Animated.View style={[styles.arsenalSpriteOnBoard, { left: pad, top: pad }, artStyle]}>
          {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

/** The green plate, breathing gently once the fleet is ready to sail. */
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
        withTiming(1.04, { duration: 160, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 260, easing: Easing.inOut(Easing.cubic) }),
        withDelay(2400, withTiming(1, { duration: 0 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [enabled, pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[styles.battleButton, style]}>
      <ArtPlate
        family="sketch"
        tone="green"
        w={172}
        h={52}
        label={label}
        fontSize={27}
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

/** AI: Easy · Normal · Hard — the chosen level on the green plate, the rest cream. */
function DifficultyPicker({ value }: { value: Difficulty }) {
  return (
    <View style={styles.difficultyPicker} accessibilityRole="radiogroup">
      <Text style={styles.difficultyLabel}>AI:</Text>
      {DIFFICULTIES.map((option) => (
        <ArtPlate
          key={option.value}
          family="sketch"
          tone={value === option.value ? 'green' : 'cream'}
          w={70}
          h={BAR_H}
          label={option.label}
          fontSize={15}
          checked={value === option.value}
          accessibilityLabel={`AI ${option.label}`}
          onPress={() => usePlacement.getState().setDifficulty(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * The dock: the dashed frame left of the row letters holding the ships still
 * to be placed (drawn at half size by DraggableShip), with a running count so
 * a missed ship is never mistaken for a placed one.
 *
 * It is also where a placed ship goes back to, so it answers the drag: idle
 * and complete it rests faded; a ship in the hand brings it up to full ink,
 * and a ship over it hatches it green with "Drop here".
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
  const hoverFrame = roughRect(4, 4, TRAY_W - 8, TRAY_H - 8, {
    seed: hashString('placement-dock'),
    stroke: color.inkGreen,
    strokeWidth: 2,
    roughness: 1.2,
    fill: color.inkGreen,
    fillStyle: 'hachure',
    hachureGap: 4.5,
    fillWeight: 0.7,
  });
  const fade = { duration: reduceMotion ? 0 : 120 };
  const frameStyle = useAnimatedStyle(() => ({
    opacity: withTiming(remaining === 0 && drag.value === DOCK_IDLE ? 0.7 : 1, fade),
  }));
  const hoverStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 0.85 : 0, fade),
  }));
  const countStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 0 : 1, fade),
  }));
  const dropStyle = useAnimatedStyle(() => ({
    opacity: withTiming(drag.value === DOCK_HOVER ? 1 : 0, fade),
  }));

  return (
    <View pointerEvents="none" style={[styles.dock, { left: x }]}>
      <Animated.View style={[StyleSheet.absoluteFill, frameStyle]}>
        <Image source={BATTLE_ART.dock} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, hoverStyle]}>
        <Svg width={TRAY_W} height={TRAY_H} viewBox={`0 0 ${TRAY_W} ${TRAY_H}`}>
          <RoughShape paths={hoverFrame} dash={[5, 4]} opacity={0.55} />
        </Svg>
      </Animated.View>
      <Text style={styles.dockTitle}>Dock</Text>
      <Image source={BATTLE_ART.dockAnchor} style={styles.dockAnchor} contentFit="contain" />
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

/** The quiet dim behind a modal, with a tap-anywhere dismiss. */
function ModalScrim({ onPress, label }: { onPress: () => void; label: string }) {
  const reduceMotion = useReducedMotion();
  const shade = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    shade.value = withTiming(1, { duration: reduceMotion ? 0 : 160 });
  }, [reduceMotion, shade]);
  const style = useAnimatedStyle(() => ({ opacity: shade.value }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.scrim, style]} />
      <Pressable style={styles.scrimTouch} onPress={onPress} accessibilityLabel={label} />
    </>
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
      <ModalScrim onPress={onCancel} label="Cancel" />
      <View style={styles.dialogPanel}>
        <Image source={BATTLE_ART.weaponModal} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.dialogTitle}>
          {action === 'shuffle' ? 'Shuffle the fleet?' : 'Clear the board?'}
        </Text>
        <Text style={styles.dialogBody}>
          {verb} takes {list} off the board too. {their} {refund} fuel goes back to your gauge;
          the bombers and torpedoes you bought stay yours.
        </Text>
        <View style={styles.dialogButtons}>
          <ArtPlate family="sketch" tone="cream" w={130} h={38} label="Keep them" fontSize={16} onPress={onCancel} />
          <ArtPlate
            family="sketch"
            tone="green"
            w={164}
            h={38}
            label={action === 'shuffle' ? 'Shuffle anyway' : 'Clear anyway'}
            fontSize={16}
            onPress={onConfirm}
          />
        </View>
      </View>
    </View>
  );
}

function HandoffCurtain({ name, onReady }: { name: string; onReady: () => void }) {
  return (
    <View style={styles.handoff} accessibilityViewIsModal>
      <Image source={BACKGROUNDS.settings} style={styles.handoffPage} contentFit="cover" />
      <View style={styles.handoffPanel}>
        <Image source={BATTLE_ART.infoModal} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.handoffEyebrow}>Pass the device</Text>
        <Text style={styles.handoffTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {name}&apos;s turn
        </Text>
        <Text style={styles.handoffBody}>Tap Ready when only {name} can see the screen.</Text>
        <ArtPlate family="sketch" tone="green" w={150} h={44} label="Ready" fontSize={22} onPress={onReady} />
      </View>
    </View>
  );
}

function PlacementCanvas() {
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
  const [infoKind, setInfoKind] = useState<ArsenalKind | null>(null);
  const activeBand = useSharedValue(0);
  const hoverRow = useSharedValue(-1);
  const hoverCol = useSharedValue(-1);
  const dockDrag = useSharedValue(DOCK_IDLE);

  const ships = usePlacement((state) => state.ships);
  const arsenal = usePlacement((state) => state.arsenal);
  const fuelSpent = usePlacement((state) => state.fuelSpent);
  const fuelBudget = usePlacement((state) => state.fuelBudget);
  const ruleset = usePlacement((state) => state.ruleset);
  const difficulty = usePlacement((state) => state.difficulty);
  const pendingArsenalId = usePlacement((state) => state.pendingArsenalId);
  const hotseatPlayer = usePlacement((state) => state.hotseatPlayer);
  const handoffVisible = usePlacement((state) => state.handoffVisible);
  const playerTwoName = usePlacement((state) => state.playerTwoName);
  const pointBalance = usePoints((state) => state.balance);
  const pointsReady = usePoints((state) => state.ready);

  useEffect(() => {
    usePlacement.getState().initialize(mode, sessionSeed.current, requestedRuleset);
  }, [mode, requestedRuleset]);

  // The battle is the next screen: its effects decode while the fleet is laid out.
  useEffect(() => prefetchBattleArt(), []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (usePlacement.getState().pendingArsenalId) usePlacement.getState().cancelPendingArsenal();
      else router.back();
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
    router.back();
  }, [router]);

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

  const showsPicker = mode === 'ai';
  const showsWager = mode !== 'hotseat';

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <ArtImageButton
        source={BATTLE_ART.back}
        w={58}
        h={58 * (81 / 147)}
        label="Back"
        onPress={back}
        style={styles.backButton}
      />
      {showsPicker ? <DifficultyPicker value={difficulty} /> : null}
      {showsPicker && showsWager ? (
        <Svg width={4} height={BAR_H + 4} style={styles.barDivider} pointerEvents="none">
          <Line x1={2} y1={2} x2={2} y2={BAR_H + 2} stroke={artColor.navy} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      ) : null}
      {showsWager ? (
        <View style={[styles.wagerButton, !showsPicker && styles.wagerButtonAlone]}>
          <ArtPlate
            family="sketch"
            tone={wagered ? 'green' : 'cream'}
            w={wagered ? 166 : 140}
            h={BAR_H}
            label={wagered ? 'Wager ON · 50 P' : 'Wager OFF'}
            icon={wagered ? BATTLE_ART.coins : undefined}
            iconSize={24}
            fontSize={15}
            accessibilityLabel={wagered ? 'Wager on, 50 points. Tap to turn off.' : 'Wager off. Tap to wager 50 points.'}
            onPress={toggleWager}
          />
        </View>
      ) : null}
      {ruleset === 'advanced' ? (
        <FuelGauge spent={fuelSpent} budget={fuelBudget} shakeNonce={fuelShakeNonce} />
      ) : null}
      <Image source={BATTLE_ART.compass} style={styles.compass} contentFit="contain" pointerEvents="none" />

      <TrayDock x={trayX} remaining={FLEET.length - ships.length} drag={dockDrag} />
      <GridBoard
        x={boardX}
        y={BOARD_Y}
        revealShips
        hideShips
        seedKey="placement"
        skin="art"
        onPressCell={pendingArsenalId ? placePendingArsenal : undefined}
      />
      <AlignmentBands active={activeBand} hoverRow={hoverRow} hoverCol={hoverCol} boardX={boardX} />
      {pendingItem ? <LegalCellHighlights boardX={boardX} cells={legalArsenalCells} /> : null}

      {ruleset === 'advanced' ? (
        <View style={styles.shopFrame}>
          <ShopPanel onUnaffordable={() => setFuelShakeNonce((value) => value + 1)} onInfo={setInfoKind} />
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

      <ArtImageButton
        source={BATTLE_ART.rotate}
        w={48}
        h={48 * (91 / 98)}
        label="Clear the board"
        onPress={reset}
        style={ruleset === 'classic' ? styles.resetButtonClassic : styles.resetButton}
      />
      <ArtImageButton
        source={BATTLE_ART.shuffle}
        w={122}
        h={122 * (89 / 235)}
        label="Shuffle"
        onPress={shuffle}
        style={ruleset === 'classic' ? styles.shuffleButtonClassic : styles.shuffleButton}
      />
      <PulsingBattleButton
        enabled={ships.length === FLEET.length && pendingArsenalId === null && !staking}
        label={staking ? 'Staking…' : 'Battle!'}
        onPress={beginBattle}
      />

      {infoKind ? (
        <View style={styles.dialogRoot}>
          <ModalScrim onPress={() => setInfoKind(null)} label="Close" />
          <ArsenalInfoModal
            kind={infoKind}
            left={boardX + (BOARD_SIZE - INFO_W) / 2}
            top={BOARD_Y + 34}
            onClose={() => setInfoKind(null)}
          />
        </View>
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

export default function PlacementScreen() {
  return <PlacementCanvas />;
}

const DIALOG_W = 400;
const DIALOG_H = DIALOG_W * (466 / 885);
const HANDOFF_W = 330;
const HANDOFF_H = HANDOFF_W * (364 / 552);

const styles = StyleSheet.create({
  backButton: { position: 'absolute', left: 8, top: BAR_Y },
  difficultyPicker: {
    position: 'absolute',
    left: 76,
    top: BAR_Y,
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  difficultyLabel: {
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 16,
    marginRight: 2,
  },
  barDivider: { position: 'absolute', left: 322, top: BAR_Y - 2 },
  wagerButton: { position: 'absolute', left: 334, top: BAR_Y, zIndex: 50 },
  wagerButtonAlone: { left: 78 },
  fuelGauge: {
    position: 'absolute',
    right: 60,
    top: BAR_Y - 2,
    height: BAR_H + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 50,
  },
  fuelIcon: { width: 24, height: 26 },
  fuelCaption: { color: artColor.navy, fontFamily: font.display, fontSize: 15 },
  fuelReadout: { color: artColor.navy, fontFamily: font.display, fontSize: 26, lineHeight: 32 },
  fuelReadoutEmpty: { color: artColor.red },
  fuelReadoutBudget: { color: artColor.muted, fontFamily: font.label, fontSize: 15 },
  compass: { position: 'absolute', right: 8, top: 1, width: 46, height: 45 },
  dock: { position: 'absolute', top: TRAY_Y, width: TRAY_W, height: TRAY_H },
  dockTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 6,
    textAlign: 'center',
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 14,
  },
  dockAnchor: { position: 'absolute', left: (TRAY_W - 18) / 2, top: 25, width: 18, height: 23 },
  dockCount: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    textAlign: 'center',
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 11,
  },
  dockCountDone: { color: artColor.green },
  dialogRoot: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, zIndex: 90 },
  // Both run past the canvas so the page beside it dims as well.
  scrim: {
    position: 'absolute',
    left: -200,
    top: -200,
    right: -200,
    bottom: -200,
    backgroundColor: 'rgba(10, 16, 108, 0.22)',
  },
  scrimTouch: { position: 'absolute', left: -200, top: -200, right: -200, bottom: -200 },
  dialogPanel: {
    position: 'absolute',
    left: (CANVAS_W - DIALOG_W) / 2,
    top: (CANVAS_H - DIALOG_H) / 2,
    width: DIALOG_W,
    height: DIALOG_H,
  },
  dialogTitle: {
    marginTop: 18,
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 21,
    textAlign: 'center',
  },
  dialogBody: {
    marginTop: 8,
    marginHorizontal: 30,
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  dialogButtons: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
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
  shopFrame: { position: 'absolute', left: SHOP_X, top: SHOP_Y, width: SHOP_W, height: SHOP_H, zIndex: 40 },
  reasonPill: {
    position: 'absolute',
    top: BOARD_Y + BOARD_SIZE - 34,
    width: BOARD_SIZE - 28,
    height: 26,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonText: {
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 12,
  },
  draggable: { position: 'absolute', overflow: 'visible' },
  shipGroup: { position: 'absolute', overflow: 'visible' },
  shipLayer: { position: 'absolute', left: 0, top: 0 },
  arsenalDrag: { position: 'absolute', overflow: 'visible' },
  arsenalSpriteOnBoard: { position: 'absolute', width: CELL, height: CELL },
  resetButton: { position: 'absolute', left: SHOP_X + 4, top: SHOP_Y + SHOP_H + 8 },
  resetButtonClassic: { position: 'absolute', left: 570, top: 82 },
  shuffleButton: { position: 'absolute', left: SHOP_X + 60, top: SHOP_Y + SHOP_H + 9 },
  shuffleButtonClassic: { position: 'absolute', left: 628, top: 84 },
  battleButton: { position: 'absolute', right: 10, bottom: 6 },
  handoff: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: color.paper,
  },
  handoffPage: { position: 'absolute', left: -200, top: -200, right: -200, bottom: -200 },
  handoffPanel: {
    position: 'absolute',
    left: (CANVAS_W - HANDOFF_W) / 2,
    top: (CANVAS_H - HANDOFF_H) / 2,
    width: HANDOFF_W,
    height: HANDOFF_H,
    alignItems: 'center',
    paddingTop: 20,
    gap: 6,
  },
  handoffEyebrow: { color: artColor.red, fontFamily: font.display, fontSize: 15 },
  handoffTitle: { color: artColor.navy, fontFamily: font.display, fontSize: 34, maxWidth: HANDOFF_W - 50 },
  handoffBody: {
    color: artColor.soft,
    fontFamily: font.body,
    fontSize: 13,
    textAlign: 'center',
    marginHorizontal: 30,
    marginBottom: 6,
  },
});
