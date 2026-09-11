import { emptyBoard } from '@engine/board';
import { validateSubmission } from '@engine/match';
import { validateArsenalPlacement } from '@engine/placement';
import type { ArsenalItem, Orientation } from '@engine/types';
import * as Haptics from 'expo-haptics';
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
import { BackHandler, StyleSheet, Text, View } from 'react-native';
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

import { playSfx } from '@/audio/sfx';
import { GridBoard } from '@/board/GridBoard';
import { BOARD_SIZE, CELL } from '@/board/layout';
import { ShipSprite, shipSpriteSize } from '@/board/ShipSprite';
import { ArsenalInkSprite, ShopPanel } from '@/features/arsenal/ShopPanel';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { useProfile } from '@/state/profile';
import {
  buildPlacementPreview,
  usePlacement,
  type PlacementMode,
  type PlacementPreviewCell,
} from '@/state/placement';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale, useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

const ADVANCED_BOARD_X = 32;
const CLASSIC_BOARD_X = (CANVAS_W - BOARD_SIZE) / 2;
const BOARD_Y = 68;
const SHOP_X = 330;
const SHOP_Y = 62;
const SHOP_W = 458;
const SHOP_H = 226;
const TRAY_X = 0;
const TRAY_Y = 67;
const TRAY_W = 38;
const TRAY_H = 280;
const SPRING = { damping: 18, stiffness: 230, mass: 0.7 } as const;
const SHIP_PLACE_SOURCE = 'shipPlace' as const;

const FLEET = [
  { id: 'battleship-1', class: 'battleship', len: 4 },
  { id: 'cruiser-1', class: 'cruiser', len: 3 },
  { id: 'cruiser-2', class: 'cruiser', len: 3 },
  { id: 'destroyer-1', class: 'destroyer', len: 2 },
  { id: 'destroyer-2', class: 'destroyer', len: 2 },
  { id: 'destroyer-3', class: 'destroyer', len: 2 },
  { id: 'boat-1', class: 'boat', len: 1 },
  { id: 'boat-2', class: 'boat', len: 1 },
  { id: 'boat-3', class: 'boat', len: 1 },
  { id: 'boat-4', class: 'boat', len: 1 },
] as const;

function parseMode(value: string | string[] | undefined): PlacementMode {
  const mode = Array.isArray(value) ? value[0] : value;
  return mode === 'online' || mode === 'hotseat' ? mode : 'ai';
}

function parseRuleset(value: string | string[] | undefined): 'classic' | 'advanced' {
  const ruleset = Array.isArray(value) ? value[0] : value;
  return ruleset === 'classic' ? 'classic' : 'advanced';
}

function lightHaptic() {
  if (!useProfile.getState().hapticsOn) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function mediumHaptic() {
  if (!useProfile.getState().hapticsOn) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

function warningHaptic() {
  if (!useProfile.getState().hapticsOn) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
        <View style={[styles.reasonPill, { left: boardX + 40 }]}>
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
}: {
  spent: number;
  budget: number;
  shakeNonce: number;
}) {
  const remaining = Math.max(0, budget - spent);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(budget > 0 ? remaining / budget : 0);
  const shake = useSharedValue(0);
  const roll = useSharedValue(0);
  const { roughCircle, roughLine, roughPolygon, roughRect } = useRough();
  const barW = 244;
  const barH = 32;

  useEffect(() => {
    const next = budget > 0 ? remaining / budget : 0;
    progress.value = reduceMotion
      ? next
      : withTiming(next, { duration: 400, easing: Easing.out(Easing.cubic) });
    if (!reduceMotion) {
      roll.value = -6;
      roll.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    }
  }, [budget, progress, reduceMotion, remaining, roll]);

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

  const clipStyle = useAnimatedStyle(() => ({ width: Math.max(0, (barW - 9) * progress.value) }));
  const gaugeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const numberStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.35, Math.abs(roll.value) / 20),
    transform: [{ translateY: roll.value }],
  }));
  const frame = roughRect(1, 2, barW - 2, barH - 4, {
    seed: hashString('fuel-frame'),
    stroke: color.ink,
    strokeWidth: 1.65,
    roughness: 1,
    bowing: 0.75,
  });
  const fill = roughRect(0, 0, barW - 9, barH - 11, {
    seed: hashString('fuel-fill'),
    stroke: color.inkGreen,
    strokeWidth: 0.7,
    fill: color.inkGreen,
    fillStyle: 'hachure',
    hachureGap: 2.5,
    fillWeight: 1,
  });
  const barrel = roughRect(4, 4, 27, 31, {
    seed: hashString('fuel-barrel'),
    stroke: color.ink,
    strokeWidth: 1.5,
    fill: color.paper,
    fillStyle: 'solid',
  });
  const rimTop = roughCircle(17.5, 5.5, 26, {
    seed: hashString('fuel-rim-top'),
    stroke: color.ink,
    strokeWidth: 1.25,
  });
  const rimBottom = roughLine(5, 30, 30, 30, {
    seed: hashString('fuel-rim-bottom'),
    stroke: color.ink,
    strokeWidth: 1,
  });
  const drop = roughPolygon(
    [
      [17.5, 14],
      [13.5, 23],
      [17.5, 27],
      [21.5, 23],
    ],
    {
      seed: hashString('fuel-drop'),
      stroke: color.ink,
      strokeWidth: 1.1,
      fill: color.ink,
      fillStyle: 'solid',
    },
  );

  return (
    <Animated.View
      style={[styles.fuelGauge, gaugeStyle]}
      accessibilityLabel={`${remaining} of ${budget} fuel remaining`}
    >
      <View style={styles.fuelBarrel} pointerEvents="none">
        <Svg width={36} height={40} viewBox="0 0 36 40">
          <RoughShape paths={barrel} />
          <RoughShape paths={rimTop} />
          <RoughShape paths={rimBottom} />
          <RoughShape paths={drop} />
        </Svg>
      </View>
      <View style={{ width: barW, height: barH }}>
        <Svg
          width={barW}
          height={barH}
          viewBox={`0 0 ${barW} ${barH}`}
          style={StyleSheet.absoluteFill}
        >
          <RoughShape paths={frame} />
        </Svg>
        <Animated.View style={[styles.fuelClip, clipStyle]}>
          <Svg width={barW - 9} height={barH - 11} viewBox={`0 0 ${barW - 9} ${barH - 11}`}>
            <RoughShape paths={fill} opacity={0.72} />
          </Svg>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.fuelLabelBox, numberStyle]}>
          <Text style={styles.fuelLabel}>
            {remaining}/{budget}
          </Text>
        </Animated.View>
      </View>
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
  shipClass: (typeof FLEET)[number]['class'];
  ships: ReturnType<typeof usePlacement.getState>['ships'];
  arsenal: ReturnType<typeof usePlacement.getState>['arsenal'];
  boardX: number;
  trayX: number;
  activeBand: SharedValue<number>;
  hoverRow: SharedValue<number>;
  hoverCol: SharedValue<number>;
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
  previewRef,
}: DraggableShipProps) {
  const { scale, ox, oy } = useScale();
  const reduceMotion = useReducedMotion();
  // Tutorial: lets the overlay spotlight and point at this ship (`ship-<id>`).
  const tutorialTarget = useTutorialTarget(`ship-${shipId}`);
  const placed = ships.find((ship) => ship.id === shipId);
  const orientation: Orientation = placed?.orientation ?? 'h';
  const size = shipSpriteSize(shipClass, orientation);
  const baseX = placed ? boardX + placed.origin.c * CELL : trayX + 4;
  const baseY = placed ? BOARD_Y + placed.origin.r * CELL : TRAY_Y + fleetIndex * 26.3;
  const hitW = Math.max(size.width, 44 / scale);
  const hitH = Math.max(size.height, 44 / scale);
  const padX = (hitW - size.width) / 2;
  const padY = (hitH - size.height) / 2;
  const previews = useMemo(
    () => buildPlacementPreview(ships, arsenal, shipId, orientation),
    [arsenal, orientation, shipId, ships],
  );
  const validMap = useMemo(() => previews.map((preview) => (preview.ok ? 1 : 0)), [previews]);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const valid = useSharedValue(1);
  const hoverIndex = useSharedValue(-1);
  const lastNotifiedIndex = useSharedValue(-2);
  const overTray = useSharedValue(placed ? 0 : 1);
  const finalized = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [baseX, baseY, orientation, translateX, translateY]);

  const showPreview = useCallback(
    (index: number) => previewRef.current?.show(index >= 0 ? (previews[index] ?? null) : null),
    [previewRef, previews],
  );

  const resetVisuals = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
    previewRef.current?.show(null);
  }, [previewRef, translateX, translateY]);

  const commitDrop = useCallback(
    (r: number, c: number) => {
      const result = usePlacement.getState().placeAt(shipId, { r, c }, orientation);
      if (result.ok) {
        mediumHaptic();
        playSfx(SHIP_PLACE_SOURCE);
      } else {
        warningHaptic();
        playSfx('shipInvalid');
      }
      resetVisuals();
    },
    [orientation, resetVisuals, shipId],
  );

  const unplace = useCallback(() => {
    if (placed) {
      const result = usePlacement.getState().remove(shipId);
      if (result.ok) mediumHaptic();
    }
    resetVisuals();
  }, [placed, resetVisuals, shipId]);

  const rejectDrop = useCallback(
    (index: number) => {
      const reason = previews[index]?.reason ?? 'drop the ship on an open part of the board';
      usePlacement.getState().setValidationReason(reason);
      warningHaptic();
      playSfx('shipInvalid');
    },
    [previews],
  );

  const tapToRotate = useCallback(() => {
    if (!placed) return;
    const result = usePlacement.getState().rotate(shipId);
    if (result.ok) {
      mediumHaptic();
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
    if (lifted.value) return;
    finalized.value = 0;
    lifted.value = 1;
    grabX.value = (absoluteX - ox) / scale - (baseX + translateX.value);
    grabY.value = (absoluteY - oy) / scale - (baseY + translateY.value);
    activeBand.value = 1;
    if (placed) {
      hoverRow.value = placed.origin.r;
      hoverCol.value = placed.origin.c;
      hoverIndex.value = placed.origin.r * 10 + placed.origin.c;
      valid.value = validMap[hoverIndex.value] ?? 1;
      runOnJS(showPreview)(hoverIndex.value);
      lastNotifiedIndex.value = hoverIndex.value;
    }
    runOnJS(lightHaptic)();
  };

  const finishDrag = () => {
    'worklet';
    if (!lifted.value || finalized.value) return;
    finalized.value = 1;
    const index = hoverIndex.value;
    const shouldUnplace = overTray.value === 1;
    lifted.value = withSpring(0, SPRING);
    activeBand.value = 0;
    hoverRow.value = -1;
    hoverCol.value = -1;

    if (shouldUnplace) {
      runOnJS(unplace)();
      return;
    }
    if (index >= 0 && valid.value === 1) {
      runOnJS(commitDrop)(Math.floor(index / 10), index % 10);
      return;
    }

    translateX.value = reduceMotion ? 0 : withSpring(0, SPRING);
    translateY.value = reduceMotion ? 0 : withSpring(0, SPRING);
    runOnJS(rejectDrop)(index);
    runOnJS(showPreview)(-1);
  };

  const pan = Gesture.Pan()
    .minDistance(1)
    .shouldCancelWhenOutside(false)
    .onStart((event) => beginPickup(event.absoluteX, event.absoluteY))
    .onUpdate((event) => {
      const canvasX = (event.absoluteX - ox) / scale;
      const canvasY = (event.absoluteY - oy) / scale;
      const desiredX = canvasX - grabX.value;
      const desiredY = canvasY - grabY.value;
      const candidateC = Math.round((desiredX - boardX) / CELL);
      const candidateR = Math.round((desiredY - BOARD_Y) / CELL);
      const nearBoard = candidateC >= 0 && candidateC < 10 && candidateR >= 0 && candidateR < 10;

      overTray.value =
        canvasX >= trayX &&
        canvasX <= trayX + TRAY_W + 12 &&
        canvasY >= TRAY_Y &&
        canvasY <= TRAY_Y + TRAY_H
          ? 1
          : 0;

      if (nearBoard) {
        const index = candidateR * 10 + candidateC;
        translateX.value = boardX + candidateC * CELL - baseX;
        translateY.value = BOARD_Y + candidateR * CELL - baseY;
        hoverRow.value = candidateR;
        hoverCol.value = candidateC;
        hoverIndex.value = index;
        valid.value = validMap[index] ?? 0;
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
    .onStart((event) => beginPickup(event.absoluteX, event.absoluteY))
    .onFinalize(finishDrag);

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
  const inkStyle = useAnimatedStyle(() => ({
    opacity: lifted.value && hoverIndex.value >= 0 && valid.value === 0 ? 0.2 : 1,
  }));
  const redStyle = useAnimatedStyle(() => ({
    opacity: lifted.value && hoverIndex.value >= 0 && valid.value === 0 ? 1 : 0,
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
          {
            left: baseX - padX,
            top: baseY - padY,
            width: hitW,
            height: hitH,
            paddingLeft: padX,
            paddingTop: padY,
          },
          wrapperStyle,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.shipShadow, shadowStyle]}>
          <ShipSprite shipClass={shipClass} orientation={orientation} stroke={color.inkSoft} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.shipLayer, inkStyle]}>
          <ShipSprite shipClass={shipClass} orientation={orientation} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.shipLayer, redStyle]}>
          <ShipSprite shipClass={shipClass} orientation={orientation} stroke={color.inkRed} />
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
    const result = usePlacement.getState().sellArsenal(item.id);
    if (result.ok) mediumHaptic();
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
          { left: baseX - pad, top: baseY - pad, width: hit, height: hit, padding: pad },
          animated,
        ]}
      >
        <View style={styles.arsenalSpriteOnBoard}>
          <ArsenalInkSprite kind={item.kind} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

function PulsingBattleButton({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
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
        label="Battle!"
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

function HandoffCurtain({ player, onReady }: { player: 1 | 2; onReady: () => void }) {
  return (
    <View style={styles.handoff}>
      <Paper variant="panel" w={CANVAS_W} h={CANVAS_H} seedKey="hotseat-handoff" />
      <View style={styles.handoffCopy}>
        <Text style={styles.handoffEyebrow}>Pass the device</Text>
        <Text style={styles.handoffTitle}>Player {player}&apos;s fleet</Text>
        <Text style={styles.handoffBody}>Keep the other captain&apos;s waters secret.</Text>
        <InkButton label="Ready" tone="confirm" size="lg" w={150} onPress={onReady} />
      </View>
    </View>
  );
}

function PlacementCanvas() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string | string[];
    ruleset?: string | string[];
  }>();
  const mode = parseMode(params.mode);
  const requestedRuleset = parseRuleset(params.ruleset);
  const sessionSeed = useRef((Date.now() ^ 0x5ea71e) >>> 0);
  const shuffleSeed = useRef(sessionSeed.current + 1);
  const previewRef = useRef<PreviewHandle>(null);
  const [fuelShakeNonce, setFuelShakeNonce] = useState(0);
  const activeBand = useSharedValue(0);
  const hoverRow = useSharedValue(-1);
  const hoverCol = useSharedValue(-1);

  const ships = usePlacement((state) => state.ships);
  const arsenal = usePlacement((state) => state.arsenal);
  const fuelSpent = usePlacement((state) => state.fuelSpent);
  const fuelBudget = usePlacement((state) => state.fuelBudget);
  const ruleset = usePlacement((state) => state.ruleset);
  const pendingArsenalId = usePlacement((state) => state.pendingArsenalId);
  const hotseatPlayer = usePlacement((state) => state.hotseatPlayer);
  const handoffVisible = usePlacement((state) => state.handoffVisible);

  useEffect(() => {
    usePlacement.getState().initialize(mode, sessionSeed.current, requestedRuleset);
  }, [mode, requestedRuleset]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!usePlacement.getState().pendingArsenalId) return false;
      usePlacement.getState().cancelPendingArsenal();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const boardX = ruleset === 'classic' ? CLASSIC_BOARD_X : ADVANCED_BOARD_X;
  const trayX = ruleset === 'classic' ? CLASSIC_BOARD_X - 32 : TRAY_X;
  const pendingItem = arsenal.find((item) => item.id === pendingArsenalId);
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

  const shuffle = useCallback(() => {
    usePlacement.getState().autoPlace(shuffleSeed.current++);
    mediumHaptic();
    previewRef.current?.show(null);
  }, []);

  const reset = useCallback(() => {
    usePlacement.getState().clearFleet();
    lightHaptic();
    previewRef.current?.show(null);
  }, []);

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

  const beginBattle = useCallback(() => {
    const state = usePlacement.getState();
    if (state.ships.length !== FLEET.length) return;
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
      router.push('/searching');
      return;
    }
    router.push('/battle');
  }, [router]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.backButton}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="placement-back" onPress={back} />
      </View>
      {ruleset === 'advanced' ? (
        <FuelGauge spent={fuelSpent} budget={fuelBudget} shakeNonce={fuelShakeNonce} />
      ) : null}

      <View
        pointerEvents="none"
        style={[styles.trayRail, ruleset === 'classic' && styles.trayRailClassic]}
      />
      <GridBoard
        x={boardX}
        y={BOARD_Y}
        revealShips
        hideShips
        seedKey="placement"
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

      <View style={[styles.resetButton, ruleset === 'classic' && styles.resetButtonClassic]}>
        <InkButton label="↻" size="lg" w={50} h={52} seedKey="placement-reset" onPress={reset} />
      </View>
      <View style={[styles.shuffleButton, ruleset === 'classic' && styles.shuffleButtonClassic]}>
        <InkButton label="Shuffle" size="sm" w={116} h={48} onPress={shuffle} />
      </View>
      <PulsingBattleButton
        enabled={ships.length === FLEET.length && pendingArsenalId === null}
        onPress={beginBattle}
      />

      {handoffVisible ? (
        <HandoffCurtain
          player={hotseatPlayer}
          onReady={() => usePlacement.getState().dismissHandoff()}
        />
      ) : null}
    </Scale>
  );
}

export default function PlacementScreen() {
  return <PlacementCanvas />;
}

const styles = StyleSheet.create({
  backButton: { position: 'absolute', left: 8, top: 0 },
  fuelGauge: {
    position: 'absolute',
    right: 12,
    top: 3,
    width: 284,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fuelBarrel: { width: 40, height: 42, zIndex: 2, marginRight: -2 },
  fuelClip: {
    position: 'absolute',
    left: 5,
    top: 6,
    height: 22,
    overflow: 'hidden',
  },
  fuelLabelBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fuelLabel: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    fontVariant: ['tabular-nums'],
  },
  trayRail: {
    position: 'absolute',
    left: TRAY_X + 2,
    top: TRAY_Y,
    width: TRAY_W - 4,
    height: TRAY_H,
    backgroundColor: color.paper,
    borderRightWidth: 1,
    borderRightColor: color.inkFaint,
    opacity: 0.7,
  },
  trayRailClassic: { left: CLASSIC_BOARD_X - 32 },
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
    top: 42,
    minWidth: 190,
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
  shipLayer: { position: 'absolute', left: 0, top: 0 },
  shipShadow: { position: 'absolute', left: 3, top: 3 },
  arsenalDrag: { position: 'absolute', overflow: 'visible' },
  arsenalSpriteOnBoard: {
    position: 'absolute',
    left: -7,
    top: -7,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 0.67 }],
  },
  resetButton: { position: 'absolute', left: 336, top: 299 },
  resetButtonClassic: { left: 570, top: 82 },
  shuffleButton: { position: 'absolute', left: 394, top: 301 },
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
