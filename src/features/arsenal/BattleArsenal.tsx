/**
 * The battle's arsenal: the "Choose a weapon" panel over your own board, and
 * the targeting overlay on the enemy board once a weapon is picked.
 *
 * The panel lists what can be aimed (catalog.ts WEAPON_ORDER): the four
 * aircraft, the radar and the submarine. The AA gun and the mine are bought
 * and placed at the start and then work on their own, so they are not
 * weapons to choose. A row with none left, or any row off your turn, is
 * drawn faded and does nothing.
 */
import { atomicFootprint, bomberFootprint, doubleTorpedoRows } from '@engine/arsenal';
import type { ArsenalItem, ArsenalKind, Coord, Marks } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { BATTLE_BOARD_TOP, BOARD_SIZE, CELL, boardOrigins } from '@/board/layout';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { ArtPlate } from '@/ui/ArtPlate';
import { BATTLE_ART } from '@/ui/assets';
import { useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';
import { ArsenalIcon } from './ArsenalIcon';
import { ARSENAL_NAMES, CARD_NAMES, WEAPON_NAMES, WEAPON_ORDER } from './catalog';

/** weapon-modal.png is 885 x 466; its close box is centred at (853, 35.5). */
const PANEL_W = 386;
const PANEL_H = PANEL_W * (466 / 885);
const PANEL_K = PANEL_W / 885;
const ROW_W = 176;
const ROW_H = ROW_W * (77 / 315);
const ROW_X = 14;
const ROW_Y = 40;
const ROW_GAP = 6;
const ORIGINS = boardOrigins(BATTLE_BOARD_TOP);
const TARGETABLE = new Set<ArsenalKind>(WEAPON_ORDER);

export interface ArsenalTarget {
  readonly itemId: string;
  readonly kind: ArsenalKind;
}

export function remainingItems(
  arsenal: readonly ArsenalItem[],
  kind: ArsenalKind,
): readonly ArsenalItem[] {
  return arsenal.filter((item) => item.kind === kind && !item.used && !item.destroyed);
}

function WeaponRow({
  kind,
  count,
  enabled,
  x,
  y,
  onPress,
}: {
  kind: ArsenalKind;
  count: number;
  enabled: boolean;
  x: number;
  y: number;
  onPress: () => void;
}) {
  const pressable = enabled && count > 0 && TARGETABLE.has(kind);
  // The tutorial spotlights and unlocks a row by `card-<kind>` (step 8, the Bomber).
  const target = useTutorialTarget(`card-${kind.toLowerCase()}`);
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <View {...target} style={[styles.row, { left: x, top: y }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${ARSENAL_NAMES[kind]}, ${count} left`}
        accessibilityState={{ disabled: !pressable }}
        disabled={!pressable}
        onPress={onPress}
        onPressIn={() => {
          press.value = withTiming(0.95, { duration: 70 });
          haptic('buttonPress');
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 11, stiffness: 360 });
        }}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[styles.rowBody, { opacity: pressable ? 1 : 0.42 }, style]}>
          <Image source={BATTLE_ART.weaponRow} style={StyleSheet.absoluteFill} contentFit="fill" />
          <View style={styles.rowIcon}>
            <ArsenalIcon kind={kind} w={38} h={26} />
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={[styles.rowName, !pressable && styles.rowNameOff]}
          >
            {WEAPON_NAMES[kind]}
          </Text>
          <Text style={[styles.rowCount, !pressable && styles.rowNameOff]}>{count}</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export function BattleArsenalPopover({
  arsenal,
  canUse,
  onPick,
  onClose,
}: {
  arsenal: readonly ArsenalItem[];
  canUse: boolean;
  onPick: (target: ArsenalTarget) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    enter.value = withTiming(1, {
      duration: reduceMotion ? 0 : 230,
      easing: Easing.out(Easing.back(1.3)),
    });
  }, [enter, reduceMotion]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  // Transform only: the panel holds the rows, and nothing pressable animates opacity.
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: -18 * (1 - enter.value) }, { scale: 0.94 + 0.06 * enter.value }],
  }));
  const shade = useAnimatedStyle(() => ({ opacity: enter.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[styles.scrim, shade]} />
      <Pressable
        style={styles.popoverDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close arsenal"
        onPress={onClose}
      />
      <Animated.View style={[styles.popover, animated]} accessibilityViewIsModal>
        <Image source={BATTLE_ART.weaponModal} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.popoverTitle} accessibilityRole="header">
          Choose a weapon
        </Text>
        {WEAPON_ORDER.map((kind, index) => (
          <WeaponRow
            key={kind}
            kind={kind}
            count={remainingItems(arsenal, kind).length}
            enabled={canUse}
            x={ROW_X + (index % 2) * (ROW_W + ROW_GAP)}
            y={ROW_Y + Math.floor(index / 2) * (ROW_H + ROW_GAP)}
            onPress={() => {
              const item = remainingItems(arsenal, kind)[0];
              if (item) onPick({ itemId: item.id, kind });
            }}
          />
        ))}
        <Text style={styles.popoverHint}>
          {canUse ? 'Pick a weapon, then aim it on the enemy grid.' : 'Weapons can be fired on your turn.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close arsenal"
          hitSlop={10}
          onPress={onClose}
          style={styles.popoverClose}
        />
      </Animated.View>
    </View>
  );
}

export function targetFootprint(kind: ArsenalKind, at: Coord): readonly Coord[] {
  switch (kind) {
    case 'torpedoBomber':
      return Array.from({ length: 10 }, (_, c) => ({ r: at.r, c }));
    case 'doubleTorpedoBomber': {
      const rows = doubleTorpedoRows(at.r);
      return rows.flatMap((r) => Array.from({ length: 10 }, (_, c) => ({ r, c })));
    }
    case 'bomber':
      return bomberFootprint(at);
    case 'atomicBomber':
    case 'radar':
      return atomicFootprint(at);
    case 'submarine':
      return [at];
    case 'aaGun':
    case 'mine':
      return [];
  }
}

function TargetGuide({ kind, at, valid }: { kind: ArsenalKind; at: Coord; valid: boolean }) {
  const { roughRect } = useRough();
  const cells = targetFootprint(kind, at);
  const tone = !valid
    ? color.inkRed
    : kind === 'atomicBomber'
      ? color.inkRed
      : kind === 'radar'
        ? color.inkGreen
        : color.inkSoft;
  const cellShape = roughRect(2, 2, CELL - 4, CELL - 4, {
    seed: hashString(`target-${kind}`),
    stroke: tone,
    strokeWidth: 1,
    fill: tone,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 0.9,
  });
  const column = roughRect(at.c * CELL + 3, 1, CELL - 6, BOARD_SIZE - 2, {
    seed: hashString('submarine-target-column'),
    stroke: color.inkSoft,
    strokeWidth: 0.6,
    fill: color.inkSoft,
    fillStyle: 'hachure',
    hachureGap: 5,
    fillWeight: 0.55,
  });
  const aircraft =
    kind === 'torpedoBomber' ||
    kind === 'doubleTorpedoBomber' ||
    kind === 'bomber' ||
    kind === 'atomicBomber';
  const launchRow = kind === 'doubleTorpedoBomber' ? doubleTorpedoRows(at.r)[0] : at.r;

  return (
    <View pointerEvents="none" style={styles.guide}>
      <Svg width={BOARD_SIZE} height={BOARD_SIZE} viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}>
        {kind === 'submarine' ? <RoughShape paths={column} opacity={0.18} /> : null}
        {cells.map((cell) => (
          <G key={`${cell.r},${cell.c}`} transform={`translate(${cell.c * CELL} ${cell.r * CELL})`}>
            <RoughShape paths={cellShape} opacity={kind === 'submarine' ? 0.72 : 0.42} />
          </G>
        ))}
      </Svg>
      {aircraft ? (
        <View style={[styles.launchPlane, { top: launchRow * CELL - 4 }]}>
          <ArsenalIcon kind={kind} w={34} h={26} />
        </View>
      ) : null}
    </View>
  );
}

const TargetGestureSurface = memo(function TargetGestureSurface({
  kind,
  marks,
  onHover,
  onFire,
}: {
  kind: ArsenalKind;
  marks: Marks;
  onHover: (at: Coord) => void;
  onFire: (at: Coord) => void;
}) {
  const { scale, ox, oy } = useScale();
  const lastIndex = useSharedValue(-1);

  const hoverIndex = useCallback(
    (index: number) => onHover({ r: Math.floor(index / 10), c: index % 10 }),
    [onHover],
  );
  const fireIndex = useCallback(
    (index: number) => {
      const at = { r: Math.floor(index / 10), c: index % 10 };
      if (kind === 'submarine' && marks[`${at.r},${at.c}`]) return;
      onHover(at);
      onFire(at);
    },
    [kind, marks, onFire, onHover],
  );

  const indexAt = (absoluteX: number, absoluteY: number) => {
    'worklet';
    const c = Math.floor(((absoluteX - ox) / scale - ORIGINS.enemy.x) / CELL);
    const r = Math.floor(((absoluteY - oy) / scale - ORIGINS.enemy.y) / CELL);
    return r >= 0 && r < 10 && c >= 0 && c < 10 ? r * 10 + c : -1;
  };
  const update = (absoluteX: number, absoluteY: number) => {
    'worklet';
    const index = indexAt(absoluteX, absoluteY);
    if (index >= 0 && index !== lastIndex.value) {
      lastIndex.value = index;
      runOnJS(hoverIndex)(index);
    }
  };
  const pan = Gesture.Pan()
    .minDistance(1)
    .onBegin((event) => update(event.absoluteX, event.absoluteY))
    .onUpdate((event) => update(event.absoluteX, event.absoluteY))
    .onEnd((event) => {
      const index = indexAt(event.absoluteX, event.absoluteY);
      if (index >= 0) runOnJS(fireIndex)(index);
    });
  const tap = Gesture.Tap().onEnd((event, success) => {
    const index = indexAt(event.absoluteX, event.absoluteY);
    if (success && index >= 0) runOnJS(fireIndex)(index);
  });

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`Target ${ARSENAL_NAMES[kind]} on the enemy grid`}
        style={StyleSheet.absoluteFill}
      />
    </GestureDetector>
  );
});

export function ArsenalTargetingOverlay({
  target,
  marks,
  onFire,
  onCancel,
}: {
  target: ArsenalTarget;
  marks: Marks;
  onFire: (at: Coord) => void;
  onCancel: () => void;
}) {
  const [hover, setHover] = useState<Coord>({ r: 4, c: 4 });
  const valid = target.kind !== 'submarine' || !marks[`${hover.r},${hover.c}`];
  const copy = valid
    ? `${CARD_NAMES[target.kind]} · release to fire`
    : 'Needs an unshot cell';

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  return (
    <View style={styles.targetCanvas} pointerEvents="box-none">
      <Pressable
        style={styles.cancelTop}
        accessibilityLabel="Cancel targeting"
        onPress={onCancel}
      />
      <Pressable
        style={styles.cancelLeft}
        accessibilityLabel="Cancel targeting"
        onPress={onCancel}
      />
      <Pressable
        style={styles.cancelRight}
        accessibilityLabel="Cancel targeting"
        onPress={onCancel}
      />
      <Pressable
        style={styles.cancelBottom}
        accessibilityLabel="Cancel targeting"
        onPress={onCancel}
      />
      <View style={styles.targetBack}>
        <ArtPlate family="sketch" tone="cream" w={82} h={34} label="Back" fontSize={16} onPress={onCancel} />
      </View>
      <View style={styles.targetCopy} pointerEvents="none">
        <Image source={BATTLE_ART.weaponRow} style={StyleSheet.absoluteFill} contentFit="fill" />
        <ArsenalIcon kind={target.kind} w={26} h={18} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.targetCopyText, !valid && styles.targetCopyTextInvalid]}>
          {copy}
        </Text>
      </View>
      <View style={styles.enemyTarget}>
        <TargetGuide kind={target.kind} at={hover} valid={valid} />
        <TargetGestureSurface kind={target.kind} marks={marks} onHover={setHover} onFire={onFire} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: -200,
    top: -200,
    right: -200,
    bottom: -200,
    backgroundColor: 'rgba(10, 16, 108, 0.16)',
  },
  popoverDismiss: { position: 'absolute', left: -200, top: -200, right: -200, bottom: -200 },
  popover: {
    position: 'absolute',
    left: 7,
    top: BATTLE_BOARD_TOP + 14,
    width: PANEL_W,
    height: PANEL_H,
    zIndex: 70,
  },
  popoverTitle: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: 9,
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 20,
    textAlign: 'center',
  },
  popoverHint: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 9,
    color: artColor.soft,
    fontFamily: font.label,
    fontSize: 11,
    textAlign: 'center',
  },
  popoverClose: {
    position: 'absolute',
    left: 853 * PANEL_K - 12,
    top: 35.5 * PANEL_K - 12,
    width: 24,
    height: 24,
  },
  row: { position: 'absolute', width: ROW_W, height: ROW_H },
  rowBody: { width: ROW_W, height: ROW_H },
  rowIcon: { position: 'absolute', left: 9, top: (ROW_H - 26) / 2, width: 38, height: 26 },
  rowName: {
    position: 'absolute',
    left: 52,
    right: 27,
    top: 0,
    bottom: 0,
    textAlignVertical: 'center',
    lineHeight: ROW_H,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 14,
  },
  rowNameOff: { color: artColor.muted },
  rowCount: {
    position: 'absolute',
    right: 12,
    top: 0,
    lineHeight: ROW_H,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  targetCanvas: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    zIndex: 75,
  },
  cancelTop: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: BATTLE_BOARD_TOP },
  cancelLeft: {
    position: 'absolute',
    left: 0,
    top: BATTLE_BOARD_TOP,
    width: ORIGINS.enemy.x,
    height: BOARD_SIZE,
  },
  cancelRight: {
    position: 'absolute',
    left: ORIGINS.enemy.x + BOARD_SIZE,
    top: BATTLE_BOARD_TOP,
    right: 0,
    height: BOARD_SIZE,
  },
  cancelBottom: {
    position: 'absolute',
    left: 0,
    top: BATTLE_BOARD_TOP + BOARD_SIZE,
    width: CANVAS_W,
    bottom: 0,
  },
  // Both sit where the opponent's plate is: while aiming, the plate is the prompt.
  targetBack: { position: 'absolute', left: 652, top: 33, zIndex: 3 },
  targetCopy: {
    position: 'absolute',
    left: 478,
    top: 31,
    width: 168,
    height: 38,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  targetCopyText: { color: artColor.navy, fontFamily: font.display, fontSize: 13, flexShrink: 1 },
  targetCopyTextInvalid: { color: artColor.red },
  enemyTarget: {
    position: 'absolute',
    left: ORIGINS.enemy.x,
    top: ORIGINS.enemy.y,
    width: BOARD_SIZE,
    height: BOARD_SIZE,
  },
  guide: { position: 'absolute', left: 0, top: 0, width: BOARD_SIZE, height: BOARD_SIZE },
  launchPlane: {
    position: 'absolute',
    left: -38,
    width: 34,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
