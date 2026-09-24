/**
 * The city HUD and the Workers' Lodge — part-02 §6.
 *
 * Top right: coins, steel, gems in the existing ink chip. Numbers ROLL when
 * they change, and a change that arrived from the server while the screen was
 * open flashes the chip once. Under them, "Workers 1/2", tappable. Bottom
 * right, the Collect all ribbon, and only at two or more collectables.
 *
 * The roll is presentation only — the value it rolls TO is always the one the
 * server sent (§12.1).
 */
import { WORKER_ADMIRALTY_REQ, WORKER_GEM_COST } from '@engine/city';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CurrencyChip } from '@/ui/CurrencyChip';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { useCity } from '../store';
import { captainLineFor } from './captainCopy';

/** A chip that rolls to a new value and flashes when the server moves it. */
const RollingChip = memo(function RollingChip({
  kind,
  value,
}: {
  kind: 'coins' | 'steel' | 'gems';
  value: number;
}) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(value);
  const flash = useSharedValue(0);
  const previous = useRef(value);

  useEffect(() => {
    if (value === previous.current) return;
    previous.current = value;
    if (reduceMotion) {
      setShown(value);
      return;
    }
    flash.value = withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 420 }));

    // Roll over ~420 ms, matching the collect flight so they land together.
    const from = shown;
    const start = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 420);
      setShown(Math.round(from + (value - from) * t));
      if (t >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [value, reduceMotion, flash, shown]);

  const style = useAnimatedStyle(() => ({ opacity: 1 - flash.value * 0.35 }));

  return (
    <Animated.View style={style}>
      <CurrencyChip kind={kind} value={shown} />
    </Animated.View>
  );
});

export interface CityHudProps {
  readonly onOpenWorkers: () => void;
  readonly onCollectAll: () => void;
}

export function CityHud({ onOpenWorkers, onCollectAll }: CityHudProps) {
  const snapshot = useCity((s) => s.snapshot);
  if (!snapshot) return null;

  const collectableCount = snapshot.collectable.ids.length;

  return (
    <>
      <View style={styles.topRight} pointerEvents="box-none">
        <RollingChip kind="coins" value={snapshot.wallet.coins} />
        <RollingChip kind="steel" value={snapshot.wallet.steel} />
        <RollingChip kind="gems" value={snapshot.wallet.gems} />
      </View>

      <Pressable
        style={styles.workers}
        accessibilityRole="button"
        accessibilityLabel={`Dock workers, ${snapshot.freeWorkers} of ${snapshot.city.workers} free`}
        onPress={onOpenWorkers}
      >
        <Text style={styles.workersText}>
          Workers {snapshot.freeWorkers}/{snapshot.city.workers}
        </Text>
      </Pressable>

      {collectableCount >= 2 ? (
        <Pressable
          style={styles.collectAll}
          accessibilityRole="button"
          accessibilityLabel={`Collect all, ${snapshot.collectable.total} waiting`}
          onPress={onCollectAll}
        >
          <TitleRibbon title="Collect all" w={140} h={28} size="sm" seedKey="collect-all" />
        </Pressable>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The Workers' Lodge (§6)
// ---------------------------------------------------------------------------

export function WorkersSheet({
  open,
  busy,
  errorCode,
  onClose,
  onBuy,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly errorCode: string | null;
  readonly onClose: () => void;
  readonly onBuy: () => void;
}) {
  const snapshot = useCity((s) => s.snapshot);
  if (!open || !snapshot) return null;

  const workers = snapshot.city.workers;
  const nextIndex = workers;
  const atMax = nextIndex >= WORKER_GEM_COST.length;
  const cost = WORKER_GEM_COST[nextIndex] ?? 0;
  const requires = WORKER_ADMIRALTY_REQ[nextIndex] ?? 0;
  const admiralty = snapshot.city.buildings.admiralty.level;

  const blocked = atMax
    ? captainLineFor('max-level')
    : admiralty < requires
      ? captainLineFor('needs-admiralty', { requiredAdmiralty: requires })
      : snapshot.wallet.gems < cost
        ? captainLineFor('not-enough-gems', { shortGems: cost - snapshot.wallet.gems })
        : errorCode
          ? captainLineFor(errorCode as never, {})
          : 'A third pair of hands means a third job at once.';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.wash} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.lodge}>
        <InkPanel w={320} h={150} seedKey="workers-lodge" padding={space.sm}>
          <Text style={styles.lodgeTitle}>Workers&apos; Lodge</Text>
          <Text style={styles.lodgeBody}>
            {workers} dock {workers === 1 ? 'worker' : 'workers'}, {snapshot.freeWorkers} free.
          </Text>
          <Text style={styles.lodgeReason}>{blocked}</Text>
          <View style={styles.lodgeButtons}>
            <InkButton
              label={atMax ? 'All hired' : `Hire for ${cost} gems`}
              tone="confirm"
              size="sm"
              h={30}
              disabled={atMax || busy || admiralty < requires || snapshot.wallet.gems < cost}
              seedKey="hire-worker"
              onPress={onBuy}
            />
            <InkButton label="Close" size="sm" h={30} w={78} seedKey="lodge-close" onPress={onClose} />
          </View>
        </InkPanel>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topRight: {
    position: 'absolute',
    right: space.md,
    top: space.sm,
    flexDirection: 'row',
    gap: space.xs,
  },
  workers: {
    position: 'absolute',
    right: space.md,
    top: space.sm + 34,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    backgroundColor: 'rgba(251, 252, 254, 0.85)',
  },
  workersText: { fontFamily: font.label, fontSize: typeScale.xxs, color: color.ink },
  collectAll: { position: 'absolute', right: space.md, bottom: space.sm },
  wash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(62, 47, 184, 0.12)' },
  lodge: { position: 'absolute', left: (CANVAS_W - 320) / 2, top: (CANVAS_H - 150) / 2 },
  lodgeTitle: { fontFamily: font.display, fontSize: typeScale.md, color: color.ink },
  lodgeBody: { fontFamily: font.body, fontSize: typeScale.xs, color: color.ink, marginTop: 2 },
  lodgeReason: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkSoft,
    marginTop: space.xxs,
    minHeight: 32,
  },
  lodgeButtons: { flexDirection: 'row', gap: space.xs, marginTop: 'auto' },
});
