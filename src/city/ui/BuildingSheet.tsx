/**
 * The building sheet — part-02 §5.
 *
 * Slides up from the bottom over an INK WASH, not a black scrim. Name, level
 * pips, a line of Captain flavour, Now -> Next in the building's own units, the
 * cost row with the short resource in red and the exact shortfall, one primary
 * button and the secondaries.
 *
 * Every disabled reason is a Captain line from captainCopy.ts. No error code
 * ever reaches the player.
 */
import { CITY_CATALOGUE, maxLevel, nextLevelSpec, type BuildingId } from '@engine/city';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { speedUpGems } from '@engine/city';
import { canAfford, useCity } from '../store';
import { BUILDING_FLAVOUR, captainLineFor, effectLabel } from './captainCopy';
import { formatClock } from './Plot';
import type { PlotView } from './plotState';

const SHEET_W = 440;
const SHEET_H = 226;

export interface BuildingSheetProps {
  readonly view: PlotView | null;
  readonly busy: boolean;
  readonly errorCode: string | null;
  readonly nextWorkerFreeIn: number;
  readonly onClose: () => void;
  readonly onBuild: (id: BuildingId) => void;
  readonly onSpeedUp: (id: BuildingId) => void;
  readonly onCancel: (id: BuildingId) => void;
  readonly onCollect: (id: BuildingId) => void;
}

export function BuildingSheet({
  view,
  busy,
  errorCode,
  nextWorkerFreeIn,
  onClose,
  onBuild,
  onSpeedUp,
  onCancel,
  onCollect,
}: BuildingSheetProps) {
  const reduceMotion = useReducedMotion();
  const rise = useSharedValue(reduceMotion ? 0 : SHEET_H);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const snapshot = useCity((s) => s.snapshot);
  const store = useCity();

  useEffect(() => {
    if (!view) return;
    setConfirmCancel(false);
    rise.value = reduceMotion
      ? 0
      : withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [view, rise, reduceMotion]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  if (!view || !snapshot) return null;

  const id = view.id;
  const spec = CITY_CATALOGUE[id];
  const next = nextLevelSpec(snapshot.city, id);
  const afford = canAfford(store, id);
  const atMax = view.level >= maxLevel(id);

  // What the primary button does, in the order §5 lists.
  const primary = (() => {
    if (view.state === 'ready') {
      return {
        label: `Collect ${view.collectAmount} ${view.collectResource}`,
        onPress: () => onCollect(id),
        tone: 'confirm' as const,
        disabled: false,
      };
    }
    if (view.state === 'building' || view.state === 'upgrading') {
      const gems = speedUpGems(view.secondsLeft);
      return {
        label: gems === 0 ? 'Finish now (free)' : `Finish now (${gems} gems)`,
        onPress: () => onSpeedUp(id),
        tone: 'confirm' as const,
        disabled: snapshot.wallet.gems < gems,
      };
    }
    if (atMax) {
      return { label: 'Complete', onPress: () => undefined, tone: 'ink' as const, disabled: true };
    }
    return {
      label: view.level === 0 ? 'Build' : `Upgrade to ${view.level + 1}`,
      onPress: () => onBuild(id),
      tone: 'confirm' as const,
      disabled: !afford.ok || view.state === 'locked',
    };
  })();

  /** The one line under the buttons: why the primary is greyed, or the error. */
  const reason = (() => {
    if (errorCode) {
      return captainLineFor(errorCode as never, {
        nextWorkerFreeIn,
        requiredAdmiralty: view.requiredAdmiralty ?? undefined,
        shortSteel: afford.shortSteel,
        shortCoins: afford.shortCoins,
      });
    }
    if (view.state === 'locked') {
      return captainLineFor('needs-admiralty', {
        requiredAdmiralty: view.requiredAdmiralty ?? undefined,
      });
    }
    if (atMax) return captainLineFor('max-level');
    if (view.state === 'empty' && !afford.ok) {
      return afford.shortSteel > 0
        ? captainLineFor('not-enough-steel', { shortSteel: afford.shortSteel })
        : captainLineFor('not-enough-coins', { shortCoins: afford.shortCoins });
    }
    if (snapshot.freeWorkers <= 0 && (view.state === 'empty' || view.state === 'built')) {
      return captainLineFor('no-free-worker', { nextWorkerFreeIn });
    }
    return BUILDING_FLAVOUR[id];
  })();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* The ink wash: the scene stays readable through it (§5). */}
      <Pressable style={styles.wash} onPress={onClose} accessibilityLabel="Close" />

      <Animated.View style={[styles.sheet, slide]}>
        <InkPanel w={SHEET_W} h={SHEET_H} seedKey={`sheet-${id}`} padding={space.sm}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{spec.name}</Text>
            <Text style={styles.level}>
              {view.level > 0 ? `Level ${view.level} / ${maxLevel(id)}` : 'Not built'}
            </Text>
          </View>

          <Text style={styles.flavour} numberOfLines={2}>
            {reason}
          </Text>

          {!atMax && next ? (
            <>
              <View style={styles.effectRow}>
                <Text style={styles.effectLabel}>Now</Text>
                <Text style={styles.effectValue}>{effectLabel(id, view.level)}</Text>
                <Text style={styles.arrow}>→</Text>
                <Text style={styles.effectLabel}>Next</Text>
                <Text style={styles.effectValue}>{effectLabel(id, view.level + 1)}</Text>
              </View>

              <View style={styles.costRow}>
                <Cost label="steel" value={next.steel} short={afford.shortSteel} />
                <Cost label="coins" value={next.coins} short={afford.shortCoins} />
                <Cost label="time" value={next.minutes * 60} time />
              </View>
            </>
          ) : null}

          <View style={styles.buttons}>
            <InkButton
              label={primary.label}
              tone={primary.tone}
              size="md"
              h={34}
              disabled={primary.disabled || busy}
              seedKey={`sheet-primary-${id}`}
              onPress={primary.onPress}
            />
            {view.state === 'building' || view.state === 'upgrading' ? (
              <InkButton
                label={confirmCancel ? 'Half the steel comes back — sure?' : 'Cancel job'}
                tone="danger"
                size="sm"
                h={30}
                w={confirmCancel ? 250 : 108}
                disabled={busy}
                seedKey={`sheet-cancel-${id}`}
                onPress={() => (confirmCancel ? onCancel(id) : setConfirmCancel(true))}
              />
            ) : null}
            <InkButton label="Close" size="sm" h={30} w={78} seedKey="sheet-close" onPress={onClose} />
          </View>
        </InkPanel>
      </Animated.View>
    </View>
  );
}

function Cost({
  label,
  value,
  short = 0,
  time = false,
}: {
  label: string;
  value: number;
  short?: number;
  time?: boolean;
}) {
  const isShort = short > 0;
  return (
    <View style={styles.cost}>
      <Text style={styles.costLabel}>{label}</Text>
      <Text style={[styles.costValue, isShort ? styles.costShort : null]}>
        {time ? formatClock(value) : value.toLocaleString()}
      </Text>
      {isShort ? <Text style={styles.shortfall}>{short} short</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(62, 47, 184, 0.12)' },
  sheet: { position: 'absolute', left: (CANVAS_W - SHEET_W) / 2, top: CANVAS_H - SHEET_H - 4 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontFamily: font.display, fontSize: typeScale.md, color: color.ink },
  level: { fontFamily: font.label, fontSize: typeScale.xs, color: color.inkSoft },
  flavour: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkSoft,
    marginTop: 2,
    minHeight: 30,
  },
  effectRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  effectLabel: { fontFamily: font.body, fontSize: typeScale.xxs, color: color.inkFaint },
  effectValue: { fontFamily: font.label, fontSize: typeScale.sm, color: color.ink },
  arrow: { fontFamily: font.label, fontSize: typeScale.sm, color: color.inkSoft },
  costRow: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  cost: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  costLabel: { fontFamily: font.body, fontSize: typeScale.xxs, color: color.inkFaint },
  costValue: { fontFamily: font.label, fontSize: typeScale.sm, color: color.ink },
  costShort: { color: color.inkRed },
  shortfall: { fontFamily: font.body, fontSize: typeScale.xxs, color: color.inkRed },
  buttons: { flexDirection: 'row', gap: space.xs, marginTop: 'auto', alignItems: 'center' },
});
