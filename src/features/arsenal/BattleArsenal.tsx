import { ARSENAL_SPEC, atomicFootprint, bomberFootprint, doubleTorpedoRows, isAttackArsenalKind } from '@engine/arsenal';
import type { ArsenalItem, ArsenalKind, Coord, Marks } from '@engine/types';
import { memo, useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';

import { BATTLE_BOARD_TOP, BOARD_SIZE, CELL, boardOrigins } from '@/board/layout';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';
import { ARSENAL_NAMES, ArsenalInkSprite } from './ShopPanel';

const PANEL_W = 398;
const PANEL_H = 246;
const CARD_W = 181;
const CARD_H = 40;
const ORIGINS = boardOrigins(BATTLE_BOARD_TOP);
const TARGETABLE = new Set<ArsenalKind>([
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'submarine',
  'radar',
]);

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

function ArsenalCard({
  kind,
  count,
  enabled,
  onPress,
}: {
  kind: ArsenalKind;
  count: number;
  enabled: boolean;
  onPress: () => void;
}) {
  const pressable = enabled && count > 0 && TARGETABLE.has(kind);
  // The tutorial spotlights and unlocks a card by `card-<kind>` (step 8, the Bomber).
  const target = useTutorialTarget(`card-${kind.toLowerCase()}`);
  return (
    <View {...target} style={{ width: CARD_W, height: CARD_H, opacity: count === 0 ? 0.4 : 1 }}>
      <InkPanel w={CARD_W} h={CARD_H} seedKey={`battle-arsenal-${kind}`} padding={0}>
        <View pointerEvents="none" style={styles.cardIcon}>
          <ArsenalInkSprite kind={kind} />
        </View>
        <Text pointerEvents="none" numberOfLines={1} style={styles.cardName}>
          {ARSENAL_NAMES[kind]}
        </Text>
        <Text pointerEvents="none" style={styles.cardCount}>
          {count}
        </Text>
      </InkPanel>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${ARSENAL_NAMES[kind]}, ${count} remaining${TARGETABLE.has(kind) ? '' : ', automatic defence'}`}
        accessibilityState={{ disabled: !pressable }}
        disabled={!pressable}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      />
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
      duration: reduceMotion ? 0 : 250,
      easing: Easing.out(Easing.cubic),
    });
  }, [enter, reduceMotion]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (enter.value - 1) * PANEL_H }],
  }));

  // The AA gun is bought and placed in the shop and then works on its own;
  // it has no place in a "choose a weapon" list. A mine is the same — it is
  // defensive placement only, so it never appears here with a count. The
  // shared predicate keeps both attack renderers in step.
  const kinds = ARSENAL_SPEC.map((entry) => entry.kind).filter(isAttackArsenalKind);
  const slots: readonly (ArsenalKind | null)[] = [
    ...kinds,
    ...Array.from({ length: 10 - kinds.length }, () => null),
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={styles.popoverDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close arsenal"
        onPress={onClose}
      />
      <Animated.View style={[styles.popover, animated]}>
        <InkPanel w={PANEL_W} h={PANEL_H} seedKey="battle-arsenal-popover" padding={1}>
          <Text style={styles.popoverTitle}>Choose a weapon</Text>
          <View style={styles.cardGrid}>
            {slots.map((kind, index) =>
              kind ? (
                <ArsenalCard
                  key={kind}
                  kind={kind}
                  count={remainingItems(arsenal, kind).length}
                  enabled={canUse}
                  onPress={() => {
                    const item = remainingItems(arsenal, kind)[0];
                    if (item) onPick({ itemId: item.id, kind });
                  }}
                />
              ) : (
                <View key={`empty-${index}`} style={styles.emptyCard} pointerEvents="none" />
              ),
            )}
          </View>
        </InkPanel>
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
    // Part 5 — the minesweeper sweeps the chosen row AND the one below it,
    // exactly like the double torpedo, so it highlights two rows.
    case 'minesweeper': {
      const rows = doubleTorpedoRows(at.r);
      return rows.flatMap((r) => Array.from({ length: 10 }, (_, c) => ({ r, c })));
    }
    // Passive own-board items are never aimed.
    case 'aaGun':
    case 'mine':
    case 'sonar_net':
    case 'decoy':
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
        <View style={[styles.launchPlane, { top: launchRow * CELL - 6 }]}>
          <ArsenalInkSprite kind={kind} />
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
    ? `${ARSENAL_NAMES[target.kind]} · release to fire`
    : 'Submarine needs an unshot cell';

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
        <InkButton label="Back" size="sm" w={78} h={40} onPress={onCancel} />
      </View>
      <View style={[styles.targetCopy, !valid && styles.targetCopyInvalid]} pointerEvents="none">
        <Text style={[styles.targetCopyText, !valid && styles.targetCopyTextInvalid]}>{copy}</Text>
      </View>
      <View style={styles.enemyTarget}>
        <TargetGuide kind={target.kind} at={hover} valid={valid} />
        <TargetGestureSurface kind={target.kind} marks={marks} onHover={setHover} onFire={onFire} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  popoverDismiss: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  popover: { position: 'absolute', left: 4, top: 0, width: PANEL_W, height: PANEL_H, zIndex: 70 },
  popoverTitle: {
    height: 22,
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cardIcon: {
    position: 'absolute',
    left: 5,
    top: 2,
    width: 40,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 0.52 }],
  },
  cardName: {
    position: 'absolute',
    left: 40,
    right: 32,
    top: 8,
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  cardCount: {
    position: 'absolute',
    right: 10,
    top: 5,
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    fontVariant: ['tabular-nums'],
  },
  emptyCard: {
    width: CARD_W,
    height: CARD_H,
    borderWidth: 1,
    borderColor: color.gridMajor,
    opacity: 0.25,
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
  targetBack: { position: 'absolute', right: 8, top: 3, zIndex: 3 },
  targetCopy: {
    position: 'absolute',
    left: ORIGINS.enemy.x + 38,
    top: BATTLE_BOARD_TOP - 31,
    width: BOARD_SIZE - 76,
    minHeight: 26,
    paddingHorizontal: 8,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetCopyInvalid: { borderColor: color.inkRed },
  targetCopyText: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  targetCopyTextInvalid: { color: color.inkRed },
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
    left: -40,
    width: 52,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 0.62 }],
  },
});
